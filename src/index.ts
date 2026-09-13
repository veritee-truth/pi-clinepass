/**
 * pi-clinepass — ClinePass for pi.
 *
 * Registers the `clinepass` provider (14 paid models with measured billing
 * prices + 4 free models) and wires the hooks that keep pi's numbers real:
 *   - message_end → server-truth cost meter + session total + error surface + thinking repair
 *   - before_provider_headers → free-route Cline-CLI headers
 *   - model_select / session_start → immediate meter + default model sync
 *   - /clinepass → dashboard report · price calibration (full-screen view)
 *
 * Model prices come from the static catalog unless the user has run
 * calibration (`/clinepass → Calibrate`), which measures the gateway's real
 * billing rates and persists them to ~/.pi/agent/clinepass-prices.json.
 */

import type { ExtensionAPI, ExtensionContext, ProviderModelConfig } from "@oh-my-pi/pi-coding-agent";
import { isFreeModel, MODELS } from "./catalog.js";
import { DEFAULT_API_BASE, WORKOS_TOKEN_PREFIX } from "./workos.js";
import {
  bindOmpCredentialStore,
  getApiKey,
  login,
  refreshToken,
  resolveStoredCredential,
  type OmpStoredCredential,
} from "./auth.js";
import {
  getCapReport,
  getCapReportData,
  handleInitialMeter,
  handleUsageTracking,
  PROVIDER_NAME,
  reseedUsageBaseline,
  setUsageTrackingPaused,
} from "./usage.js";
import { buildFreeModelHeadersSync, getClineVersion, needsFreeModelHeaders } from "./headers.js";
import { handleClinePassError } from "./errors.js";
import { normalizeThinking } from "./thinking.js";
import {
  buildCalibrationFile,
  formatCalibrationReport,
  runCalibration,
  type CalibrationRunResult,
} from "./calibrate.js";
import { CalibrationView, ReportView } from "./views.js";
import { getAgentDir } from "@oh-my-pi/pi-utils";
import {
  bindCalibrationDir,
  currentCalibration,
  displayName,
  getEffectiveModels,
  refreshEffectiveModels,
  writeCalibrationFile,
} from "./pricing.js";

// The calibration store lives in OMP's own agent directory. Bound here (inside
// the running host) rather than imported in pricing.ts, whose module graph must
// stay free of the host's Bun-only/native dependencies for unit tests.
bindCalibrationDir(getAgentDir());

/** Guard so a second /clinepass invocation cannot double-run calibration. */
let calibrationRunning = false;

// Menu labels embed a description (pi's select only takes plain strings — the
// em-dash separator is the standard pattern for string-option menus).
const MENU_DASHBOARD = "View price dashboard — model rates and plan limits";
const MENU_CALIBRATE = "Calibrate model prices — measure real gateway billing";

/** Current effective models, priced and named for the picker. */
function providerModels() {
  // Estimator layer OFF: cost is zeroed so pi's own cost displays stay out of
  // the picture — the /usages meter is the single cost display. Picker prices
  // come from the store via displayName.
  return getEffectiveModels().map((model) => ({
    ...model,
    input: [...model.input],
    name: displayName(model),
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  }));
}

/**
 * Full provider config — reused by the factory registration and by the
 * post-calibration re-register (OMP applies a re-registration immediately, so
 * the picker shows fresh prices without a /reload).
 *
 * OMP differences from upstream pi, each deliberate:
 *   - no `name`: OMP takes the display name from the registration key.
 *   - no `oauth.isSubscription`: OMP's OAuthProviderConfig has no such field.
 *   - no `refreshModels`: OMP has no such hook. Static `models` are the whole
 *     story, and calibration re-registers the provider to push new prices.
 */
function providerConfig() {
  return {
    baseUrl: `${DEFAULT_API_BASE}/api/v1`,
    authHeader: true,
    // ClinePass is OpenAI-compatible; OMP's built-in openai-completions
    // streaming handles SSE, tools, and usage. No custom streamSimple.
    api: "openai-completions" as const,
    oauth: {
      name: "ClinePass",
      login,
      refreshToken,
      getApiKey,
    },
    // Calibrated overrides (when present) merged over the static catalog; the
    // picker shows name + effective price (or "(free)").
    models: providerModelsWithFreeHeaders(),
  };
}

/**
 * Provider models with the free-route identifying headers baked into each free
 * model's config.
 *
 * Upstream pi injects these per request via a `before_provider_headers` event,
 * which OMP does not have. OMP's `before_provider_request` exposes only the
 * request BODY (its return value replaces the payload), not the header map, so
 * headers cannot be added there. Baking them into the model config is the one
 * place OMP honors them.
 *
 * Cost: the Cline CLI version is read once, at registration. `session_start`
 * pre-warms the cache so the first session after a version bump already has the
 * live value; a version published mid-session applies at the next launch.
 */
function providerModelsWithFreeHeaders() {
  return providerModels().map((model) =>
    needsFreeModelHeaders(model.id) ? { ...model, headers: buildFreeModelHeadersSync() } : model,
  );
}

export default async function (pi: ExtensionAPI) {
  pi.registerProvider(PROVIDER_NAME, providerConfig());

  /**
   * Bind OMP's credential store for the meter.
   *
   * OMP keeps the `clinepass` credential in its own store (`~/.omp/agent`,
   * AuthStorage/SQLite), NOT in a pi-style `auth.json`. Binding it makes the
   * meter measure the account OMP actually bills, and routes rotated refresh
   * tokens back through AuthStorage, which owns cross-process locking.
   *
   * Bound on `session_start` because that is where `ctx.modelRegistry` (and
   * therefore the credential store) first becomes reachable; every other hook
   * and the /clinepass command run after it.
   */
  pi.on("session_start", (_event, ctx) => {
    const authStorage = ctx.modelRegistry?.authStorage;
    if (authStorage) {
      bindOmpCredentialStore({
        read: () => authStorage.getOAuthCredential(PROVIDER_NAME) as OmpStoredCredential | undefined,
        write: async (credential) => {
          await authStorage.set(PROVIDER_NAME, credential as Parameters<typeof authStorage.set>[1]);
        },
      });
    }
    // Pre-warm the Cline CLI version here instead of the factory: the factory
    // runs for every invocation (including --list-models). The sync header
    // builder falls back to the bundled version until this fetch completes;
    // the baked headers pick up the new value on the next launch.
    void getClineVersion().catch(() => {});
    void handleInitialMeter(ctx);
  });

  // Persist the per-turn server bill as a custom session entry so the
  // session total survives resume/fork, then surface it in the status meter.
  const writeCostEntry = (usage: { id: string; costUsd: number; model: string }): void => {
    pi.appendEntry("clinepass-cost", {
      usageId: usage.id,
      costUsd: usage.costUsd,
      model: usage.model,
    });
  };

  pi.on("message_end", (event, ctx) => {
    handleClinePassError(event, ctx);
    // Billing tracking is queued in the background: message_end handlers are
    // awaited inline by pi/OMP and gate message finalization + the agent loop,
    // so polling the usage API (with its server flush delay) must never run on
    // this path.
    void handleUsageTracking(event, ctx, writeCostEntry);
  });

  // Repair gateway-side reasoning-stream corruption BEFORE the message is
  // replayed as request context.
  //
  // Upstream pi does this in `message_end` and returns the repaired message;
  // OMP's emit() discards `message_end` return values (only session-before /
  // compacting / stop results are consumed). OMP's `context` event is the hook
  // that DOES honor a returned message array, and it runs immediately before
  // each provider request — so repairing here covers the exact cost the repair
  // exists to prevent: a token-joined thinking block replayed into the request
  // context and re-billed as inflated input tokens on every later turn.
  pi.on("context", (event, ctx) => {
    let changed = false;
    const messages = event.messages.map((message) => {
      const repaired = normalizeThinking({ message }, { model: ctx.model })?.message;
      if (repaired === undefined) return message;
      changed = true;
      return repaired;
    });
    return changed ? { messages } : undefined;
  });

  // Free-route identifying headers are baked into the model configs at
  // registration (see providerModelsWithFreeHeaders): OMP has no
  // `before_provider_headers` event, and its `before_provider_request` exposes
  // only the request body. `session_start` pre-warms the Cline CLI version so
  // the registration-time bake already has the live value.
  //
  // Model selection is deliberately NOT persisted: OMP has no `model_select`
  // event, and writing pi's settings.json from an OMP session would let two
  // harnesses fight over one default. OMP owns its own model selection.

  pi.registerCommand("clinepass", {
    description: "ClinePass dashboard, price calibration, and plan limits",
    handler: async (_args, ctx) => {
      const hasUi = ctx.hasUI && !!ctx.ui?.notify && !!ctx.ui?.select && !!ctx.ui?.confirm;
      if (!hasUi) {
        // Headless: print the report; calibration and its confirm dialog
        // need the TUI.
        const report = await getCapReport();
        console.log(`\n${report}\n`);
        return;
      }

      const ui = ctx.ui;
      // Pre-flight: without a ClinePass subscription the dashboard and
      // calibration are both dead ends — say so before the picker instead of
      // after it. The same fetch feeds the dashboard, so no extra request.
      const data = await getCapReportData();
      if (typeof data === "string") {
        ui.notify(data, "warning");
        return;
      }

      const choice = await ctx.ui.select("ClinePass", [MENU_DASHBOARD, MENU_CALIBRATE]);
      if (choice === MENU_CALIBRATE) {
        await runCalibrationFlow(pi, ctx);
      } else if (choice === MENU_DASHBOARD) {
        // Same bordered modal as calibration: prices left (scroll), plan
        // sidebar right; narrow terminals fall back to a stacked layout.
        await ui.custom<void>(
          (tui, theme, _kb, done) => new ReportView(tui, theme, data, () => done(void 0)),
          // OMP's showOverlay FOCUSES the component itself and sizes it from
          // the view's own `width` (its default overlay options are the full
          // terminal with the component centered), so the box hugs its content
          // and receives keys without an explicit focus call. `onHandle` is
          // deliberately unused: OMP's OverlayHandle exposes only
          // hide/setHidden/isHidden — no focus().
          {
            overlay: true,
            overlayOptions: { anchor: "center", width: "100%", maxHeight: "90%", margin: 0 },
          },
        );
      }
    },
  });
}

/**
 * Interactive price calibration: estimate → user confirmation (with real
 * quota %) → probes with the meter paused → persist + report. Never blocks
 * mid-work: the user starts it explicitly from the /clinepass menu.
 */
async function runCalibrationFlow(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
  const ui = ctx.ui;
  const paid = getEffectiveModels().filter((m) => !isFreeModel(m.id));
  if (paid.length === 0) {
    ui.notify("No paid ClinePass models found.", "error");
    return;
  }
  if (!resolveStoredCredential()) {
    ui.notify("ClinePass login required — run /login first.", "error");
    return;
  }
  if (calibrationRunning) {
    ui.notify("Calibration is already running.", "warning");
    return;
  }
  calibrationRunning = true;
  try {
    const ok = await ui.confirm(
      "Calibrate model prices?",
      "This will use approximately 5-10% of your 5-hour quota.\n\nContinue?",
    );
    if (!ok) return;

    setUsageTrackingPaused(true);
    const abort = new AbortController();
    // Holder object — TS narrows plain `let` assigned inside callbacks to null.
    const box: { result: CalibrationRunResult | null; error?: string } = { result: null };
    try {
      // Centered modal: floats on top of the transcript, row window fits the
      // terminal, cancel hint lives inside the box — never clipped.
      await ui.custom<void>(
        (tui, theme, _kb, done) => {
          const view = new CalibrationView(tui, theme, {
            onCancel: () => abort.abort(),
            onClose: () => done(void 0),
          });
          runCalibration(paid, {
            signal: abort.signal,
            onProgress: (p) => view.update(p),
          })
            .then((r) => {
              box.result = r;
              view.finish(summarizeRun(r, abort.signal.aborted));
            })
            .catch((err) => {
              box.error = err instanceof Error ? err.message : String(err);
              view.finish(`calibration failed: ${box.error}`, true);
            });
          return view;
        },
        {
          overlay: true,
          // See ReportView above: OMP focuses the overlay itself and hugs the
          // content from the view's `width`.
          overlayOptions: { anchor: "center", width: "100%", maxHeight: "90%", margin: 0 },
        },
      );
    } finally {
      setUsageTrackingPaused(false);
      // Probe spend must never be adopted by later turns' meter tracking.
      void reseedUsageBaseline().catch(() => {});
    }

    if (!box.result) {
      ui.notify(`Calibration failed: ${box.error ?? "no results"}`, "error");
      return;
    }
    const result = box.result;

    if (result.applied && result.results.some((r) => r.after)) {
      // Merge over the existing store: measured models update, anything the
      // run could not measure keeps its previous store value — the panel
      // never has gaps. The release stamp carries over so the calibration
      // survives the next session's version check.
      const previous = currentCalibration();
      const file = buildCalibrationFile(result, new Date().toISOString(), previous?.catalogVersion);
      if (previous) {
        for (const [id, entry] of Object.entries(previous.models)) {
          if (!file.models[id]) file.models[id] = entry;
        }
      }
      writeCalibrationFile(file);
      refreshEffectiveModels();
      // Re-register so the picker shows the new prices immediately —
      // post-factory registerProvider takes effect without a /reload.
      pi.registerProvider(PROVIDER_NAME, providerConfig());
    }
    ui.notify(formatCalibrationReport(result, abort.signal.aborted), result.applied ? "info" : "warning");
  } finally {
    calibrationRunning = false;
  }
}

/** One-line summary for the view's final screen. */
function summarizeRun(result: CalibrationRunResult, cancelled: boolean): string {
  const applied = result.results.filter((r) => r.status === "applied").length;
  const unchanged = result.results.filter((r) => r.status === "unchanged").length;
  const failed = result.results.filter((r) => r.status === "failed").length;
  const parts = [
    `${applied} repriced`,
    `${unchanged} unchanged`,
    `${failed} failed`,
    `$${result.spentUsd.toFixed(4)} spent`,
  ];
  return `${cancelled ? "cancelled — " : ""}${parts.join(" · ")}`;
}

export { MODELS, PROVIDER_NAME, WORKOS_TOKEN_PREFIX };

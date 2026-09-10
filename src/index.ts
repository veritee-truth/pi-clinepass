/**
 * pi-clinepass — ClinePass provider for pi.
 *
 * Registers the `clinepass` provider (13 paid models with measured billing
 * prices + 3 free models) and wires the hooks that keep pi's numbers real:
 *   - message_end → server-truth cost meter + session total + error surface
 *   - before_provider_headers → free deepseek route headers
 *   - model_select / session_start → immediate meter + default model sync
 *   - /clinepass → price table + plan limit report
 */

import type { ExtensionAPI, ProviderModelConfig } from "@oh-my-pi/pi-coding-agent";
import { MODELS } from "./catalog.js";
import { DEFAULT_API_BASE, WORKOS_TOKEN_PREFIX } from "./workos.js";
import { getApiKey, login, refreshToken } from "./auth.js";
import {
  getCapReport,
  handleInitialMeter,
  handleUsageTracking,
  PROVIDER_NAME,
} from "./usage.js";
import { buildFreeModelHeadersSync, getClineVersion, needsFreeModelHeaders } from "./headers.js";
import { handleClinePassError } from "./errors.js";
import { savePiDefaultModel } from "./settings.js";

export default async function (pi: ExtensionAPI) {
  // OMP has no `before_provider_headers` event, so we bake the Cline-CLI
  // identifying headers directly into the free DeepSeek model's config.
  // The free route (deepseek/deepseek-v4-flash) is gated behind these headers.
  const models: ProviderModelConfig[] = MODELS.map((model) => {
    const cfg: ProviderModelConfig = {
      ...model,
      input: [...model.input],
    };
    if (needsFreeModelHeaders(model.id)) {
      cfg.headers = buildFreeModelHeadersSync();
    }
    return cfg;
  });

  pi.registerProvider(PROVIDER_NAME, {
    baseUrl: `${DEFAULT_API_BASE}/api/v1`,
    authHeader: true,
    // ClinePass is OpenAI-compatible; OMP's built-in openai-completions
    // streaming handles SSE, tools, and usage. No custom streamSimple.
    api: "openai-completions",
    oauth: {
      name: "ClinePass",
      login,
      refreshToken,
      getApiKey,
    },
    models,
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
    // Billing tracking is queued in the background: message_end handlers
    // are awaited inline by pi and gate message finalization + the agent
    // loop, so polling the usage API (with its server flush delay) must
    // never run on this path.
    void handleUsageTracking(event, ctx, writeCostEntry);
  });

  // OMP has no `model_select` event, so model persistence is handled
  // at registration time instead of on every selection change.
  // The initial meter is shown in `session_start` (below).
  void savePiDefaultModel(PROVIDER_NAME, "cline-pass/deepseek-v4-flash").catch(() => {});

  pi.on("session_start", (_event, ctx) => {
    // Pre-warm the Cline CLI version here instead of the factory: the
    // factory runs for every invocation (including --list-models). The
    // sync header builder falls back to the bundled version until this
    // fetch completes. Header changes take effect after the next /reload.
    void getClineVersion().catch(() => {});
    void handleInitialMeter(ctx);
  });

  pi.registerCommand("clinepass", {
    description: "Show ClinePass model rates and plan limit utilization",
    handler: async (_args, ctx) => {
      const report = await getCapReport();
      if (ctx.hasUI && ctx.ui.notify) {
        ctx.ui.notify(report, "info");
      } else {
        console.log(`\n${report}\n`);
      }
    },
  });
}

export { MODELS, PROVIDER_NAME, WORKOS_TOKEN_PREFIX };

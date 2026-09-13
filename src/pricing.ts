/**
 * Effective model pricing: static catalog + optional user calibration.
 *
 * Calibration results live in OMP's own agent directory
 * (`~/.omp/agent/clinepass-prices.json`) — outside the plugin package, so a
 * reinstall or update never wipes them, and deliberately NOT in pi's
 * `~/.pi/agent`: two harnesses share one catalogVersion gate per file, so a
 * single shared store would let whichever harness updated last reset the
 * other's calibrated rates. Rates are stored in $/1M tokens — the same unit as
 * the static catalog. Every file entry already passed the probe's internal
 * verification when it was written; entries where cacheRead could not be
 * measured carry the previously-effective cacheRead so the file is
 * self-contained.
 */

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { MODELS, type ClinePassModel } from "./catalog.js";

/**
 * Directory holding the calibration store, injected by the extension entry.
 *
 * The entry (which runs inside OMP) binds OMP's own `getAgentDir()` — the
 * authority for the agent directory, honoring `PI_CONFIG_DIR`, named profiles,
 * and Linux XDG relocation. This module deliberately does NOT import that
 * helper: the host module graph pulls in Bun-only globals and native bindings,
 * so an import here would make every consumer (including pure unit tests that
 * pass their own path) depend on the full runtime.
 */
let calibrationDir: string | undefined;

/** Bind the calibration store's directory (called once by the extension entry). */
export function bindCalibrationDir(dir: string): void {
  calibrationDir = dir;
}

/**
 * The calibration store's path. Falls back to `~/.omp/agent` — the same
 * location OMP resolves when `PI_CONFIG_DIR`/profiles/XDG are all unset, which
 * is the case for a standalone (test) run that never binds a directory.
 */
export function calibrationFilePath(): string {
  return join(calibrationDir ?? join(homedir(), ".omp", "agent"), "clinepass-prices.json");
}

export interface CalibratedRates {
  input: number;
  output: number;
  cacheRead: number;
  calibratedAt: string;
}

export interface CalibrationFile {
  version: 1;
  /** Release the store was last synced from — a different version replaces
   * the whole store with the shipped catalog values. */
  catalogVersion?: string;
  calibratedAt: string;
  models: Record<string, CalibratedRates>;
}

let effectiveCache: ClinePassModel[] | undefined;
let currentFile: CalibrationFile | undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFinitePositive(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

/** Parse + validate; returns undefined for any malformed file (never throws). */
export function parseCalibration(text: string): CalibrationFile | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.models)) return undefined;
    const models: Record<string, CalibratedRates> = {};
    for (const [id, entry] of Object.entries(parsed.models)) {
      if (!isRecord(entry) || !isFinitePositive(entry.input) || !isFinitePositive(entry.output) ||
        !isFinitePositive(entry.cacheRead) || typeof entry.calibratedAt !== "string") {
        continue;
      }
      models[id] = {
        input: entry.input,
        output: entry.output,
        cacheRead: entry.cacheRead,
        calibratedAt: entry.calibratedAt,
      };
    }
    if (Object.keys(models).length === 0) return undefined;
    return {
      version: 1,
      catalogVersion: typeof parsed.catalogVersion === "string" ? parsed.catalogVersion : undefined,
      calibratedAt: typeof parsed.calibratedAt === "string" ? parsed.calibratedAt : "",
      models,
    };
  } catch {
    return undefined;
  }
}

export function readCalibrationFile(path = calibrationFilePath()): CalibrationFile | undefined {
  try {
    if (!existsSync(path)) return undefined;
    return parseCalibration(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

export function writeCalibrationFile(file: CalibrationFile, path = calibrationFilePath()): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(file, null, 2), { encoding: "utf8", mode: 0o600 });
  try {
    renameSync(tmp, path);
  } catch {
    writeFileSync(path, JSON.stringify(file, null, 2), { encoding: "utf8", mode: 0o600 });
  }
}

/** Pure: merge calibration overrides onto the static catalog ($/1M unit). */
export function applyCalibration(models: readonly ClinePassModel[], file: CalibrationFile): ClinePassModel[] {
  return models.map((m) => {
    const cal = file.models[m.id];
    if (!cal) return m;
    return { ...m, cost: { input: cal.input, output: cal.output, cacheRead: cal.cacheRead, cacheWrite: 0 } };
  });
}

/** Shrink a rate for display: 1.40 → "1.4", 30.00 → "30", 0.435 → "0.435". */
function fmtRate(v: number): string {
  const s = (v >= 1 ? v.toFixed(2) : v.toFixed(4)).replace(/\.?0+$/, "");
  return s === "" ? "0" : s;
}

/**
 * Display name for the model picker: plain name + effective price for paid
 * models, or "(free)" for free ones. Prices come from the same effective
 * source as everything else, so a calibration run updates the picker on the
 * next session — never a separate hardcoded list. (provider is already shown
 * by the picker itself, so no vendor badge here.)
 */
export function displayName(m: ClinePassModel): string {
  if (m.cost.input === 0) return `${m.name} (free)`;
  return `${m.name} ($${fmtRate(m.cost.input)}/$${fmtRate(m.cost.output)})`;
}

/** Build a full-panel store from the shipped catalog (seed / release sync). */
function seedFromCatalog(catalogVersion: string): CalibrationFile {
  const now = new Date().toISOString();
  const models: Record<string, CalibratedRates> = {};
  for (const m of MODELS) {
    models[m.id] = { input: m.cost.input, output: m.cost.output, cacheRead: m.cost.cacheRead, calibratedAt: now };
  }
  return { version: 1, catalogVersion, calibratedAt: now, models };
}

function loadOnce(): void {
  if (effectiveCache) return;
  const shipped = shippedVersion();
  const file = readCalibrationFile();

  // Missing store (fresh install) or a different shipped release → the store
  // becomes the shipped catalog values, whole panel (they are the measured
  // truth of that release). Same release → the store stands, calibrations
  // included.
  if (!file || (shipped !== undefined && file.catalogVersion !== shipped)) {
    const seeded = seedFromCatalog(shipped ?? "unknown");
    try {
      writeCalibrationFile(seeded);
    } catch {
      // keep in-memory even if the disk write fails
    }
    currentFile = seeded;
    effectiveCache = applyCalibration(MODELS, seeded);
    return;
  }

  // Same release: add catalog models missing from the store (new models
  // added by an update get their shipped rates).
  const missing = MODELS.filter((m) => !file.models[m.id]);
  if (missing.length > 0) {
    for (const m of missing) {
      file.models[m.id] = {
        input: m.cost.input,
        output: m.cost.output,
        cacheRead: m.cost.cacheRead,
        calibratedAt: file.calibratedAt || new Date().toISOString(),
      };
    }
    try {
      writeCalibrationFile(file);
    } catch {
      // in-memory still correct for this session
    }
  }
  currentFile = file;
  effectiveCache = applyCalibration(MODELS, file);
}

/** Static catalog with calibration overrides applied (cached per process). */
export function getEffectiveModels(): ClinePassModel[] {
  loadOnce();
  return effectiveCache!;
}

/** The calibration file backing the current effective models, if any. */
export function currentCalibration(): CalibrationFile | undefined {
  loadOnce();
  return currentFile;
}

/** Drop the process cache so a fresh calibration file takes effect now. */
export function refreshEffectiveModels(): void {
  effectiveCache = undefined;
  currentFile = undefined;
}

/** The shipped release this extension came from (its own package.json). */
function shippedVersion(): string | undefined {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      version?: string;
    };
    return typeof pkg.version === "string" ? pkg.version : undefined;
  } catch {
    return undefined;
  }
}

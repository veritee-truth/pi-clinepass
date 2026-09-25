# Changelog

All notable changes to this project will be documented in this file.
Entries above 0.1.6 track upstream pi-clinepass; the OMP fork's own adaptation
notes are marked separately. Fork entries (`-omp`) lead, newest first, followed
by the upstream entries they absorbed.

## 0.1.6-omp - 2026-09-25

OMP fork rebased onto upstream 0.1.6 (`33f3e23`); the upstream entry below lists
what 0.1.6 itself changed. The adaptation was replayed onto the new tree, and
the fork's own delta is identical in shape to 0.1.5-omp (15 files, +523/-212
against upstream), so nothing adapted was lost in the rebase.

What lands on OMP specifically:

- Free-route identifying headers now carry Cline CLI **3.0.65** (was 3.0.61)
  plus the updated header convention. Verified live on OMP 18.1.0: both free
  models carry the full set, paid models carry none, and a free-route
  completion through `cline-free/deepseek-v4.1-flash` succeeded — a stale
  client version is what the gateway's "Cline product surfaces" gate rejects
  with 403.
- Catalog 21 -> 17 models: retired models (including `cline-free/longcat-2.0`,
  `solar-pro4`, `z-ai/glm-5.3-flash`) no longer register, so they cannot be
  selected into a 404. New: `cline-free/gemini-3.8-flash` (mandatory
  low/medium/high reasoning), `cline-free/deepseek-v4.1-flash`,
  `cline-free/mimo-v2.6-flash`, `stealth/space-bunny-alpha`, and paid
  `cline-pass/muse-spark-1.3-contributor`.
- Errors: a gateway 402/404/5xx or an upstream provider payload is no longer
  reported as `auth_expired`. The old classification could feed a false expiry
  into OMP's AuthStorage refresh path.
- `src/index.ts` file header rewritten: it still described pi's hook set
  (`before_provider_headers`, `model_select`) and pi's price-store path, neither
  of which this fork uses.

Gates: `tsc --noEmit` clean against pinned `@oh-my-pi/*` 18.1.16; vitest 111/111
(9 files); live OMP 18.1.0 smoke — 17 clinepass models register, 0.1.6-only
models resolve, retired models do not, `hasConcreteAuth("clinepass")` true; real
completions through one free and one paid 0.1.6-only model.

## 0.1.5-omp - 2026-09-13

OMP fork rebased onto upstream 0.1.5 (from 0.1.1). Everything upstream released
in 0.1.2–0.1.5 is now included: the `/clinepass` dashboard and price
calibration (measured gateway billing), thinking-stream repair, corrected model
input modalities, the `cline-free/longcat-2.0` / `solar-pro4` /
`muse-spark-1.3-contributor` free models, `cline-pass/glm-5.3-flash`, and
`cline-pass/deepseek-v4.1-flash`.

OMP-specific adaptation:

- Credential source is OMP's own `AuthStorage` (`~/.omp/agent`), not pi's
  `auth.json`; rotated refresh tokens are written back through AuthStorage.
- Calibrated prices live in OMP's agent directory, so the two harnesses no
  longer share (and reset) one store.
- Thinking repair runs on OMP's `context` hook (OMP discards `message_end`
  return values).
- Free-route identifying headers are baked into the model configs at
  registration (OMP has no `before_provider_headers` event).
- Removed the `model_select` handler and the pi `settings.json` write.
- OAuth login uses `onAuth` / `onPrompt`; modal views use `overlayOptions`
  instead of an overlay-handle `focus()` call (absent on OMP's handle).

## 0.1.6 - 2026-09-25

- New free models: `cline-free/gemini-3.8-flash` (mandatory low/medium/high reasoning), `stealth/space-bunny-alpha`, `cline-free/mimo-v2.6-flash`, and `cline-free/deepseek-v4.1-flash`
- New paid model: `cline-pass/muse-spark-1.3-contributor` ($0.10/$0.20/$0.01)
- Retired models removed from catalog
- Error classification refined: upstream provider errors, 402 (insufficient credits), 404 (model not found), and 5xx gateway errors no longer misclassified as expired auth
- Free-route client headers updated to latest CLI convention

## 0.1.4 - 2026-09-09

- New free model: `cline-free/solar-pro4` and `cline-free/muse-spark-1.3-contributor`

## 0.1.3 - 2026-08-31

- Corrected model input modalities: `glm-5.3` and `deepseek-v4-flash` are text-only, `mimo-v2.5` and `qwen3.8-max` accept images

## 0.1.2 - 2026-08-30

- New paid model: `cline-pass/glm-5.3-flash` ($0.15/$0.50/$0.03)
- New free model: `cline-free/longcat-2.0`
- Model picker shows prices
- Price calibration via `/clinepass` measures real billing and updates the whole panel; fatal errors abort the run
- `/clinepass` runs in a centered modal: dashboard (prices, plan sidebar) and calibration (live per-model progress, esc-esc cancel)
- Prices stored in `clinepass-prices.json`, seeded on install, synced per release
- Gateway thinking-stream corruption repaired
- pi's built-in cost estimate off for ClinePass (the footer meter is the single cost display, turn cost includes every tool-calling round)
- Free-route headers applied to every free model
- 403 on free routes classified as route gate, not subscription

## 0.1.1 - 2026-08-27

- Catalog: `stealth/ox-alpha` is now `z-ai/glm-5.3-flash` (renamed)
- Context capped to 921600 for 1M models to avoid gateway edge
- Max output capped to 131072 for code-friendly limits
- Inputs updated per modalities (image where supported)
- Thinking levels mapped per model spec
- Prices adjusted to latest measured rates

## 0.1.0 - 2026-08-26

- Initial release
- 16 models (13 paid, 3 free)
- Server-truth billing meter and plan report
- Login via Cline CLI, browser, or API key

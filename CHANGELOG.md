# Changelog

All notable changes to this project will be documented in this file.
Entries above 0.1.5 track upstream pi-clinepass; the OMP fork's own adaptation
notes are marked separately.

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

## 0.1.5 - 2026-09-12

- New paid model: `cline-pass/deepseek-v4.1-flash` (measured rates pending calibration)

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

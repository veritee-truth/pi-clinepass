# pi-clinepass-omp — OMP Compatibility Gaps

> Fork of [pi-clinepass](https://github.com/fifidayone/pi-clinepass) adapted for
> [Oh My Pi](https://github.com/can1357/oh-my-pi) (OMP).
>
> Tracking upstream **v0.1.5**. Verified against OMP 18.1.0 (bundled runtime) and
> `@oh-my-pi/*` 18.1.16 (plugin dependency resolution).

## Gaps vs Upstream pi-clinepass

### Missing event: `before_provider_headers`

| Aspect | Detail |
|--------|--------|
| **What it did** | Injected Cline-CLI identifying headers (`x-client-type`, `x-client-version`, `x-core-version`, `x-platform`, `user-agent`) into the free-route requests at runtime. |
| **Why OMP lacks it** | OMP's extension API has no `before_provider_headers` event. Its `before_provider_request` exists but exposes only the request **body** (`payload: unknown`) — the returned value replaces the payload, so HTTP headers cannot be added there. |
| **OMP workaround** | Headers are baked into each free model's `ProviderModelConfig.headers` at registration (`providerModelsWithFreeHeaders`). |
| **Limitation** | The Cline CLI version is read once, at registration. `session_start` pre-warms the cache, so the first session after a version bump already carries the live value; a version published mid-session applies at the next launch (upstream applied it per request). |

### Missing event: `model_select`

| Aspect | Detail |
|--------|--------|
| **What it did** | Persisted the selected model as the harness's global default and triggered the initial billing meter on every model switch. |
| **Why OMP lacks it** | OMP's extension API has no `model_select` event. |
| **OMP workaround** | None needed for the meter: it runs on `session_start` and after each turn. Model persistence is dropped outright — upstream wrote `~/.pi/agent/settings.json`, and an OMP session writing pi's settings would let two harnesses fight over one default. OMP owns its own model selection. |

### Changed: `message_end` cannot return a repaired message

| Aspect | Detail |
|--------|--------|
| **What changed** | Upstream repairs gateway-corrupted thinking in `message_end` and returns the repaired message for the harness to persist. |
| **Why OMP differs** | OMP's `ExtensionAPI.on("message_end", …)` is typed with no result, and `ExtensionRunner.emit()` discards return values for that event — only session-before / `session.compacting` / `session_stop` results are consumed. |
| **OMP workaround** | The repair runs on OMP's `context` event instead, which **does** honor a returned `{ messages }` array and fires immediately before each provider request. This covers the cost the repair exists to prevent (a token-joined thinking block replayed into the request context and re-billed as inflated input tokens on every later turn). |
| **Limitation** | The persisted transcript keeps the unrepaired text; only what is sent to the provider is repaired. |

### Changed: credential store is `AuthStorage`, not `auth.json`

| Aspect | Detail |
|--------|--------|
| **What changed** | Upstream reads and writes the `clinepass` credential in pi's `~/.pi/agent/auth.json`. |
| **Why OMP differs** | OMP keeps credentials in its own SQLite-backed `AuthStorage` under OMP's agent directory. |
| **OMP workaround** | The extension binds `ctx.modelRegistry.authStorage` once (on `session_start`) as the meter's credential source: `getOAuthCredential("clinepass")` to read, `set(...)` to write rotated tokens back (AuthStorage owns cross-process locking). A pi-style `auth.json` read remains only as a standalone fallback for tests and direct library use. |

### Changed: calibration store path

| Aspect | Detail |
|--------|--------|
| **What changed** | Upstream persists calibrated prices to `~/.pi/agent/clinepass-prices.json`. |
| **Why OMP differs** | A shared file means both harnesses gate on one `catalogVersion`, so whichever updated last would reset the other's calibrated rates. |
| **OMP workaround** | The store lives at `<omp agent dir>/clinepass-prices.json`, resolved through OMP's own `getAgentDir()` (honors `PI_CONFIG_DIR`, profiles, XDG) and injected into `pricing.ts` by the entry point. `pricing.ts` stays free of the host import graph so pure unit tests need no Bun runtime. |

### Changed API: `OAuthLoginCallbacks`

| Aspect | Detail |
|--------|--------|
| **What changed** | Upstream's `OAuthLoginCallbacks` had `onDeviceCode()` and `onSelect()`. OMP's has `onAuth()`, `onPrompt()`, `onProgress()`, `onManualCodeInput()`. |
| **OMP workaround** | Device flow: `onDeviceCode({...})` → `onAuth({ url, instructions })` with the user code in the instructions text. Login chooser: `onSelect({ message, options })` → `onPrompt()`, rendering the option list as text and reading back an option id. |
| **Limitation** | Login is text-based: the user types `device` / `paste` / `reuse` instead of picking from a list. |

### Removed: `ProviderConfig.name` and `oauth.isSubscription`

Both fields exist upstream and are absent from OMP's `ProviderConfig` /
`OAuthProviderConfig`. Neither has behavioral impact: OMP takes the provider
display name from the registration key, and the subscription flag is unused.

### Changed: `refreshModels` → re-registration

Upstream declares `refreshModels: async () => providerModels()`, which pi calls
on model refresh. OMP's `ProviderConfig` has no such hook (`fetchDynamicModels`
is for a live catalog fetched from the provider endpoint, which ClinePass does
not expose). After calibration the extension re-calls
`pi.registerProvider(PROVIDER_NAME, providerConfig())`, which OMP applies
immediately — the picker shows the new prices without a `/reload`.

### Changed: overlay handle has no `focus()`

Upstream passes `onHandle: (handle) => handle.focus()` for its modal views. OMP's
`OverlayHandle` exposes only `hide` / `setHidden` / `isHidden`, and OMP's
`showOverlay` focuses the component itself. Passing `overlayOptions`
(`anchor: "center"`, `width: "100%"`, `maxHeight: "90%"`) reproduces upstream's
layout without the invalid call.

### Changed: `Context.systemPrompt` is `string[]`

OMP's `Context.systemPrompt` is `string[]` where upstream pi took a string, and
OMP's `Effort` is a `const enum` (nominally typed, so bare string literals do not
assign). The calibration probe adapts at both boundaries.

## Summary

| Gap | Impact | Fix difficulty |
|-----|--------|----------------|
| `before_provider_headers` → baked at registration | Free-route CLI version refreshes per launch, not per request | Low |
| `model_select` → dropped | Model selection not persisted by this plugin (OMP owns it) | None |
| `message_end` result dropped → `context` hook | Persisted transcript keeps unrepaired thinking; requests are repaired | Low |
| Credential store → `AuthStorage` | Requires an OMP session context (bound at `session_start`) | Low |
| Calibration path → OMP agent dir | Independent stores per harness | None |
| `OAuthLoginCallbacks` → text chooser | Login is less polished | Low |
| `ProviderConfig.name` / `oauth.isSubscription` removed | None | None |
| `refreshModels` → re-registration | None | None |
| Overlay `onHandle` → `overlayOptions` | None | None |
| `systemPrompt` / `Effort` typing | None | None |

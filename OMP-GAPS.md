# pi-clinepass-omp — OMP Compatibility Gaps

> Fork of [pi-clinepass](https://github.com/fifidayone/pi-clinepass) adapted for [Oh My Pi](https://github.com/oh-my-pi) (OMP).

## Gaps vs Upstream pi-clinepass

The following upstream features were modified or removed because OMP lacks the corresponding extension API hooks.

### Missing Event: `before_provider_headers`

| Aspect | Detail |
|--------|--------|
| **What it did** | Injected Cline-CLI identifying headers (`x-client-type`, `x-client-version`, `x-core-version`, `x-platform`, `user-agent`) into the free DeepSeek route's HTTP requests at runtime. |
| **Why OMP lacks it** | OMP's extension API has no `before_provider_headers` event. |
| **OMP workaround** | Headers are baked into the free DeepSeek model's `ProviderModelConfig.headers` at registration time (in `src/index.ts`). |
| **Limitation** | Headers are static at registration. The Cline CLI version is fetched once at `session_start` and cached, but newly fetched versions only apply after `/reload`. The version cache has a 24h TTL with a bundled fallback (`3.0.54`). Acceptable for prototype. |

### Missing Event: `model_select`

| Aspect | Detail |
|--------|--------|
| **What it did** | Persisted the selected model as pi's global default (`~/.pi/agent/settings.json`) and triggered the initial billing meter on every model switch. |
| **Why OMP lacks it** | OMP's extension API has no `model_select` event. |
| **OMP workaround** | `handleInitialMeter()` is still called on `session_start` (already existed). `savePiDefaultModel()` is called once at registration with a hardcoded default model (`cline-pass/deepseek-v4-flash`). |
| **Limitation** | Model selection is not persisted to OMP's config format (`~/.omp/agent/config.yml`). Model changes during a session won't update the default. The meter still shows on session start and after each turn. |

### Stale Config Path: `src/settings.ts`

| Aspect | Detail |
|--------|--------|
| **What it does** | Writes `defaultProvider` and `defaultModel` to `~/.pi/agent/settings.json` |
| **Why OMP is different** | OMP stores its config in `~/.omp/agent/config.yml` with a different schema. |
| **OMP workaround** | None — the write targets pi's path and is silently ignored by OMP. |
| **Limitation** | Best-effort save that does nothing in OMP. Model persistence is OMP's own concern. Non-critical for the prototype. |

### Changed API: `OAuthLoginCallbacks`

| Aspect | Detail |
|--------|--------|
| **What changed** | Upstream pi's `OAuthLoginCallbacks` had `onDeviceCode()` and `onSelect()` methods. OMP's version only has `onAuth()`, `onPrompt()`, `onProgress()`, and `onManualCodeInput()`. |
| **OMP workaround** | Device code flow: `onDeviceCode({...})` → `onAuth({ url, instructions })` with the user code embedded in instructions text. Login chooser: `onSelect({ message, options })` → `onPrompt({ message, placeholder })` with formatted option text. |
| **Limitation** | The login flow is text-based instead of using native selection UI. The user types the option id (e.g. `"device"`, `"paste"`) instead of selecting from a list. |

### Removed: `ProviderConfig.name`

| Aspect | Detail |
|--------|--------|
| **What changed** | Upstream pi's `ProviderConfig` accepted a `name` field. OMP's `ProviderConfig` has no `name` field on the top level. |
| **OMP workaround** | Removed `name: "ClinePass"` from the `registerProvider()` call. The provider name comes from the registration key (first argument). |

### Removed: `oauth.isSubscription`

| Aspect | Detail |
|--------|--------|
| **What changed** | Upstream pi's `oauth` config block accepted `isSubscription: boolean`. OMP's `OAuthProviderConfig` has no `isSubscription` field. |
| **OMP workaround** | Removed `isSubscription: true` from the OAuth config. The subscription flag is unused by OMP. |

## Summary

| Gap | Impact | Fix Difficulty |
|-----|--------|---------------|
| `before_provider_headers` → static headers | Free DeepSeek model may use stale headers until `/reload` | Low |
| `model_select` → registration-time save only | Model selection not persisted across sessions | Medium (needs OMP config.yml write) |
| `settings.ts` writes to `~/.pi/` | Harmless no-op in OMP | Low |
| `OAuthLoginCallbacks` → text-based chooser | Login flow is less polished | Low |
| `ProviderConfig.name` removed | No visible impact | None |
| `oauth.isSubscription` removed | No visible impact | None |
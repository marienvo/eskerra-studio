# Desktop startup theme

## Goals

- Before the webview paints, the shell should use the last-known theme (bundled or vault) and resolved light/dark mode when possible.
- The app must not persist a corrupted `startupTheme` entry (e.g. vault `themeId` with a bundled default payload) to `eskerra-desktop.json`.

## Data sources (in order)

1. **Rust init script** ([`apps/desktop/src-tauri/src/startup_theme.rs`](../../apps/desktop/src-tauri/src/startup_theme.rs)) runs before the window is shown. It reads `eskerra-desktop.json` (same logical store as the Tauri plugin store path) for `vaultRoot` and `startupTheme`, and reads `.eskerra/settings-shared.json` for `themePreference` when present.
2. If `themePreference` is missing from shared settings (e.g. R2-only theme preference after migration), Rust still resolves using the cached `startupTheme.preference` plus the vault path so vault theme files under `.eskerra/themes/<id>.json` can load before React.
3. **React** reads `window.__ESKERRA_STARTUP_THEME__` and may persist an updated snapshot after the UI has a consistent `preference` + `activeTheme` (see [`apps/desktop/src/theme/ThemeProvider.tsx`](../../apps/desktop/src/theme/ThemeProvider.tsx)). Persistence waits while a vault is open but shared settings are not yet loaded, or while R2-backed theme preference is still loading (`preferenceLoaded` is false), so `eskerra-desktop.json` is not written from a stale `initialPreference` or out-of-order `store.save()` completions. After first layout, [`useStartupWindowVisibility`](../../apps/desktop/src/theme/useStartupWindowVisibility.ts) (invoked from [`AppThemeShell`](../../apps/desktop/src/shell/AppThemeShell.tsx)) clears the startup theme DOM lock and shows the Tauri main window when applicable. [`useVaultThemes`](../../apps/desktop/src/theme/useVaultThemes.ts) keeps startup-seeded vault theme rows only until the first open vault load; after that, closing the vault clears the in-memory list so stale vault themes are not carried forward.

## Cache format

The `startupTheme` object in `eskerra-desktop.json` uses camelCase for nested fields (`themeId`, `resolvedMode`, `fileName`, `source`, …), matching the TypeScript `persistStartupThemeBootstrap` writer. Rust must parse cached vault themes with `source: "vault"` and `fileName` intact so the webview can seed vault theme definitions before `vaultRoot` is hydrated in React. For vault JSON files, Rust treats the `json` extension as ASCII case-insensitive when validating `fileName` and deriving the theme id stem (so mixed-case extensions still resolve).

## R2 theme preference

When the vault uses R2 for playlist/theme preference, the authoritative preference may live only in R2. Until the first successful remote read, the UI keeps the last-known preference from startup bootstrap (including `initialPreference` from the init script) instead of falling back to the product default.

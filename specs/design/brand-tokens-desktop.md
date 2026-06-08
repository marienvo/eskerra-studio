# Eskerra desktop brand tokens

Product logo files live in [`assets/brand/`](../../assets/brand/) (see that folder’s README).

Normative colors for the **desktop** shell (Tauri). Where these differ from [design-system-calm-editorial.md](design-system-calm-editorial.md), **this document is authoritative for the desktop app** implementation.

## Main window chrome background

The **primary** (main) window uses a full-bleed **SVG** layer (`AppChromeBackground` in [`apps/desktop/src/components/AppChromeBackground.tsx`](../../apps/desktop/src/components/AppChromeBackground.tsx)) that draws **1–30** organic ellipses from [`APP_CHROME_PALETTE`](../../apps/desktop/src/shell/appChromePalette.ts), merged with a **single** shared Gaussian blur (`feGaussianBlur`). For **two or more** colors, an **opaque** full-viewport `<rect>` filled with the **first** palette entry sits **under** the blurred group so blur fringes do not composite to transparency (the main window must not read as see-through under Tauri). One color yields a solid fill only. The HTML/body backdrop token `--color-app-chrome-backdrop` matches that first palette tone at build time; at runtime **`ThemeProvider`** may override `--color-app-chrome-backdrop` and `--color-app-chrome-chroma-2` from the active theme’s palette (see [themes-desktop.md](../architecture/themes-desktop.md)). **Title bar**, **status bar**, and **rail** use **transparent** backgrounds so the chrome gradient shows through. **`--color-app-chrome-surface`** is an opaque CSS `color-mix` of `backdrop` (85%) and white (15%) — the same white-mix pattern as **`--color-shell-tagline`** but anchored on the gradient base rect instead of chroma-2. Use it when a solid fill must read as the visible chrome behind transparent shell rows (for example the **filled** editor-toolbar pane toggles when a pane is open). **Panel gutters** show the same gradient because `.app-body`, `.main-column`, and `.main-stage` are transparent while `.panel-surface` keeps card surfaces. **Settings** is an in-app full-width page (same chrome); panel chrome still uses `brandSurfaceBright` where surfaces are opaque.

## Tokens

| Token | Value | Use |
| --- | --- | --- |
| `appChromeBackdrop` | `#031226` | HTML/`body` backdrop behind `.app-root` (`--color-app-chrome-backdrop`). Matches the first entry in `APP_CHROME_PALETTE` so startup does not flash the old flat gray. Update both when changing that palette anchor. |
| `--color-app-chrome-surface` | `color-mix(in srgb, var(--color-app-chrome-backdrop) 85%, white)` | Opaque approximation of visible chrome behind transparent shell rows; follows runtime `backdrop`. Editor-toolbar pane toggles use this as icon fill on the accent pressed tile. |
| `brandBackground` | `#f2f2f2` | **Reference** neutral for mixes and for contexts that still expect “gray shell” semantically (`--color-bg`, `--color-brand-bg`); the **main window** canvas is the blurred chrome layer, not this flat color. **Settings** webview root still uses this as the page fill. |
| `brandSurfaceBright` | `rgb(250, 250, 250)` (`#fafafa`) | Primary surfaces for resizable panels, editors, and modal bodies (`--color-surface`, capture/consume panel tokens, `--color-editor-bg`). Near-white so panels read slightly softer than pure white on the chrome gradient. |
| `interactiveText` | `rgb(203, 77, 73)` | **Vault-navigable** inline links in the capture editor (resolved wiki inner spans, resolved relative `.md` links) and other prose that must read as the same warm interactive tone (`--color-interactive-text`). **Do not** use for **`http` / `https` / `mailto`** link text in the editor—those use **`--color-accent`**. **Do not** use for filled buttons, block backgrounds, or broad UI chrome. |
| Accent (`--color-accent`, `--color-focus-ring`) | `#4fafe6` (see [`index.css`](../../apps/desktop/src/index.css)) | Controls, primary actions, focus rings, **structured table edit** selection outline / selected-row tint in the vault markdown table widget, and **browser-openable** vault-editor link text (`cm-md-external-link`, `cm-wiki-link--external`). |
| `--color-shell-status-error` | `var(--color-error)` | **Foreground** for **`AppStatusBar`** transient **error** chip text (same as `.error-banner` body). |
| `--color-shell-status-error-bg` | `var(--color-error-banner-bg)` | **Background** for the error chip (banner-light pill). |
| `--color-shell-status-error-border` | `var(--color-error-banner-border)` | **Border** for the error chip. |
| `--color-shell-status-info` | `var(--color-text)` | **Foreground** for **`AppStatusBar`** transient **info** chip text (same as `.info-banner` body). |
| `--color-shell-status-info-bg` | Same mix as `.info-banner` background (see [`index.css`](../../apps/desktop/src/index.css)) | **Background** for the info chip. |
| `--color-shell-status-info-border` | Same mix as `.info-banner` bottom border (see [`index.css`](../../apps/desktop/src/index.css)) | **Border** for the info chip. |
| `--font-sans` | `'Inter Variable', Inter, system-ui, …` | **UI and body** sans stack. **Inter Variable** is self-hosted from [`@fontsource-variable/inter`](https://www.npmjs.com/package/@fontsource-variable/inter) in [`main.tsx`](../../apps/desktop/src/main.tsx); it exposes **100–900** so every `font-weight` used in desktop CSS (including **620** / **650**) maps to a real axis value. Editor prose still prefers **Avenir** first when installed; it falls back through this stack. |

## Do not

- Do **not** use `interactiveText` for primary/secondary buttons or icon buttons; keep the existing accent / neutral button system.
- Do **not** use `interactiveText` for Eskerra structured table **widget** chrome (rail actions, in-document table mode marks) that should read as selected; use `--color-accent`. Table shell grid cells do not use a separate accent outline; focus uses normal editor styling.
- Do **not** substitute `interactiveText` for semantic states (error, recording, success); those keep semantic tokens.

## Implementation

Desktop maps these to CSS custom properties in [`apps/desktop/src/index.css`](../../apps/desktop/src/index.css): `--color-app-chrome-backdrop`, `--color-brand-bg`, `--color-brand-surface-bright`, `--color-interactive-text`, etc.

**Shell layout (main window):** `.app-root` is transparent; the **chrome gradient** is `AppChromeBackground`. Gutter areas use transparency so the gradient shows **between** near-white **panels** (`brandSurfaceBright` on `.panel-surface`). `--color-bg` / `--color-brand-bg` remain the **semantic** neutral for color-mix and for UI that is not yet transparent (for example the **settings** window root). The **active** rail tab uses the accent color so it reads as selected.

**Status bar** transient messages render as a **centered pill** (opaque background + border + shadow) using `--color-shell-status-*` tokens so they match **`.error-banner`** / **`.info-banner`** semantics while sitting on the blurred chrome. Do not use bare shell tagline colors for these messages.

import {calmEditorial} from '../calmEditorial.ts';
import {desktopBrand} from '../desktopBrand.ts';
import {vaultReadonlyLinks} from '../vaultReadonlyLinks.ts';

/**
 * Emits the desktop `:root { ... }` block (single source for drift tests).
 * Values mirror apps/desktop/src/index.css; calm editorial + brand anchors from TS.
 */
export function buildDesktopRootCss(): string {
  const c = calmEditorial;
  const b = desktopBrand;
  const v = vaultReadonlyLinks;

  return `/* AUTO-GENERATED from @eskerra/tokens — do not edit. Run: npm run generate -w @eskerra/tokens */
/* Calm Editorial + desktop brand: specs/design/design-system-calm-editorial.md, brand-tokens-desktop.md */
:root {
  /* Inter Variable (100–900) via @fontsource-variable/inter; matches weights used in App.css (200–700). */
  --font-sans: 'Inter Variable', Inter, system-ui, 'Segoe UI', Roboto, sans-serif;
  font-family: var(--font-sans);
  line-height: 1.45;

  /* Deepest tone of the main-window chrome gradient; HTML backdrop + preload flash (see AppChromeBackground). */
  --color-app-chrome-backdrop: ${b.appChromeBackdrop};
  /* APP_CHROME_PALETTE[1] ("color 2" in the chroma strip); keep in sync with appChromePalette.ts */
  --color-app-chrome-chroma-2: ${b.appChromeChroma2};

  /* Brand (desktop) — see specs/design/brand-tokens-desktop.md */
  /* Shell: soft gray; panels use bright surface (inverted vs. earlier soft-white shell + gray panels). */
  --color-brand-bg: ${b.brandBackground};
  --color-brand-surface-bright: ${b.brandSurfaceBright};
  --color-interactive-text: ${b.interactiveText};

  /*
   * Vault read-only markdown (wiki + browser links). Light = current editor surfaces; *-on-dark for
   * dark reader / future dark editor — specs/design/vault-readonly-link-colors.md
   */
  --color-vault-readonly-link-internal: ${v.light.internalNote};
  --color-vault-readonly-link-external: ${v.light.externalSite};
  --color-vault-readonly-link-internal-on-dark: ${v.dark.internalNote};
  --color-vault-readonly-link-external-on-dark: ${v.dark.externalSite};

  /* Foundation — app shell uses soft gray; panels use near-white surfaces */
  --color-bg: var(--color-brand-bg);
  --color-surface: ${b.brandSurfaceBright};
  --color-text: #111418;
  --color-muted: #66707a;
  --color-border: #e2e0e0;
  --color-border-soft: color-mix(in srgb, var(--color-text) 8%, transparent);

  /* Accent (controls, primary actions); calm editorial accent ${c.accent} → desktop uses lowercase hex */
  --color-accent: #4fafe6;
  --color-primary: #4fafe6;
  --color-primary-border: #338fc4;
  --color-primary-fg: #0f1418;
  --color-accent-subtle-bg: #e8f5fc;

  /* Editor */
  --color-editor-bg: ${b.brandSurfaceBright};
  --color-editor-text: #111418;
  /* Markdown \`==highlight==\` and vault search query marks; same highlighter yellow everywhere. */
  --color-markdown-highlight-bg: #fff59d;

  /* Window chrome (frameless webview edge): 50% black over app chrome (.app-root::after; see App.css). */
  --color-window-border: color-mix(in srgb, #000000 15%, transparent);
  --color-window-border-floating: var(--color-window-border);
  --window-radius: 8px;

  /* Chrome (rail strip uses shell background — no separate rail fill) */
  --color-rail: var(--color-brand-bg);
  --color-titlebar-bg: #e0e0e2;
  --color-titlebar-border: #d0d0d0;
  --color-titlebar-hover: rgba(17, 20, 24, 0.06);

  /*
   * Frameless shell (rail, title bar, status bar) sits on dark AppChromeBackground.
   * Use light foregrounds so default / hover / disabled read clearly — not body --color-muted.
   */
  --color-shell-icon: rgba(255, 255, 255, 0.92);
  --color-shell-icon-muted: rgba(255, 255, 255, 0.68);
  --color-shell-icon-disabled: rgba(255, 255, 255, 0.4);
  --color-shell-hover-bg: rgba(255, 255, 255, 0.12);
  /* Opaque: chroma 2 tinted toward white (not translucent gray-on-gradient) */
  --color-shell-tagline: color-mix(in srgb, var(--color-app-chrome-chroma-2) 15%, white);
  /*
   * Opaque approximation of visible AppChromeBackground behind transparent shell rows
   * (editor toolbar, title bar gutter, etc.). Same white-mix pattern as --color-shell-tagline
   * but anchored on backdrop (gradient base rect) instead of chroma-2.
   */
  --color-app-chrome-surface: color-mix(in srgb, var(--color-app-chrome-backdrop) 85%, white);
  /* Pressed shell icon buttons: mostly white with a hint of palette[0] (inverse of chrome-surface). */
  --color-app-chrome-active-fill: color-mix(in srgb, var(--color-app-chrome-backdrop) 15%, white);

  /* Capture */
  --color-capture-panel: ${b.brandSurfaceBright};
  /* Pane title bars / footers: darker gray than white panel body */
  --color-pane-chrome: #e6e6e6;
  --color-capture-chrome: var(--color-pane-chrome);
  --color-capture-border: #d6d6d6;
  /* Editor toolbar icon tiles: opaque hover (no alpha wash); pairs with inbox badge ring on hover. */
  --color-editor-toolbar-icon-hover-bg: #d0d0d0;

  --color-titlebar-close-hover: #e53935;
  --color-titlebar-close-fg: #ffffff;

  /* Danger / errors */
  --color-danger: #a23f3f;
  --color-error: #a23f3f;
  --color-error-banner-bg: #fdeeee;
  --color-error-banner-border: #ebcaca;

  /*
   * AppStatusBar transient message chips: same semantics as .error-banner / .info-banner (opaque pill on chrome).
   */
  --color-shell-status-error-bg: var(--color-error-banner-bg);
  --color-shell-status-error-border: var(--color-error-banner-border);
  --color-shell-status-error: var(--color-error);
  --color-shell-status-info-bg: color-mix(in srgb, var(--color-accent-subtle-bg) 70%, var(--color-bg));
  --color-shell-status-info-border: color-mix(in srgb, var(--color-accent) 25%, var(--color-border));
  --color-shell-status-info: var(--color-text);

  /* Semantic — calm editorial */
  --color-semantic-recording: ${c.semanticRecording};
  --color-semantic-success: ${c.semanticSuccess};
  --color-semantic-warning: ${c.semanticWarning};
  --color-semantic-draft: #6f7780;

  /* Focus */
  --color-focus-ring: #4fafe6;

  /* Consume surface */
  --color-consume-surface: ${b.brandSurfaceBright};
  --color-consume-inner: #f7f7f7;
  --color-consume-border: #d8d8d8;
  --color-consume-hover: #e4e4e4;
  --color-consume-chrome: var(--color-pane-chrome);
  --color-consume-text: #0f1418;
  --color-consume-muted: #5d6873;

  /* Capture: list/button hover */
  --color-row-hover: #e8e8e8;
  /* IDE-style tree selection (subtle; works on light surfaces). */
  --color-vault-tree-row-selected: color-mix(in srgb, var(--color-text) 8%, var(--color-surface));

  /* Vault tree rows + editor open-tab pills + workspace pane titles: shared type typography (kept in sync). */
  --file-tree-node-font-size: 13px;
  --file-tree-node-font-weight: 400;
  --file-tree-node-font-weight-emphasis: 500;
  /* Semibold: pane titles (Vault / Episodes / Notifications); use when 500 is too light. */
  --file-tree-node-font-weight-semibold: 600;
  --file-tree-node-font-family: var(--font-sans);
  --file-tree-icon-label-gap: 6px;
  --color-button-secondary-bg: #eef0f2;

  /* Borderless icon controls (pane headers, toolbars): neutral gray wash on hover */
  --color-icon-ghost-hover-bg: color-mix(in srgb, var(--color-text) 16%, transparent);

  /* Resizable panel groups: gutter shows --color-bg at pane edges */
  --panel-grid-gap: 8px;
  --panel-grid-padding: 5px;
  /* Title bar row height (tab pills + window controls share --window-title-bar-chrome-height). */
  --window-title-bar-height: 22px;
  /* Today hub workspace strip height: match editor tab pill vertical chrome (~15px icon + padding + border). */
  --window-title-bar-chrome-height: 22px;
  /* Space between items in the title bar leading strip (e.g. multiple controls beside workspace select). */
  --window-title-bar-vault-workspace-gap: 4px;
  /* Status bar icon tiles (Settings). */
  --app-shell-icon-tile-size: 1.65rem;
  /* Legacy width token (shell layout); editor toolbar holds Vault / Episodes toggles. */
  --desktop-leading-track-width: calc(
    var(--panel-grid-padding) + var(--app-shell-icon-tile-size) + 0.34rem + 0.2rem
  );

  color: var(--color-text);
  background: var(--color-app-chrome-backdrop);
}
`;
}

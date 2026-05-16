# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Agent skills** for this repo live under [`.cursor/skills/`](.cursor/skills/) (see [`README.md`](.cursor/skills/README.md) there). `.claude/skills` symlinks to that directory so there is a single copy to maintain.

## Commands

Run from repo root (npm workspaces — deps are hoisted):

```bash
npm install                          # install all workspace deps
npm test                             # run all tests (Vitest + Jest + scripts)
npm run lint                         # ESLint for mobile + desktop
npm run desktop                      # start Tauri dev (Vite + native window)
npm run mobile                       # start Metro for Android dev
npm run mobile:android               # build + run on device/emulator
npm run desktop:build                # semver bump + production RPM build
npm run storybook:desktop            # desktop DS Storybook (port 6006)
npm run test:storybook-web           # Playwright tests against RN-Web Storybook
```

Per-workspace (use `-w <name>`):

```bash
npm run apk -w mobile                # debug APK
npm run apk-release -w mobile        # release APK
npm run desktop:dev -w @eskerra/ds-desktop   # desktop DS dev server
```

Run a single Vitest test file:

```bash
npx vitest run packages/eskerra-core/src/some.test.ts
npx vitest run apps/desktop/src/some.test.ts
```

Run a single Jest test (mobile):

```bash
cd apps/mobile && npx jest src/path/to/test.test.ts
```

## Architecture

**Eskerra** is a Markdown notes + podcast companion. The vault is a user-selected directory shared across devices (e.g., via Syncthing); optional Cloudflare R2 provides playlist cloud backup. No backend, no sync service.

**Vault layout:**
- `Inbox/` — user `.md` notes (source of truth from directory listing)
- `General/` — podcast feeds (`YYYY [Label] - podcasts.md`) and episode cache (`📻 [Title].md`)
- `.eskerra/settings-shared.json` — vault-scoped settings, synced across devices
- `.eskerra/settings-local.json` — per-device identity, not synced
- `.eskerra/playlist.json` — playback state; R2 is authoritative when configured

**Two apps, one vault contract:**

| | Mobile (`apps/mobile/`) | Desktop (`apps/desktop/`) |
|---|---|---|
| Framework | React Native (Android only, iOS never) | Tauri 2 + Vite + React |
| File access | Android SAF via `react-native-saf-x` | Direct POSIX via Tauri Rust commands |
| Search | SQLite FTS5 (Kotlin) | Tantivy (Rust) |
| Audio | `react-native-track-player` | `HTMLAudioElement` + MPRIS (Linux) |
| Editor | — | CodeMirror 6 |

**Monorepo packages:**
- `packages/eskerra-core/` — shared TypeScript vault types, `VaultFilesystem` interface, settings parsing (no React)
- `packages/eskerra-tokens/` — design token generator (no React; generates CSS)
- `packages/eskerra-ds-desktop/` — desktop design system primitives (L2; no business logic)
- `packages/eskerra-ds-mobile/` — mobile design system via Gluestack (L2; no business logic)

**Layer model:**
- **L1** (`@eskerra/tokens`): values and generators only
- **L2** (`@eskerra/ds-desktop`, `@eskerra/ds-mobile`): product-agnostic primitives (Surface, Text, Button…)
- **L3** (`apps/*/src/`): product features that compose L2 components

Both apps implement the `VaultFilesystem` interface from `@eskerra/core`, so feature code is platform-agnostic.

## Language and style

- Write all identifiers, comments, commit messages, and specs in **US English** (color, organization, behavior).
- Default to **TypeScript** for all new code. Use Python or Go only when constraints require it.
- Keep language choices consistent within each module.

## Platform targets

- **Mobile: Android only.** iOS is not supported and never planned. Do not propose iOS work, App Store steps, or iOS-driven cross-platform compromises.
- **Desktop: Linux (Fedora Workstation / GNOME reference environment).** Future direction; not part of the mobile MVP unless a task explicitly says otherwise.
- When unsure, prefer Android-specific solutions and defer hypothetical multi-mobile portability.

## Quality gate

After each change set, run the relevant test, lint, and type-check commands. Resolve all errors before considering work complete. Do not leave known failing quality checks on a branch.

## Spec discipline

Document facts that cannot be reliably inferred from the code in spec files (`specs/`). Capture concrete business rules, external constraints, assumptions, and architectural decisions. Keep specs synchronized with implementation changes.

## Key invariants

**Startup performance:** First screen render is the sacred path. Defer all vault scans, feed refreshes, markdown parsing, and indexing until after first render. Use last-known cached state for first paint, then refresh in background. Nothing expensive runs on startup.

**Playlist merge (multi-device):** Higher `controlRevision` wins. If tied, higher `updatedAt` wins. If tied, remote wins. R2 is authoritative; `.eskerra/playlist.json` is the offline fallback.

**Releases:** Semver is canonical in `apps/mobile/package.json`. The bump script (`scripts/bump-release-version.mjs`) syncs desktop Vite splash, Tauri config, `Cargo.toml`, and `metainfo.xml`. CI checks alignment.

## TypeScript vs. Kotlin boundary (mobile)

Default to TypeScript. Use Kotlin only when at least one is true:
- Depends on Android platform APIs, SAF, or other Android-specific file APIs
- Performs heavy file-system access, scans, or indexing
- Processes large numbers of files or large payloads
- Must run reliably in the background on Android
- Involves media playback, audio session integration, or native media
- Is on a performance-critical path and TypeScript is **measurably** too slow

Before proposing Kotlin, first consider: deferring the work, caching the result, doing less work, reducing frequency, limiting the data set, lazy loading, or a simpler TypeScript implementation.

When proposing a new dependency, provider, startup initialization, background process, native module, persistent cache, file scan, or TypeScript→Kotlin migration, state: (1) why it is needed, (2) whether it is on the startup path, (3) whether it can be deferred, (4) why TypeScript is enough or Kotlin is justified, (5) the performance risk, (6) how it should be measured.

## Testing

- Add tests wherever they provide meaningful confidence for behavior, regressions, and edge cases. When fixing a bug, add or update a test that proves the fix.
- Match tools to language: **Vitest** for TypeScript/desktop, **Jest** for React Native, **Playwright** for Storybook.
- Failing tests are blockers. All relevant tests must pass before a change is done.

### Desktop Vitest isolation (`apps/desktop/`)

Authoritative detail: `specs/adrs/001-adr-vitest-desktop-test-isolation.md`.

- `vitest.setup.ts` runs RTL `cleanup()` in `afterEach`; restores real timers; calls `vi.unstubAllGlobals()` / `unstubAllEnvs()`; clears `localStorage` / `sessionStorage` / `document.body`; clears cookies in `beforeEach`.
- Keep **`restoreMocks: false`** in `vitest.config.ts`. `restoreMocks: true` resets `vi.mock()` factories and breaks module mocks (e.g., `@tauri-apps/plugin-store`). Use `clearMocks: true` only; use `vi.spyOn(...).mockRestore()` inside a test file when you need the real implementation back.
- Keep **`isolate: true`** — ESLint flags `isolate: false`.
- **Do not import Tauri in `vitest.setup.ts`.** `setupFiles` run before test files; importing a module that loads `@tauri-apps/*` at module scope binds the real Tauri client before `vi.mock(...)` runs. Safe to import in setup: modules with no Tauri at top level (e.g., `artworkCacheDesktop`, `cleanNoteMarkdown`, `desktopMediaSessionDom`, `editorWorkspaceTabs`). Not safe: modules wired to `invoke` or `plugin-store` (e.g., `emojiUsageStore`, `rssFeedUrlCacheDesktop`) — reset these from `beforeEach`/`afterEach` in individual test files.
- New module-scoped mutable state must export `__resetForTests()`. Add it to `vitest.setup.ts` `afterEach` only if the module has no top-level Tauri import; otherwise document and reset per-file.
- Tests that construct CodeMirror views must call `EditorView.destroy()` in the same test or `afterEach`.

## Design system

Authoritative architecture: `specs/design/design-system-architecture.md`.

- **L1 `@eskerra/tokens`** — values and generators only; no React.
- **L2 `@eskerra/ds-desktop` / `@eskerra/ds-mobile`** — product-agnostic primitives; no vault/inbox/episode naming; no business logic.
- **L3** — `apps/desktop/src/shell`, `apps/mobile/src/features`; composes DS + product state.

Shell chrome (rail `TabButton`, pane headers, title bar, splits, editor toolbar, dialogs with product copy) stays in `apps/desktop/src/shell`, not in `@eskerra/ds-desktop`.

**Gluestack (`apps/mobile`):**
- Allowed: direct `@gluestack-ui/*` in `apps/mobile/src/features/**` only when no `@eskerra/ds-mobile` primitive exists yet.
- Required promotion: any control reused across 2+ features, or any token-bearing control (Button, Text, ListRow, Surface…), must move into `@eskerra/ds-mobile`.
- Forbidden: `@gluestack-ui/*` imports inside `packages/eskerra-ds-mobile`. Forbidden: permanent wrappers that re-export Gluestack prop shapes as the Eskerra API.

**Import rule:** apps depend on `@eskerra/tokens`, `@eskerra/ds-desktop`, or `@eskerra/ds-mobile`; do not import one app's `src` from the other app's UI.

## Storybook

- **Desktop web:** stories under `packages/eskerra-ds-desktop` only.
- **Mobile:** on-device and RN-Web share the same story files under `packages/eskerra-ds-mobile`.
- **L2 contract stories** (`packages/eskerra-ds-*/**/__stories__/`): mandatory variants for interactive components (Default, Disabled, Loading, LongContent, focus/pressed, A11y); use `play` from `storybook/test` to assert behavior. Static reference stories (token palettes, icon inventories, typography specimens) go under `__stories__/reference/`, tagged `reference`/`docs-only`, no `play` required.
- **L3 sandbox stories** (`apps/*/src/**/__sandbox__/*.stories.tsx`): tag `sandbox`; `play` not required; not in official docs publish set.
- Stories that depend on Reanimated, gesture-handler, or other native-only behavior: tag `native-only`.
- No product compositions (`EditorWorkspaceToolbar`, vault trees…) as L2 contract stories — use L3 sandbox if needed.

**When to add or update stories:** When you modify existing React components or add new presentational components under `apps/` or `packages/eskerra-ds-*`, decide whether Storybook coverage is needed and do it in the same change (or state in one sentence why not). Exceptions: logic-only changes, minor styling tweaks where existing stories still represent the component, generated or third-party code.

## Mobile on-device verification

RN-Web Storybook is not a substitute for Android. Merge gates may use RN-Web + test-runner; release requires on-device validation for native-affecting changes.

Verify on a real device or emulator (not RN-Web alone) when touching:
- `react-native-reanimated`, `react-native-gesture-handler`, `react-native-keyboard-controller`
- `FlatList`, `FlashList`, large scroll performance
- `react-native-track-player`, audio focus, notifications
- `react-native-saf-x`, file pickers
- Fonts, safe area, TalkBack order, haptics, AMOLED appearance

## Desktop: Component CSS (L3)

- **New** UI in `apps/desktop/src/`: prefer **CSS Modules** (`*.module.css`). Policy: `specs/architecture/desktop-component-css.md`. Colocation, `App.css` boundaries, and exceptions: `.cursor/rules/css-colocation.mdc`.

## Desktop: CodeMirror layout

Applies to: `apps/desktop/src/**/*.css`, `apps/desktop/src/editor/noteEditor/**`.

- **Use `padding`, not `margin`**, for vertical spacing on elements whose height CodeMirror measures: `.cm-line` nodes, line decorations (e.g., `cm-md-*`), block widget roots (e.g., `cm-vault-image-preview`). CodeMirror's height map includes padding and border but excludes margin; margin-only spacing breaks click/selection coordinates below that content.
- Do not remove **`-webkit-font-smoothing: antialiased`** from the capture inbox `.cm-scroller` without re-testing on Linux (see `specs/design/desktop-text-rendering.md`, symptom 7).

Full rationale: `specs/architecture/desktop-editor.md` § "Vertical layout and click coordinates".

## Desktop: Note body cache

Applies to: `apps/desktop/**`.

- **`inboxContentByUri`** must stay aligned with the latest in-memory editor text before awaiting work that can change `selectedUri` (snapshot in `openMarkdownInEditor`), and after every successful `saveNoteMarkdown` in `enqueueInboxPersist` (including when `persistTransientMarkdownImages` rewrites markdown).
- **`lastPersistedRef`** must describe content that was written successfully (or read from disk for the current selection). Do not set it from a stale `inboxContentByUri` entry without reconciling with disk-known state.
- The `useLayoutEffect` on `selectedUri` in `apps/desktop/src/hooks/useMainWindowWorkspace.ts` restores CodeMirror from cache when present; if cache and `lastPersistedRef` disagree for the same URI, disk-known (`lastPersistedRef`) wins and the cache is healed (`resolveInboxCachedBodyForEditor` in `apps/desktop/src/hooks/inboxNoteBodyCache.ts`).
- Any new mutation path (bulk rewrite, external sync, etc.) must update or invalidate the cache entry for affected URIs.
- Primary ownership now lives in:
  - `apps/desktop/src/hooks/useInboxBodyCache.ts` (state + refs)
  - `apps/desktop/src/hooks/workspaceOpenMarkdownCommand.ts` (open/snapshot/prefetch mutations)
  - `apps/desktop/src/hooks/useDiskConflictState.ts` (disk-reload conflict path)
  - `apps/desktop/src/hooks/useMainWindowWorkspace.ts` (selectedUri restore + cache-heal effect)
- Prefer small pure helpers in `inboxNoteBodyCache.ts` for merge/heal logic; add Vitest coverage there when behavior changes.

Full detail: `specs/architecture/desktop-editor.md` § "lazy note bodies + cache consistency invariant".

## Desktop: Vault disk sync invariants

Applies to: `apps/desktop/src-tauri/src/vault_watch.rs`, `apps/desktop/src/hooks/useWorkspaceVaultWatchEffects.ts`, `apps/desktop/src/hooks/useDiskConflictState.ts`, `apps/desktop/src/hooks/useMergeViewState.ts`, `apps/desktop/src/hooks/useTodayHubsState.ts`, `apps/desktop/src/hooks/useMainWindowWorkspace.ts`, `apps/desktop/src/hooks/inboxNoteBodyCache.ts`, `apps/desktop/src/lib/vaultFilesChanged*`.

- Treat file/app sync as a **critical correctness surface**. Any change touching watcher events, reconcile routing, cache invalidation, `lastPersistedRef`, or conflict classification must include tests in the same change.
- `coarse` watcher events are fail-safe full-vault invalidation. They must never be treated as path-limited updates, even when payload `paths` is non-empty.
- Keep watcher latency bounded: debounce is allowed, but event batching must have a hard upper bound (target under 1 second end-to-end for detection + dispatch).
- Preserve observability on degradation: coarse invalidation and watcher degradation paths must emit Sentry warning telemetry (`captureObservabilityMessage`) with stable fingerprint + reason fields.
- Keep Sentry alerting active for coarse invalidation burst rate per watch session; if telemetry tags/fingerprints change, update `specs/observability/desktop-vault-watch-coarse-alert.md` in the same change.
- Do not remove or dilute existing reconcile safeguards without updating `specs/architecture/desktop-editor.md` and adding regression tests for selected-note reload/conflict behavior.

## Desktop: Editor interactive links

Applies to: `apps/desktop/src/editor/noteEditor/**`, `apps/desktop/src/App.css`.

In the vault capture markdown editor (`NoteMarkdownEditor` / table cell editors under `[data-app-surface='capture']`):

- Any range that opens or creates a vault note via click, Mod-click, or Mod-Enter must use the same interactive link presentation: wiki links (`cm-wiki-link` / `cm-wiki-link--resolved` / `cm-wiki-link--unresolved`; browser-openable wiki targets also use `cm-wiki-link--external` and `cm-md-external-link-glyph`), relative vault `.md` inline links (`cm-md-rel-link` / `cm-md-rel-link--resolved` / `cm-md-rel-link--unresolved`), and browser inline links (`cm-md-external-link` / `cm-md-external-href` / `cm-md-external-link-glyph` for `http`/`https`/`mailto`).
- **Hit testing must match styling.** Vault navigation and external link activation must not trigger from syntax-only characters (`[[` on wiki links; the gap between the two `]` of `]]`; Lezer `LinkMark` `[` `(` and closing `)`). For wiki links, Mod-Enter may use the caret slot at the first `]` of `]]`; pointer clicks use the inner span only. For inline links, the caret slot immediately before closing `]`/`)` does activate so Mod-Enter works after typing.
- Do not leave navigable label or URL text styled as normal body copy while a sibling segment is the only underlined link.

Full behavior: `specs/architecture/desktop-editor.md` § wiki links, WL-6 relative markdown links, and external browser links.

## Desktop: Shell UI

Applies to: `apps/desktop/**`.

Full detail: `specs/design/desktop-shell-patterns.md`.

**Resizable columns:** Main workspace (`MainWorkspaceSplit`) always uses `DesktopHorizontalSplit` with the center workspace (markdown editor) as `centerWorkspace` (CSS `desktop-hsplit-center-workspace`). When both side panes are hidden, `leftCollapsed` keeps a 0px left column with no separator and `left: null` so CodeMirror is not reparented. When both Vault and Episodes are open, `DesktopVerticalSplit` stacks them in the left column (`vaultEpisodesStack.topHeightPx` in `layoutPanelsV4`). One main left column width persisted as `inbox.leftWidthPx` / `podcastsMain.leftWidthPx`; editor is `flex: 1`. Do not reintroduce `react-resizable-panels` for this main split without a spec update (caused visible 1px jitter on window resize). Persist widths and stack heights via `layoutStore` (`layoutPanelsV4`), including `notificationsInboxStack.topHeightPx`.

**Cursors:** Treat the desktop UI as a desktop app. Use `cursor: default` on buttons, rail tabs, list rows, and similar chrome. Do not use `cursor: pointer` for those. No `cursor: not-allowed` on disabled elements — keep `cursor: default` with existing opacity/color disabled styling. Exceptions: panel separators keep `col-resize`/`row-resize`; Today Hub read-only cell preview uses `cursor: text` (links inside use pointer from markdown token CSS).

## Mobile: Android SAF URI format

Android note URIs follow the convention `<treeUri>/<relative-path>` — the vault root tree URI with the file's relative path appended directly using `/`. Example:
- Vault root (tree URI): `content://com.android.externalstorage.documents/tree/primary%3Avault`
- Note URI: `content://com.android.externalstorage.documents/tree/primary%3Avault/Inbox/note.md`

This is **not** the standard Android SAF document URI format (`…/document/<encoded-docId>`). `react-native-saf-x` and the Kotlin `VaultListingModule` both use the direct-suffix convention. All POSIX path operations in `@eskerra/core` (`posixResolveRelativeToDirectory`, `tryAssertVaultMarkdownNoteUriForRelativeMarkdownLink`, etc.) rely on this structure, which is why `content://` scheme preservation matters there.

## Mobile: Markdown read mode

Three components render vault markdown on mobile (all use `react-native-markdown-display`):

| Component | Location | Rules used |
|---|---|---|
| `NoteContentView` | `apps/mobile/src/features/vault/components/` | `vaultRules` + `calloutRules` |
| `VaultReadonlyMarkdownBlock` | same directory | `vaultRules` + `calloutRules` |
| `NoteDetailScreen` | `apps/mobile/src/features/vault/screens/` | `calloutRules` only |

Custom rule factories:
- `createVaultReadonlyMarkdownRules` (`apps/mobile/src/features/vault/markdown/vaultReadonlyMarkdownRules.tsx`) — overrides `link`, `blocklink`, `table`, `th`, `td` with vault-aware handlers (internal note navigation, wiki link resolution, relative `.md` link resolution).
- `createCalloutMarkdownRules` (`…/markdown/calloutRule.tsx`) — renders Obsidian-style `> [!type]` callouts with per-color-mode surface colors.
- `preprocessVaultReadonlyMarkdownBody` (`…/markdown/vaultWikiLinkPreprocess.ts`) — converts `[[wiki]]` syntax to synthetic `eskerra-wiki:` links before the renderer sees the markdown.

**Color architecture:** Mobile is dark mode only. Markdown styling colors are computed inline in each render component — not from design tokens. The pattern is three local variables:
```ts
const markdownTextColor  = colorMode === 'dark' ? '#f5f5f5' : '#212121';
const markdownMutedColor = colorMode === 'dark' ? '#cfcfcf' : '#616161';
const markdownCodeBg     = colorMode === 'dark' ? 'rgba(255,255,255,0.08)' : '#f0f0f0';
const markdownCodeBorder = colorMode === 'dark' ? 'rgba(255,255,255,0.12)' : '#cccccc';
```
When adding new markdown style overrides, follow this pattern and apply them to all three render sites. The library (`react-native-markdown-display`) has light-background defaults for `code_block`, `code_inline`, and `fence` — always override `backgroundColor` and `borderColor` for those.

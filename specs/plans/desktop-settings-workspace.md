# Desktop Settings Workspace

## name

Desktop Settings Workspace — settings-as-a-tab with a synced settings document (`eskerra-app-settings`).

## overview

Replace the current full-page `SettingsPage` (which swaps out the entire main stage via `activePage: 'vault' | 'settings'`) with a **settings workspace tab** that opens in the editor tab strip like a note. All current settings surfaces (R2/sync, device identity, Themes, Properties) move into it, and the app's hardcoded per-vault values become real settings.

Settings storage follows the existing **theme-preference model**, generalized:

- **R2 authoritative** when configured: a single `app-settings.json` object with etag conditional writes and etag polling (same machinery as `theme-preference.json` / playlist).
- **Vault mirror fallback** when R2 is absent: the same document embedded in `.eskerra/settings-shared.json`, so Syncthing-only vaults still sync settings across devices.
- **Device-local values** (device name, instance id, playlist watermarks) stay in `.eskerra/settings-local.json`, unchanged.
- A **last-known cache** in the Tauri store provides instant first-paint values (startup invariant: nothing expensive on the startup path; settings resolve from cache first, refresh in background).

Desktop only. Mobile is out of scope for implementation, but the **schema** of vault-contract settings (folder/file name patterns) is defined as shared so mobile can adopt it later.

## non-goals

- Mobile implementation of any setting (schema compatibility only).
- Fully rebindable keymap (every CodeMirror binding). v1 ships a **curated action list** (decision: 2026-06-10).
- Per-window or per-workspace settings; everything is vault-scoped or device-scoped.
- Server-side auth for R2; credentials stay as they are today.
- Settings import/export UI (the document is plain JSON; manual editing remains possible).

## current state (inventory of what exists)

- `SettingsPage.tsx` + `SettingsContent.tsx` + `settings/ThemesTab.tsx` + `settings/PropertiesTab.tsx`, mounted full-screen by `AppMainStage` when `activePage === 'settings'`.
- `.eskerra/settings-shared.json` (`EskerraSettings` in `@eskerra/core`): `r2`, `themePreference` (fallback mirror), `frontmatterProperties`, `linkSnippetBlockedDomains`.
- `.eskerra/settings-local.json` (`EskerraLocalSettings`): `deviceName`, `displayName`, `deviceInstanceId`, playlist watermarks.
- Theme preference: R2 `theme-preference.json` authoritative (`r2ThemePreferenceObject.ts`, `r2ThemePreferenceConditional.ts`, `themePreferenceEtagPoller.ts`, `useDesktopThemePreferenceR2EtagPolling.ts`), mirrored into `settings-shared.json` when R2 is off.
- Editor tab strip: ordered list of normalized URI strings (`editorOpenTabs.ts`, `editorWorkspaceTabs.ts`), persisted via `mainWindowUiStore`.

## settings inventory and grouping

Section structure is the UX navigation (left nav inside the settings tab). Scope column: **vault** = synced settings document, **device** = per-device storage (`settings-local.json` for vault-bound identity; Tauri app store for vault-independent values such as shortcuts).

### 1. General

| Setting | Scope | Today |
|---|---|---|
| Vault nickname (label: "Vault nickname", helper: "Only on this device") | device | exists (`displayName`; UI label renamed — "Vault display name" suggested a vault-wide value) |
| Device name | device | exists (`deviceName`) |
| Change vault folder (action) | — | exists |
| Refresh settings from disk (action) | — | exists |

### 2. Appearance

| Setting | Scope | Today |
|---|---|---|
| Theme (theme id) | vault | exists (`ThemesTab`, R2 `theme-preference.json`) |
| Mode: light / dark / auto | vault | exists |

### 3. Editor

| Setting | Scope | Today (hardcoded) |
|---|---|---|
| Autosave debounce (ms) | vault | `INBOX_AUTOSAVE_DEBOUNCE_MS = 400` (`inboxAutosaveScheduler.ts`) |
| Rich link previews on/off | vault | always on |
| Link preview blocked domains | vault | exists (`linkSnippetBlockedDomains`) |
| Confetti when inbox cleared | vault | always on (`fireInboxClearedConfetti.ts`) |

### 4. Keyboard shortcuts (curated action registry)

All bindings below are currently hardcoded; each becomes a named action with a rebindable binding, a reset-to-default, and conflict detection within the registry.

**Scope: device** (decision 2026-06-10). Bindings are personal and keyboard-dependent, so they do not sync. They live in the **Tauri app store, vault-independent** — one keymap per install, applying to every vault opened on this device — not in `settings-local.json` (which sits inside the synced vault directory) and not in the synced document.

| Action id | Default | Defined in |
|---|---|---|
| `sync.manual` | Mod+S | `useAppMainWindowKeyboardEffects.ts` |
| `tabs.reopenClosed` | Mod+Shift+T | same |
| `note.clean` | Mod+E | same + `noteMarkdownCoreKeymap.ts` |
| `search.vault` | Mod+Shift+F | same |
| `quickOpen.open` | double-Shift | `doubleShiftKeySequence.ts` |
| `note.addEntry` | double-Ctrl | `doubleCtrlKeySequence.ts` |
| `editor.bold` / `editor.italic` | Mod+B / Mod+I | `noteMarkdownCoreKeymap.ts` |
| `editor.deleteLine` | Mod+Y | same |
| `editor.copyLineDown` | Mod+D | same |
| `editor.strikethrough` | Mod+Shift+X | same |
| `editor.insertDate` | Mod+Shift+D | same |
| `tabs.deleteNote` | (current binding) | `vaultTabDeleteNoteShortcut.ts` |
| Double-key window (ms) | 400 | `DOUBLE_SHIFT_WINDOW_MS` / `DOUBLE_CTRL_WINDOW_MS` |

Out of v1: structural editor keys (Tab list indent, auto-pairing, markdown syntax keys like `Shift-8`); these stay fixed. Shortcut labels in menus (`desktopShortcutLabels.ts`) must render from the registry, not hardcoded strings.

### 5. Vault layout (vault contract — shared schema)

These define the vault contract that mobile also relies on. They become **vault-scoped settings in the shared schema**; desktop honors them, mobile adopts later. Until mobile reads them, the UI shows a compatibility warning whenever a value differs from the default ("Mobile currently expects the default name").

**Changing these settings never renames or moves existing files in v1.** They only change where the app looks. The section UI states this verbatim next to every field, before the user pulls the lever expecting their folders to migrate.

| Setting | Scope | Today (hardcoded) |
|---|---|---|
| Notes folder | vault | `Inbox` (`INBOX_DIRECTORY_NAME`) |
| Podcasts/feeds folder | vault | `General` (`GENERAL_DIRECTORY_NAME`) |
| Assets folder / attachments subfolder | vault | `Assets` / `Attachments` |
| Hub note filename | vault | `Today.md` |
| Podcast feed file suffix | vault | `podcasts.md` (`podcastFileParser.ts`, `podcastRssSync.ts`) |
| Podcast episode file prefix | vault | `📻 ` |

Not configurable (kept as fixed contract): `.eskerra/` directory name, settings filenames, `playlist.json`, sync-conflict marker, `.md` extension, Today Hub row stem format `YYYY-MM-DD` (the calendar pipeline, reminders, and mobile all parse it; making it configurable buys little and risks data).

### 6. Cloud connection (bootstrap — not a normal synced setting)

R2 credentials cannot live in the R2-hosted document (bootstrap circularity); they stay in `.eskerra/settings-shared.json` exactly as today. Rather than letting that leak into the UI as "this one section behaves weirdly", the model and the UI treat it as a distinct concept:

- **Internal model:** `syncBootstrap.r2` (credentials + jurisdiction; vault file, read before any cloud access) vs. `syncBehavior.*` (ordinary synced settings in the app-settings document). Code never mixes the two: the bootstrap config is an input to the settings transport, not a member of the settings document.
- **UI:** its own nav section, **"Cloud connection"**, framed as connecting this vault to a cloud bucket ("stored in your vault folder, shared with every device that syncs the folder") — not as a preference. Save semantics are form-like (explicit Save button, validation of all-or-none fields), unlike the apply-on-change behavior of normal settings.

| Setting | Storage | Today |
|---|---|---|
| Cloudflare R2 endpoint, bucket, keys, jurisdiction | `.eskerra/settings-shared.json` (`r2` block) | exists (`SettingsContent`) |

### 7. Sync

Ordinary synced settings (`syncBehavior.git` in the document):

| Setting | Scope | Today |
|---|---|---|
| Git: remote name | vault | `origin` (`gitSyncConfig.ts`) |
| Git: include / exclude globs | vault | `['**/*.md']` / `[]` |
| Git: backup directory | vault | `_sync-backups` |
| Git: commit message template | vault | `chore: sync {timestamp} {host}` |
| Git: conflict callout on/off + template | vault | disabled |
| Git autosync on/off | vault | always on when repo present |
| Git autosync interval / retry delay / min change age | vault | 5 min / 30 s / 60 s (`useVaultGitAutosyncScheduler.ts`) |

### 8. Calendar

| Setting | Scope | Today |
|---|---|---|
| ICS default days ahead | vault | `DEFAULT_ICS_DAYS_AHEAD = 7` (`parseHubCalendarConfig.ts`) |
| ICS default fetch timeout | vault | `DEFAULT_ICS_TIMEOUT_MS = 8000` |

Per-hub frontmatter overrides keep winning over these defaults; the setting only changes the fallback. Caps (`MAX_ICS_DAYS_AHEAD` etc.) stay hardcoded.

### 9. Properties

Existing `PropertiesTab` (frontmatter property type overrides) moves in unchanged; its data (`frontmatterProperties`) migrates into the settings document.

## storage architecture

### document shape

New module in `@eskerra/core` (e.g. `appSettings.ts`):

```jsonc
// app-settings.json (R2 object) — also embedded as `appSettings` in settings-shared.json
{
  "version": 1,
  "appearance": { "themePreference": { "themeId": "eskerra-default", "mode": "auto" } },
  "editor": { "autosaveDebounceMs": 400, "linkPreviews": { "enabled": true, "blockedDomains": [] }, "inboxClearedConfetti": true },
  "vaultLayout": { "inboxDirectory": "Inbox" /* only non-default entries */ },
  "syncBehavior": { "git": { "remote": "origin", "autosync": { "enabled": true, "intervalMs": 300000 } } },
  "calendar": { "icsDaysAheadDefault": 7, "icsTimeoutMsDefault": 8000 },
  "frontmatterProperties": { }
}
```

Not in this document: shortcuts (device-scoped, Tauri app store) and the R2 connection (`syncBootstrap.r2`, vault file — see "Cloud connection").

Rules:

- **Sparse document**: only values that differ from defaults are written. Defaults live in code; adding a setting never requires a migration. The flip side: **changing an existing default is a behavior migration** — it silently changes behavior for every user without an override and must be reviewed deliberately (spec note + changelog entry), never slipped into an unrelated change.
- **Unknown keys are preserved** on read-modify-write (forward compatibility with newer app versions and future mobile writers).
- **Whole-document conditional writes**: `If-Match` etag on R2 (reuse the `r2ThemePreferenceConditional` pattern); on precondition failure, re-read, re-apply the user's single change, retry. The vault mirror uses plain file write (Syncthing conflict files are already handled by the `sync-conflict` marker convention).
- **Validation is per-key and lenient**: an invalid value falls back to the default for that key and is reported, never a thrown parse error for the whole document (unlike today's `parseEskerraSettings` throw-on-invalid; that function keeps its behavior for the R2 block).

### read/write flow (desktop)

1. **First paint**: resolve settings from the Tauri-store cache (last-known document). No disk/network on the startup path.
2. **Background refresh** after first render: R2 GET (when configured) or vault mirror read; update cache + React context.
3. **Polling**: extend or clone `themePreferenceEtagPoller` to poll `app-settings.json`'s etag; on change, re-fetch and apply (live cross-device updates, same UX as theme today). Without R2, the existing vault file watcher on `.eskerra/` covers external edits.
4. **Writes**: setter in the settings context → optimistic local apply → conditional write to R2 (or mirror file) → cache update. Queue/coalesce rapid changes (slider-type settings) with a short debounce.

### write failure and conflict UX

Optimistic apply must never produce "I thought I had turned this off". The contract, in order of severity:

- **The runtime honors the latest locally accepted valid value until persistence succeeds or a validation conflict forces an announced revert.** An optimistic value stays active locally even when the persist fails — behavior matching intent beats consistency for safety-relevant settings (autosync off, shortcuts). The value is cached in the Tauri store as a **pending write**, so a restart does not silently resurrect the old behavior. (The validation-conflict revert below is the one exception, and it is always announced.)
- **Transient write failure** (network, R2 5xx): silent retry with backoff (3 attempts). If still failing, the settings tab shows a persistent per-document status — "Changes not synced to other devices — Retry" — next to the affected section, and a one-time toast fires if the settings tab is not open. Pending writes are retried on the next poll tick and on app start. No silent revert, ever.
- **Etag conflict** (another device wrote first): re-read the remote document, re-apply this device's single pending change on top, retry the conditional write. This is the silent, expected path.
- **Conflict where re-apply fails validation** (the remote document changed such that the local change is no longer valid — e.g. a value now out of range against new sibling settings): do **not** drop it silently and do not keep an invalid runtime value. Revert the local value to the merged remote state, and show an explicit conflict notice in the settings tab naming the setting, the value that was reverted, and the remote value now in effect. This is the only path that reverts, and it is always announced.
- **Vault-mirror writes** (no R2): plain file write; failure surfaces the same "not saved — Retry" status. Concurrent-device semantics are Syncthing last-write-wins, stated in the section help text.
- A remote change arriving via polling while the settings tab is open applies live and briefly highlights the changed row, so a remote overwrite is visible rather than mysterious.

### theme migration

`themePreference` moves inside the settings document (`appearance.themePreference`). Migration: on first run, if `app-settings.json` is absent but `theme-preference.json` exists, seed the document from it; keep **writing both** for N releases (mobile does not read theme — mobile is dark-only — so dual-writing is purely for desktop rollback safety), then drop the legacy object in a follow-up. `useThemePreference` switches its source of truth to the settings context.

### scope summary

| Store | Contents |
|---|---|
| R2 `app-settings.json` (authoritative when R2 on) | full document above |
| `.eskerra/settings-shared.json` | `r2` bootstrap block (always); `appSettings` embedded document (when R2 off); legacy fields kept readable for migration |
| `.eskerra/settings-local.json` | device identity + playlist watermarks (unchanged) |
| Tauri store | shortcuts keymap (device-scoped, vault-independent); last-known settings cache + etags + pending-write queue (per vault root) |

## UI architecture: settings as a workspace tab

- **Synthetic tab URI**: `eskerra-settings://vault` (one instance). `normalizeEditorDocUri` passes the scheme through; `editorOpenTabPillLabel` renders "Settings" with a gear icon; quick open and note-only logic (persist, clean, backlinks) must ignore the scheme. Tab persists/restores via `mainWindowUiStore` like any tab.
- **Rendering**: when the active tab is the settings URI, the editor pane mounts `SettingsWorkspace` (lazy, like today's `LazySettingsPage`) instead of CodeMirror. CodeMirror is not reparented or destroyed — same pattern as compose mode / Today Hub swap.
- **Layout inside the tab**: left section nav (General, Appearance, Editor, Shortcuts, Vault layout, Cloud connection, Sync, Calendar, Properties) + scrollable panel; a filter/search box over setting labels is a stretch goal.
- **Entry points**: the existing gear/entry that sets `activePage = 'settings'` now opens the settings tab; `activePage` and `AppMainStage`'s settings branch are removed. `SettingsPage.tsx` is deleted; `SettingsContent` content is decomposed into the new sections.
- **No-vault bootstrap**: the folder-picker screen (no vault open) keeps its own minimal flow; the settings tab requires an open vault. "Change vault folder…" stays available inside General.
- All section components are L3 (`apps/desktop/src/components/settings/`), composing `@eskerra/ds-desktop` primitives; new shared primitives (e.g. a keybinding capture field) only get promoted to L2 if they stay product-agnostic.

## consumption: from constants to settings

- New desktop context `AppSettingsProvider` exposing resolved (default-merged) values. Access is **never stringly typed**: every setting is a typed descriptor in a central definitions module, carrying its path, default, scope, validator, and (where needed) serializer:

  ```ts
  // @eskerra/core settingsDefinitions.ts — single source of truth; document type is derived from it
  export const settingsKeys = {
    editor: {
      autosaveDebounceMs: defineSetting({
        path: ['editor', 'autosaveDebounceMs'],
        scope: 'vault',
        default: 400,
        validate: intInRange(100, 5000),
      }),
      // …
    },
  } as const;

  // desktop usage — both read and write go through the descriptor
  const autosaveDebounceMs = useAppSetting(settingsKeys.editor.autosaveDebounceMs);
  setAppSetting(settingsKeys.editor.autosaveDebounceMs, 600); // value type checked, validated on write
  ```

  `setAppSetting` rejects values failing the descriptor's validator before any write; the lenient per-key read validation reuses the same validators. Selector-style reads (`useAppSettingsValue(s => …)`) are not the API — descriptors are what bind default + validation + scope to each key.
- **Shortcuts**: a `shortcutRegistry` module maps action id → `{defaultBinding, currentBinding}`, persisted in the Tauri app store (device-scoped, vault-independent). `useAppMainWindowKeyboardEffects` matches events against the registry instead of inlined key checks. The CodeMirror keymap is provided through a `Compartment` and reconfigured when bindings change. Menu labels come from the registry.
- **Vault layout**: `@eskerra/core` gets a `VaultLayoutConfig` (defaults = current constants). Functions in `vaultLayout.ts` gain config-taking variants; constant-using call sites (vault tree top-level filter, podcast file parser, attachments host, compose-note target, Today Hub discovery) are migrated incrementally. The bare constants remain as the defaults object — no big-bang rename.
- **Git sync**: `buildManualGitSyncConfig` reads from settings; autosync scheduler takes its timings/enabled flag from settings.

## risks and mitigations

- **Startup regression**: settings must never block first paint. Cache-first resolve; assert with a regression test that no R2/vault read happens before first render (existing startup invariant tests pattern).
- **Vault layout changes are data-affecting**: changing "Notes folder" does **not** move files; it only changes where the app looks. The UI must say so explicitly and offer no migration in v1. Mobile-compat warning on any non-default value.
- **Settings document conflicts** (two devices writing): whole-document etag retry on R2; on the vault mirror, last write wins per Syncthing semantics. Failure and conflict handling follows the "write failure and conflict UX" contract above — no silent reverts, the validation-failure path is the only revert and is always announced.
- **Keymap conflicts with CodeMirror structural keys**: rebinding validation rejects bindings used by fixed editor keys (deny-list from `noteMarkdownCoreKeymap`).
- **Tab-model assumptions**: several code paths assume every tab URI is a vault `.md` file (persist queue, body cache, backlinks, watch reconcile). Each must explicitly skip the settings scheme; add tests (`editorOpenTabs`, `mainWindowUiStore`, shell restore) covering a persisted settings tab.

## phases

Each phase lands independently with tests (Vitest; Storybook stories for new presentational components per repo policy).

1. **Core settings document** (`@eskerra/core`): types, defaults, sparse parse/serialize with unknown-key preservation, per-key lenient validation; R2 object + conditional write + etag poller (generalize theme machinery); vault-mirror embed in `settings-shared.json`; Tauri-store cache. Theme read path migrates (dual-write legacy object).
2. **Settings tab shell**: synthetic URI, tab pill, `SettingsWorkspace` with section nav; move General (device/display name, change folder), Sync/R2, Themes, Properties into sections; delete `SettingsPage`/`activePage` branch. Note-only code paths hardened against the scheme.
3. **Behavior settings**: Editor (autosave debounce, link previews + blocked domains UI, confetti), Sync/Git (remote, globs, backup dir, commit template, autosync toggle + timings), Calendar defaults. Consumers switch from constants to `AppSettingsProvider`.
4. **Keyboard shortcuts**: action registry persisted in the Tauri app store (device-scoped), binding capture field with conflict detection, `useAppMainWindowKeyboardEffects` + CodeMirror compartment + menu labels read from registry; double-key window setting.
5. **Vault layout settings**: shared schema entries, `VaultLayoutConfig` threading through desktop call sites (tree filter, compose target, podcasts parser, attachments, Today Hub discovery), mobile-compat warnings. Highest risk — last on purpose.
6. **Cleanup**: drop legacy `theme-preference.json` dual-write; migrate `frontmatterProperties` / `linkSnippetBlockedDomains` readers off the legacy `settings-shared.json` fields (keep one-time migration reads).

## open questions

- Shortcuts are device-scoped and vault-independent (one keymap per install). If a future user wants per-vault keymaps, the registry's storage key gains a vault dimension; nothing else changes.
- Does the settings tab belong in **every** Today Hub workspace's tab strip or only the main inbox workspace? (Plan: it behaves like any tab — it lives in whichever workspace it was opened in.)
- When mobile adopts `vaultLayout`, who owns conflict semantics for the shared document? (Out of scope here; the unknown-key preservation rule is the forward-compat guarantee.)

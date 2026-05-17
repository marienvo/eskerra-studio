# Phase 2 lib domain clustering plan

Date: 2026-05-14

Purpose: plan small, reviewable moves from `apps/desktop/src/lib/` root into explicit domain folders. This is an audit and migration plan only; it does not authorize behavior changes.

## Current baseline

- Root-level files in `apps/desktop/src/lib/`: 142
- Existing immediate subfolders:
  - `__tests__/` - 2 files
  - `podcasts/` - 23 files
  - `todayHub/` - 7 files
  - `workspaceModel/` - 5 files
- Existing domain folders already provide useful precedent: `todayHub/`, `workspaceModel/`, and `podcasts/`.
- Platform or app glue that may stay root-level temporarily:
  - `mainWindowUiStore.ts`
  - `sessionNotifications.ts`
  - `resolveAppStatusBarCenter.ts`
  - `desktopShortcutLabels.ts`
  - `openSystemBrowserUrl.ts`
  - `revealPathInSystemExplorer.ts`
  - `fireInboxClearedConfetti.ts`
  - `emojiUsageStore.ts`
  - `emojiVariation.ts`
  - `emojiVariationBases.generated.ts`
  - Tauri wrappers until a specific `tauri/` PR is audited.

Audit commands used:

```sh
find apps/desktop/src/lib -maxdepth 1 -type f | wc -l
find apps/desktop/src/lib -mindepth 1 -maxdepth 1 -type d | sort
find apps/desktop/src/lib -maxdepth 1 -type f | sort
find apps/desktop/src/lib -mindepth 2 -maxdepth 2 -type f | sort
rg -n "src/lib|\\.\\./lib|\\.\\./\\.\\./lib|@/lib|lib/" apps/desktop/src/hooks apps/desktop/src/components apps/desktop/src/editor apps/desktop/src/shell apps/desktop/src/theme apps/desktop/src/test apps/desktop/src/observability
```

High-fan-in imports observed during the audit include `tauriVaultGitSync` around 30 references, `editorWorkspaceTabs` around 24, `mainWindowUiStore` around 17, `editorDocumentHistory` around 16, `todayHub` around 16, `vaultBootstrap` around 15, `workspaceHomeNavigation` around 13, `workspaceModel` around 11, and `vaultTreeBulkPlan` around 11. These should not be first moves unless a PR is deliberately scoped around their import churn.

## Proposed domains

### `layout/`

Likely files:

- `desktopHorizontalSplitClamp.ts`
- `desktopHorizontalSplitClamp.test.ts`
- `desktopVerticalSplitClamp.ts`
- `desktopVerticalSplitClamp.test.ts`
- `layoutStore.ts`
- `layoutStore.test.ts`
- `windowTiling.ts` is related but should be treated as uncertain because it is also Tauri platform glue.

Should not belong:

- General shell UI state such as `mainWindowUiStore.ts`.
- Status bar resolution such as `resolveAppStatusBarCenter.ts`.
- Window or system APIs that are not layout-specific.

Likely public boundary exports:

- Clamp constants and helpers.
- Layout store load/save helpers.
- Window tiling only if the first layout move proves clean.

Tests that move with files:

- `desktopHorizontalSplitClamp.test.ts`
- `desktopVerticalSplitClamp.test.ts`
- `layoutStore.test.ts`

Import-risk level: low for clamp helpers and `layoutStore`; medium if `windowTiling.ts` is included.

Recommended PR size: small. Move 6 files first and leave `windowTiling.ts` root-level temporarily.

### `clipboard/`

Likely files:

- `clipboardImageFiles.ts`
- `clipboardImageFiles.test.ts`
- `clipboardImagePng.ts`
- `clipboardImagePng.test.ts`
- `htmlClipboardToMarkdown.ts`
- `htmlClipboardToMarkdown.test.ts`
- `formatVaultImageMarkdown.ts`
- `formatVaultImageMarkdown.test.ts`

Should not belong:

- Attachment persistence such as `persistTransientMarkdownImages.ts`.
- Vault image preview resolution such as `resolveVaultImagePreviewUrl.ts`.
- Editor insertion state and editor UI components.

Likely public boundary exports:

- Clipboard image file extraction.
- PNG conversion helpers.
- HTML-to-Markdown conversion.
- Vault image Markdown formatting.

Tests that move with files: all listed colocated tests.

Import-risk level: medium. The file count is small and tests exist, but imports are used from editor paths, so review should check editor paste behavior manually or with existing tests.

Recommended PR size: small to medium, 8 files plus mechanical import updates.

### `playback/`

Likely files:

- `desktopMediaSession.ts`
- `desktopMediaSession.test.ts`
- `desktopMediaSessionArtwork.ts`
- `desktopMediaSessionDom.ts`
- `desktopR2Transport.ts`
- `desktopR2Transport.test.ts`
- `formatPlaybackMs.ts`
- `formatPlaybackMs.test.ts`
- `htmlAudioPlayer.ts`
- `htmlAudioPlayer.test.ts`

Related existing folder:

- `podcasts/` already contains podcast catalog, RSS, and playback-adjacent desktop helpers. Do not merge `podcasts/` into `playback/` without a separate audit.

Should not belong:

- Podcast RSS parsing and index storage.
- Vault playlist persistence.
- Git sync or Tauri vault APIs.

Likely public boundary exports:

- HTML audio player helpers.
- Desktop media session helpers.
- R2 transport helpers.
- Playback time formatting.

Tests that move with files:

- `desktopMediaSession.test.ts`
- `desktopR2Transport.test.ts`
- `formatPlaybackMs.test.ts`
- `htmlAudioPlayer.test.ts`

Import-risk level: medium. The domain is clear, but playback crosses shell, playlist, media session, and transport code.

Recommended PR size: medium. Move root playback primitives only; leave `podcasts/` untouched.

### `gitSync/`

Likely files:

- `gitSyncConfig.ts`
- `gitSyncConfig.test.ts`
- `gitSyncManualView.ts`
- `gitSyncManualView.test.ts`
- `gitSyncPreflight.ts`
- `gitSyncPreflight.test.ts`
- `gitStatusView.ts`
- `gitStatusView.test.ts`
- `tauriVaultGitSync.ts`
- `tauriVaultGitSync.test.ts`

Should not belong:

- Generic Tauri vault wrappers that are not Git-specific.
- Vault tree or file-watch reconciliation.
- Manual sync close UI helpers unless a later audit shows they are exclusively git-sync UI.

Likely public boundary exports:

- Git sync configuration parsing.
- Git sync preflight result mapping.
- Git status/manual-sync view models.
- Tauri Git sync command wrapper.

Tests that move with files: all listed colocated tests.

Import-risk level: high. `tauriVaultGitSync` has high fan-in and is a Tauri command boundary.

Recommended PR size: split. Move pure view/config/preflight helpers first; defer `tauriVaultGitSync.ts` or move it in a dedicated PR.

### `vault/`

Likely files:

- `vaultBacklinkBodySeed.ts`
- `vaultBacklinkBodySeed.test.ts`
- `vaultBootstrap.ts`
- `vaultBootstrapMoveTreeItem.test.ts`
- `vaultBootstrapSaveNoteMarkdown.test.ts`
- `vaultFilesChangedEventPlan.ts`
- `vaultFilesChangedEventPlan.test.ts`
- `vaultFilesChangedPayload.ts`
- `vaultFilesChangedPayload.test.ts`
- `vaultFsPaths.ts`
- `vaultMarkdownThreeWayMerge.ts`
- `vaultMarkdownThreeWayMerge.test.ts`
- `vaultTreeAutoExpandThroughSparseFolders.ts`
- `vaultTreeAutoExpandThroughSparseFolders.test.ts`
- `vaultTreeBulkPlan.ts`
- `vaultTreeBulkPlan.test.ts`
- `vaultTreeDnd.ts`
- `vaultTreeDnd.test.ts`
- `vaultTreeFilterTopLevelInbox.ts`
- `vaultTreeFilterTopLevelInbox.test.ts`
- `vaultTreeLoadChildren.ts`
- `vaultTreeLoadChildren.test.ts`
- `vaultTreeRowLabel.ts`
- `vaultTreeRowLabel.test.ts`
- `vaultUriPaths.ts`
- `vaultWikiLinkRenameMaintenance.ts`
- `vaultWikiLinkRenameMaintenance.test.ts`
- `countInboxVaultMarkdownRefs.ts`
- `countInboxVaultMarkdownRefs.test.ts`
- `resolveVaultLinkBaseMarkdownUri.ts`

Uncertain or later-only files:

- `persistTransientMarkdownImages.ts`
- `persistTransientMarkdownImages.test.ts`
- `resolveVaultImagePreviewUrl.ts`
- `resolveVaultImagePreviewUrl.test.ts`
- `desktopVaultAttachments.ts`
- `noteInboxAttachmentHost.ts`
- `noteInboxAttachmentHost.test.ts`

Should not belong:

- Generic Tauri wrappers unless the wrapper is vault-only and moved in a dedicated Tauri/vault PR.
- Editor tab state.
- Workspace model state.
- Clipboard conversion helpers.

Likely public boundary exports:

- Vault URI/path helpers.
- Vault tree planning helpers.
- Vault file-change event planning.
- Vault Markdown merge/link maintenance helpers.

Tests that move with files: all listed colocated tests, plus relevant existing `vaultBootstrap*` tests if `vaultBootstrap.ts` is ever moved.

Import-risk level: high overall. Some subgroups are low to medium, but `vaultBootstrap.ts` and attachment/image persistence are danger-zone adjacent.

Recommended PR size: split aggressively. A later `vault/tree` PR is more reviewable than moving all vault-prefixed files at once.

### `editor/`

Likely files:

- `editorClosedTabStack.ts`
- `editorClosedTabStack.test.ts`
- `editorDocumentHistory.ts`
- `editorDocumentHistory.test.ts`
- `editorOpenTabPillLabel.ts`
- `editorOpenTabPillLabel.test.ts`
- `editorOpenTabs.ts`
- `editorOpenTabs.test.ts`
- `editorTabPillDisplayName.ts`
- `editorTabPillDisplayName.test.ts`
- `editorWorkspaceTabs.ts`
- `editorWorkspaceTabs.test.ts`
- `buildMarkdownLineDiff.ts`
- `buildMarkdownLineDiff.test.ts`
- `lineLcs.ts`
- `lineLcs.test.ts`
- `markdown/cleanNote/index.ts`
- `markdown/cleanNote/__tests__/*.test.ts`
- `parseLoneLinkLine.ts`
- `parseLoneLinkLine.test.ts`
- `linkRichPreviewCache.ts`

Should not belong:

- Clipboard ingestion helpers, even if they are called from editor components.
- Workspace shell/home navigation.
- Vault persistence and save paths.

Likely public boundary exports:

- Editor tab models.
- Closed-tab stack helpers.
- Document history helpers.
- Markdown normalization/diff helpers.

Tests that move with files: all listed tests, including the `markdown/cleanNote/__tests__` suite.

Import-risk level: high for tab/history files because `editorWorkspaceTabs` and `editorDocumentHistory` have high fan-in; medium for pure Markdown diff/clean helpers.

Recommended PR size: split. Do not use this as the first phase-2 PR. Start with pure Markdown helpers or closed-tab helpers only after a fresh audit.

### `tauri/`

Likely files:

- `tauriVault.ts`
- `tauriVaultFrontmatter.ts`
- `tauriVaultSearch.ts`
- `desktopTauriWindow.ts`
- `openSystemBrowserUrl.ts`
- `revealPathInSystemExplorer.ts`
- `desktopVaultAttachments.ts`
- `windowTiling.ts` is uncertain; it is layout-specific but implemented through Tauri commands.

Files that probably should not belong:

- `tauriVaultGitSync.ts`, which is better owned by `gitSync/` if moved.
- `desktopR2Transport.ts`, which is better owned by `playback/` unless a transport/platform boundary is created later.
- Pure vault tree/path/model helpers.

Likely public boundary exports:

- Tauri command wrappers.
- System browser/explorer helpers.
- Desktop window helpers.
- Vault search/frontmatter command wrappers.

Tests that move with files:

- `tauriVaultGitSync.test.ts` only if that file moves with git sync, not this domain.
- No broad test move should happen until each wrapper is audited.

Import-risk level: medium to high. This is a runtime boundary and several files have app-wide call sites.

Recommended PR size: split by command family. Do not create a large platform-glue move as the first phase-2 PR.

### `todayHub/`

Likely files:

- Existing `todayHub/` folder remains the domain root.
- `todayHubCellStaticPointer.ts`
- `todayHubCellStaticPointer.test.ts`
- `todayHubCellStaticView.ts`
- `todayHubCellStaticView.test.ts`
- `todayHubWorkspaceRestore.ts`
- `todayHubWorkspaceRestore.test.ts`
- Existing files under `todayHub/` such as canvas layout, perf, warm LRU, and workspace bridge helpers.

Should not belong:

- Generic workspace shell/home persistence.
- Editor tab models except explicit bridge or conversion helpers already audited as Today Hub specific.
- Vault tree/path helpers.

Likely public boundary exports:

- Static cell view/pointer helpers.
- Canvas cell layout helpers.
- Today Hub workspace bridge/restore helpers.
- Perf and warm-cache helpers if they remain implementation details behind the folder.

Tests that move with files: the three root Today Hub colocated tests listed above.

Import-risk level: medium. The existing folder and index reduce ambiguity, but the domain touches visible Today Hub UI.

Recommended PR size: small to medium. A good candidate after the first layout move if import churn is manageable.

### `workspaceModel/`

Likely files:

- Existing `workspaceModel/` files remain:
  - `index.ts`
  - `invariants.ts`
  - `persistence.ts`
  - `selectors.ts`
  - `types.ts`
- Potential later candidates after a separate audit:
  - `workspaceHomeNavigation.ts`
  - `workspaceHomeNavigation.test.ts`
  - `workspaceHomePersistence.ts`
  - `workspaceHomePersistence.test.ts`
  - `workspacePersistenceShadow.ts`
  - `__tests__/workspacePersistenceShadow.test.ts`
  - `workspaceShellToday.ts`
  - `workspaceShellToday.test.ts`

Should not belong:

- Main-window UI store until its responsibility is separated from shell/UI concerns.
- Editor tab internals.
- Today Hub rendering helpers.
- Vault persistence writes.

Likely public boundary exports:

- Workspace model types.
- Persistence serialization helpers.
- Selectors and invariants.
- Home navigation/persistence only if later audit confirms they are model-level rather than shell-level.

Tests that move with files:

- Existing `workspaceModel/` tests if added later.
- Potential root workspace tests only when their source files move.

Import-risk level: high. `workspaceModel` already has many imports, and workspace/home helpers are close to shell state and persistence diagnostics.

Recommended PR size: defer. Do not expand this domain before lower-risk file moves prove the mechanics.

## Cross-domain dependency risks

- Avoid cycles between `workspaceModel/`, `editor/`, and `todayHub/`. Today Hub may project workspace/editor state, but the core workspace model should not import Today Hub rendering helpers.
- Avoid cycles between `vault/`, `tauri/`, and `gitSync/`. Tauri command wrappers should not start importing higher-level vault or git-sync view models.
- Keep `vaultBootstrap.ts` out of early moves. It is high fan-in and contains save/persistence paths such as `saveNoteMarkdown`.
- Keep cache/persistence/watch/editor-save danger-zone files out of first moves unless the PR is explicitly audited for read/write side effects.
- `tauriVaultGitSync.ts`, `editorWorkspaceTabs.ts`, `mainWindowUiStore.ts`, `editorDocumentHistory.ts`, `todayHub` barrel imports, `vaultBootstrap.ts`, `workspaceHomeNavigation.ts`, and `vaultTreeBulkPlan.ts` are import-churn hotspots.
- The `inbox*` group is not cleanly assigned by the starting folder hypothesis. Do not force it into `vault/` or `editor/` in phase 2 without a separate audit.
- `index.ts` boundaries may help later for `layout/`, `clipboard/`, `todayHub/`, and `workspaceModel/`, but deep-import restrictions should wait until at least one or two domains have moved cleanly.

## Migration strategy

- Move one domain, or one clear subdomain, per PR.
- Keep behavior unchanged.
- Move tests with the files they cover.
- Update imports mechanically.
- For import-only moves, add the move commit SHA to `.git-blame-ignore-revs` after merge.
- Do not update module budgets during the planning step.
- Do not add ESLint deep-import restrictions until after at least one or two domains have moved cleanly.
- Run the existing targeted tests for each moved domain plus the repo architecture check.
- Use exact-value tests when touching or relocating extracted helpers; do not weaken tests during moves.
- Keep danger-zone review strict: no cache writes, persistence writes, watcher behavior changes, or editor-save behavior changes as part of a move PR.

## Recommended first migration PR

First domain: `layout/`.

Scope:

- Create `apps/desktop/src/lib/layout/`.
- Move:
  - `desktopHorizontalSplitClamp.ts`
  - `desktopHorizontalSplitClamp.test.ts`
  - `desktopVerticalSplitClamp.ts`
  - `desktopVerticalSplitClamp.test.ts`
  - `layoutStore.ts`
  - `layoutStore.test.ts`
- Update imports mechanically.
- Leave `windowTiling.ts` root-level temporarily because it crosses into Tauri command glue.

Why this is first:

- Small file count.
- Clear naming prefix and responsibility.
- Existing exact tests for all moved helpers.
- Lower behavior risk than vault, editor, git sync, or workspace model moves.
- Import churn is visible but not as broad as the high-fan-in hotspots.

Recommended review focus:

- Import-only diff except path updates.
- No changes to persisted layout key names or default values.
- `layoutStore.ts` still calls the same Tauri store APIs under the same conditions.
- Clamp constants and return values are unchanged.

## Explicit non-goals

- No behavior changes.
- No editor megamodule work.
- No workspace-hook extraction.
- No CODEOWNERS yet.
- No contributor docs yet.
- No PR template yet.
- No bulk move of all domains in one PR.
- No module-budget updates during planning.
- No ESLint deep-import restrictions until the first migrations prove the folder design.

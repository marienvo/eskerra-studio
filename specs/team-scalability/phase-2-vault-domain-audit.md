# Phase 2 Vault Domain Audit

Date: 2026-05-14

Purpose: prepare a future `apps/desktop/src/lib/vault/` migration without moving files yet. This audit is documentation-only and treats vault as higher risk because it is close to save, persistence, watcher, merge, and attachment paths.

## Baseline

- `apps/desktop/src/lib/` root-level file count before any vault move: 122
- Existing `vault/` folder: none
- Current phase-2 domains already moved or filled: `layout/`, `todayHub/`, `clipboard/`
- Deferred high-risk domains before this audit: `vault/`, `editor/`, `gitSync/`, `workspaceModel/`, `tauri/`

## Recommendation

A safest first vault migration PR exists, but it should be intentionally small:

- Move only the tested low-risk pure helpers:
  - `apps/desktop/src/lib/vaultBacklinkBodySeed.ts`
  - `apps/desktop/src/lib/vaultBacklinkBodySeed.test.ts`
  - `apps/desktop/src/lib/countInboxVaultMarkdownRefs.ts`
  - `apps/desktop/src/lib/countInboxVaultMarkdownRefs.test.ts`
- Target folder: `apps/desktop/src/lib/vault/`
- Do not move `vaultBootstrap.ts`, save helpers, watcher helpers, merge helpers, attachment helpers, or tree loaders in the first vault PR.
- Leave `resolveVaultLinkBaseMarkdownUri.ts` at root until it has exact tests or a separate prep entry accepts moving an untested pure helper.

This keeps the first vault PR reviewable and avoids persistence, watcher, editor-save, and attachment behavior.

## Commands Used

- `find apps/desktop/src/lib -maxdepth 1 -type f | sort`
- `rg -n "vault|Vault|Inbox|attachment|Attachment|saveNoteMarkdown|watch|FilesChanged|markdown.*merge|WikiLink|vaultUri|vaultFs|persistTransient" apps/desktop/src`
- `rg -n "from ['\"].*<module>|from ['\"]../lib/<module>|from ['\"]../../lib/<module>|from ['\"]../../../lib/<module>" apps/desktop/src apps/desktop/vitest.setup.ts`
- `wc -l apps/desktop/src/lib/<vault-related-file>`

Import fan-in below is approximate and counts references found under `apps/desktop/src` plus `apps/desktop/vitest.setup.ts`, including tests.

## Group 1: Low-Risk Vault Pure Helpers

| Item | Audit |
| --- | --- |
| Candidate files | `vaultBacklinkBodySeed.ts`, `countInboxVaultMarkdownRefs.ts`, `resolveVaultLinkBaseMarkdownUri.ts` |
| Tests that should move | `vaultBacklinkBodySeed.test.ts`, `countInboxVaultMarkdownRefs.test.ts`; `resolveVaultLinkBaseMarkdownUri.ts` has no current test |
| Import fan-in / call-site risk | Low. Approximate fan-in: `vaultBacklinkBodySeed` 2, `countInboxVaultMarkdownRefs` 2, `resolveVaultLinkBaseMarkdownUri` 1 |
| Behavior risk | Low for the two tested helpers. Medium for `resolveVaultLinkBaseMarkdownUri.ts` until exact tests exist |
| Danger-zone proximity | Low to medium. `vaultBacklinkBodySeed` combines disk cache with active editor content, but it is read-only. `countInboxVaultMarkdownRefs` is pure counting. `resolveVaultLinkBaseMarkdownUri` influences note-link base URI selection |
| Recommended PR size | 4 files for the first safe PR; add `resolveVaultLinkBaseMarkdownUri.ts` only with exact tests |
| Safe to move | Safe now for the two tested helpers; later for `resolveVaultLinkBaseMarkdownUri.ts` |

## Group 2: Vault Tree Helpers

| Item | Audit |
| --- | --- |
| Candidate files | `vaultTreeBulkPlan.ts`, `vaultTreeDnd.ts`, `vaultTreeFilterTopLevelInbox.ts`, `vaultTreeRowLabel.ts`, `vaultTreeAutoExpandThroughSparseFolders.ts`, `vaultTreeLoadChildren.ts` |
| Tests that should move | Matching tests for each listed file |
| Import fan-in / call-site risk | Mixed. Approximate fan-in: `vaultTreeDnd` 2, `vaultTreeFilterTopLevelInbox` 2, `vaultTreeRowLabel` 2, `vaultTreeAutoExpandThroughSparseFolders` 2, `vaultTreeBulkPlan` 13, `vaultTreeLoadChildren` 15 |
| Behavior risk | Low for row label, filter, and DnD planning helpers. Medium for bulk planning. Medium to high for `vaultTreeLoadChildren.ts` because it lists files asynchronously, mutates `itemStoreRef.current`, exports shared types, and is imported from components, shell restore, editor-tab, and watcher-reconcile paths |
| Danger-zone proximity | Low for pure UI/tree planning helpers. Medium for `vaultTreeLoadChildren.ts` because it is used by workspace reconcile and tree loading behavior |
| Recommended PR size | Split. A first tree PR could move only `vaultTreeDnd`, `vaultTreeFilterTopLevelInbox`, and `vaultTreeRowLabel`. Move `vaultTreeBulkPlan` separately. Move `vaultTreeLoadChildren` last, if at all |
| Safe to move | Later, after a dedicated prep entry. Do not bundle all tree helpers at once |

## Group 3: Vault URI/Path Helpers

| Item | Audit |
| --- | --- |
| Candidate files | `vaultFsPaths.ts`, `vaultUriPaths.ts` |
| Tests that should move | No obvious existing direct tests found; add exact path-normalization tests before or with any move |
| Import fan-in / call-site risk | Low by count, higher by importance. Approximate fan-in: `vaultFsPaths` 2, `vaultUriPaths` 1 |
| Behavior risk | Medium. Path and URI helpers can change preview, attachment, and watcher-reconcile behavior if imports or assumptions are wrong |
| Danger-zone proximity | Medium. `vaultFsPaths.ts` is used by attachment/preview helpers. `vaultUriPaths.ts` is used by file-system watch reconcile logic |
| Recommended PR size | 2 helper files plus exact tests only |
| Safe to move | Later, after tests and a path-specific prep entry |

## Group 4: Vault Link/Rename/Merge Helpers

| Item | Audit |
| --- | --- |
| Candidate files | `vaultMarkdownThreeWayMerge.ts`, `vaultWikiLinkRenameMaintenance.ts` |
| Tests that should move | `vaultMarkdownThreeWayMerge.test.ts`, `vaultWikiLinkRenameMaintenance.test.ts` |
| Import fan-in / call-site risk | Low by count, high by consequence. Approximate fan-in: `vaultMarkdownThreeWayMerge` 2, `vaultWikiLinkRenameMaintenance` 2 |
| Behavior risk | High for merge paths; medium to high for rename maintenance. `vaultMarkdownThreeWayMerge.ts` affects watcher conflict reconciliation. `vaultWikiLinkRenameMaintenance.ts` includes both planning and write application through `fs.writeFile` |
| Danger-zone proximity | High. These are close to markdown merge/write paths, watcher reconcile, and rename persistence |
| Recommended PR size | Do not move as the first vault PR. If moved later, split merge and rename into separate PRs and require exact tests plus watcher/rename review |
| Safe to move | Not yet |

## Group 5: Attachment/Image Helpers

| Item | Audit |
| --- | --- |
| Candidate files | `persistTransientMarkdownImages.ts`, `desktopVaultAttachments.ts`, `noteInboxAttachmentHost.ts`, `resolveVaultImagePreviewUrl.ts` |
| Tests that should move | `persistTransientMarkdownImages.test.ts`, `noteInboxAttachmentHost.test.ts`, `resolveVaultImagePreviewUrl.test.ts`; no direct test found for `desktopVaultAttachments.ts` |
| Import fan-in / call-site risk | Medium. Approximate fan-in: `persistTransientMarkdownImages` 4, `desktopVaultAttachments` 4, `noteInboxAttachmentHost` 6, `resolveVaultImagePreviewUrl` 3 |
| Behavior risk | High for persistence and import helpers. Medium for preview URL resolution |
| Danger-zone proximity | High. These files touch editor paste/drop behavior, Tauri invoke wrappers, vault attachment writes, transient markdown image persistence, and visible image previews |
| Recommended PR size | Do not move as a first vault PR. If revisited, split preview URL from write/import helpers and require manual editor paste/image smoke expectations |
| Safe to move | Not yet |

## Group 6: High-Risk Save/Persistence/Bootstrap/Watcher-Adjacent Files

| Item | Audit |
| --- | --- |
| Candidate files | `vaultBootstrap.ts`, `vaultBootstrapMoveTreeItem.test.ts`, `vaultBootstrapSaveNoteMarkdown.test.ts`, `vaultFilesChangedEventPlan.ts`, `vaultFilesChangedPayload.ts`, `vaultMarkdownThreeWayMerge.ts`, `persistTransientMarkdownImages.ts`, `desktopVaultAttachments.ts`, `noteInboxAttachmentHost.ts` |
| Tests that should move | Matching tests only when a specific subgroup is moved |
| Import fan-in / call-site risk | High for `vaultBootstrap.ts` at roughly 20 references. Watcher helpers are lower count but feed `workspaceVaultWatchEffects.ts`. Save/image helpers feed `useMainWindowWorkspace.ts` and `workspacePersistence.ts` |
| Behavior risk | High |
| Danger-zone proximity | High. `vaultBootstrap.ts` contains `saveNoteMarkdown`, settings read/write, playlist R2 operations, note create/delete/rename/move, and bootstrap directory creation. Watcher files influence file-changed planning. Image helpers persist markdown image attachments |
| Recommended PR size | No bulk move. `vaultBootstrap.ts` should not move as one unit until a separate audit decides whether to split settings/bootstrap, note CRUD/save, playlist, and tree mutation responsibilities |
| Safe to move | Not yet |

## Specific Danger-Zone Notes

- `saveNoteMarkdown` remains in `vaultBootstrap.ts` and is imported by `useMainWindowWorkspace.ts` and `workspacePersistence.ts`; any move around it must review editor-save timing, `lastPersistedRef`, and `inboxContentByUriRef` behavior.
- `workspaceVaultWatchEffects.ts` imports `readVaultSettings`, `VaultFilesChangedPayload`, and `planVaultFilesChangedEvent`; watcher-adjacent moves require strict no-behavior-change review.
- `workspaceFsWatchReconcile.ts` imports `vaultUriParentDirectory`, `vaultUriIsTodayMarkdownFile`, and `tryMergeThreeWayVaultMarkdown`; this is near cache and merge conflict handling.
- `persistTransientMarkdownImages.ts`, `desktopVaultAttachments.ts`, and `noteInboxAttachmentHost.ts` touch attachment persistence, Tauri import/write calls, and editor paste/drop image behavior.
- `vaultBootstrap.ts` also imports playback/R2 transport helpers, so moving it wholesale could blur `vault/` and `playback/` boundaries.

## Cross-Domain Dependency Risks

- Avoid introducing a `vault/index.ts` boundary during initial moves. The prior phase-2 process has worked better with direct mechanical import updates.
- Avoid a broad `vault/` move that combines pure helpers, tree helpers, watcher helpers, attachment persistence, and save functions in one PR.
- `vaultTreeLoadChildren.ts` exports shared tree types. Moving it can force a broad update across components, hooks, shell restore, and tests.
- `vaultFsPaths.ts` is small, but it is used by both preview and attachment code. Moving it before tests exist would create low-line-count but high-sensitivity churn.
- `vaultMarkdownThreeWayMerge.ts` is pure but watcher-reconcile critical. Treat it as behavior-sensitive despite low import count.

## Future Migration Strategy

1. Start with a tiny pure-helper vault PR:
   - `vaultBacklinkBodySeed.ts`
   - `vaultBacklinkBodySeed.test.ts`
   - `countInboxVaultMarkdownRefs.ts`
   - `countInboxVaultMarkdownRefs.test.ts`
2. Run targeted tests for the moved files and `npm run check:architecture`.
3. Require review to compare function bodies, constants, defaults, and test assertions, not only imports.
4. Do not add barrel exports, deep-import restrictions, module-budget updates, or contributor-process docs in the move PR.
5. Add a fresh prep entry before any tree, path, watcher, save, attachment, or bootstrap move.
6. Keep `vaultBootstrap.ts`, save paths, watcher paths, merge paths, and attachment/image persistence paused until a higher-effort subgroup audit is complete.

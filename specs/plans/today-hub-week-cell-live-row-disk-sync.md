# Today Hub week cells ignore disk changes while a cell is "live"

## Context

Earlier fixes made disk→UI sync work for the main `Today.md` editor and for week cells that are
**not** currently open. But week cells still don't reflect on-disk changes once they have been
opened.

Root cause (confirmed by reading + tests in
`apps/desktop/src/hooks/workspaceFsWatchReconcile.test.ts`):

- `syncTodayHubWeekRowFromDiskIfNeeded` in
  `apps/desktop/src/hooks/workspaceFsWatchReconcileTodayHub.ts` **skips the live row entirely**:
  `const liveUri = today.todayHubBridgeRef.current.getLiveRowUri(); if (liveUri === rowUri) return;`.
  So while a cell's row is the "live" (active) one, external disk edits to that row file are never
  reconciled into the cache, the editor, or the preview.
- A non-empty hub cell is only deactivated by **Escape** (`setActive(null)` at
  `TodayHubCanvas.tsx:758`) or, for empty cells, the blur handler
  (`closeEmptyActiveCellIfStillEmpty`, line ~894). There is **no** click-outside / focus-out
  deactivation for non-empty cells. So once the user opens a cell and clicks away without pressing
  Escape, that row stays `active` indefinitely → permanently skipped by reconcile.

This is exactly why the main editor works (it reconciles the open note via reload-from-disk with
conflict classification) but week cells do not. Verified: a **non-live** row change calls
`setInboxContentByUri`; a **live** row change is skipped.

The existing bridge (`apps/desktop/src/lib/todayHub/todayHubWorkspaceBridge.ts`) already exposes
`getLiveRowUri()`, `getLiveRowMergedMarkdown()`, and `hasPendingHubFlush()`, and
`cleanHubPageDayColumns` already demonstrates the active-row editor reload pattern
(`cellEditorRef.current?.loadMarkdown(cols[col], {selection: 'preserve'})`,
`TodayHubCanvas.tsx:550-557`). `todayHubRowLastPersistedRef` records the last persisted body per
row URI. We reuse all of these.

## Fix — reconcile the live row too (disk wins when there are no unsaved edits)

Bring the live week-row to parity with the main editor: when its file changes on disk, reload it
from disk **unless** the cell holds unsaved local edits (then keep local — never clobber).

### 1. Bridge: add `reloadLiveRowFromDisk`
In `todayHubWorkspaceBridge.ts` add `reloadLiveRowFromDisk: (diskBody: string) => void` to
`TodayHubWorkspaceBridge` (and a no-op in `createIdleTodayHubWorkspaceBridge`).

In `TodayHubCanvas.tsx`, implement it in the bridge `useLayoutEffect` (next to
`getLiveRowMergedMarkdown`), mirroring the clean active-row reload:
- `const a = activeRef.current; if (!a) return;`
- `const cols = splitTodayRowIntoColumns(diskBody, columnCount);`
- set `localRowSections[a.uri] = cols` (keep `localRowSectionsRef.current` in sync, the file's pattern),
- `cellEditorRef.current?.loadMarkdown(cols[a.col] ?? '', {selection: 'preserve'})`.
- Reset the cleanup no-op alongside the other bridge methods.

### 2. Reconcile: replace the live-row skip with a live reconcile
In `workspaceFsWatchReconcileTodayHub.ts`, `syncTodayHubWeekRowFromDiskIfNeeded`: when
`liveUri === rowUri`, instead of `return`, classify using normalized comparison
(`normalizeVaultMarkdownDiskRead` for whitespace/EOL parity):
- `liveMerged = today.todayHubBridgeRef.current.getLiveRowMergedMarkdown()`
- `lastPersisted = today.todayHubRowLastPersistedRef.current.get(rowUri)`
- If `norm(liveMerged) === norm(hubDiskBody)` → **noop**; set `lastPersistedRef[rowUri] = hubDiskBody`.
- Else if `lastPersisted != null && norm(liveMerged) === norm(lastPersisted)` → **no unsaved edits,
  disk changed externally**: call `bridge.reloadLiveRowFromDisk(hubDiskBody)`, update the inbox
  cache (`mergeInboxNoteBodyIntoCache`) and `lastPersistedRef[rowUri] = hubDiskBody`.
- Else → **unsaved local edits diverge from disk**: keep local (do not reload, do not touch
  `lastPersisted`) so edits are never lost. (No conflict UI exists for hub cells; safe default is
  keep-local, matching the daemon/disk-conflict philosophy.)

Keep the non-live path unchanged. The live-reconcile uses the bridge already present in the `today`
env.

### Note on cell deactivation (out of scope)
The "cell stays active after click-away" UX is the trigger that makes the skip persistent. We do
**not** add blur/click-outside deactivation here: the active CodeMirror legitimately blurs for
tooltips (emoji/autocomplete extend outside the cell), so blur-deactivation would collapse cells
mid-edit. The live-reconcile fix makes correctness independent of when the cell deactivates.
Revisit deactivation separately if desired.

## Tests

- `workspaceFsWatchReconcile.test.ts` (Today Hub week rows describe): extend with live-row cases —
  (a) live row, `getLiveRowMergedMarkdown` equals `lastPersisted`, disk differs → asserts a new
  `reloadLiveRowFromDisk` spy is called + `setInboxContentByUri` called; (b) live row with unsaved
  edits (live merged ≠ lastPersisted and ≠ disk) → asserts NOT reloaded and inbox untouched. Keep
  the existing non-live positive test.
- `TodayHubCanvas.test.tsx`: open a cell (active), then drive the bridge `reloadLiveRowFromDisk`
  (or the reconcile) and assert `activeCellEditorDoc()` reflects the new disk body; a second case
  with local edits asserts they are preserved.
- `todayHubWorkspaceBridge` idle default gains the no-op method (type-check coverage).

## Verification

- `cd apps/desktop && npx vitest run src/hooks/workspaceFsWatchReconcile.test.ts src/components/TodayHubCanvas.test.tsx`
- `cd apps/desktop && npx vitest run` (full desktop suite — disk sync is a critical surface)
- `npm run lint` (+ module-budget / eslint-suppression baseline bumps if line counts shift)
- Manual (`npm run desktop`): open a Today hub, click into a week cell (don't press Escape), then
  edit that week's `YYYY-MM-DD.md` file externally (another editor / `echo`). The cell must update
  to the disk content. With local unsaved edits in the cell, the external change must NOT overwrite
  them (edits preserved).

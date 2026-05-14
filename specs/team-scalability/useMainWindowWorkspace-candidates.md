# useMainWindowWorkspace Anti-Growth Policy And Candidates

Date: 2026-05-14

## Anti-Growth Policy

- `apps/desktop/src/hooks/useMainWindowWorkspace.ts` must not grow above the current module-budget cap (`4088` script-counted lines; `wc -l` currently reports `4076`).
- New behavior should land in focused helpers, hooks, or modules first.
- The main hook should only wire dependencies, own React orchestration, and delegate focused logic.
- Raising the budget requires an explicit logbook note, a reason, and a temporary follow-up plan to lower it again.
- Prefer one small extraction per cleanup cycle.

## Audit Guardrails

This audit avoids candidates touching:

- `lastPersistedRef`
- `inboxContentByUri`
- `saveNoteMarkdown`
- autosave scheduler behavior
- watcher/reconcile behavior
- editor-save flow

Previously extracted candidates (`injectActiveHubIntoTodayHubPersistMap`,
`collectShadowDivergenceDevDiagnostics`, and
`popNextReopenableClosedTabRecord`) are not counted as new candidates here.

## Candidates

### 1. `hasReopenableClosedEditorTab`

- **Rough source location:** `apps/desktop/src/hooks/useMainWindowWorkspace.ts` lines ~679-698 (`canReopenClosedEditorTab` useMemo).
- **Current responsibility:** Derives the "Reopen closed tab" enabled state by scanning the closed-tab stack snapshot against the current vault root and known notes.
- **Danger-zone proximity:** Low. Reads `vaultRoot`, `notes`, `editorClosedTabsStackSnapshot`, and the version counter. Does not touch persistence, cache writes, save scheduling, watcher state, or editor load/save paths.
- **Testability:** High. Pure helper tests can cover missing root, empty stack, stale top entries, note-set membership, and `.md` fallback.
- **Likely files touched:** `apps/desktop/src/lib/editorClosedTabStack.ts`, `apps/desktop/src/lib/editorClosedTabStack.test.ts`, `apps/desktop/src/hooks/useMainWindowWorkspace.ts`.
- **Risk:** low.
- **Safe now/later/not yet:** safe now.

### 2. `resolveModelBackedLegacyTabStrip`

- **Rough source location:** `apps/desktop/src/hooks/useMainWindowWorkspace.ts` lines 1468-1489 (`applyBackgroundNewTabOpen`) and 2052-2075 (`closeEditorTab`).
- **Current responsibility:** Compares legacy tab-strip output with the model-derived tab strip, uses the derived strip when it matches, and warns in development when a model strip exists but diverges. Background open uses full tab signatures; close-tab uses id/order comparison only.
- **Danger-zone proximity:** Low to medium. It sits inside tab open/close orchestration, but the candidate itself is pure comparison plus warning metadata. It does not touch save refs, body caches, watcher state, or editor persistence.
- **Testability:** High. Unit tests can cover signature match/mismatch, id match/mismatch, missing model workspace, and exact mismatch payload data without mounting the hook.
- **Likely files touched:** `apps/desktop/src/hooks/workspaceRuntimeProjection.ts`, `apps/desktop/src/hooks/workspaceRuntimeProjection.test.ts`, `apps/desktop/src/hooks/useMainWindowWorkspace.ts`.
- **Risk:** medium.
- **Safe now/later/not yet:** safe now after prep audit, if implemented as a pure resolver only. Keep assignment, warning side effects, save/flush, closed-tab stack updates, refocus, and prefetch cache updates in the hook.

### 3. `useWorkspaceVaultMarkdownRefs`

- **Rough source location:** `apps/desktop/src/hooks/useMainWindowWorkspace.ts` lines ~2463-2489 (async `collectVaultMarkdownRefs` effect).
- **Current responsibility:** Rebuilds vault markdown refs when `vaultRoot`, `fs`, or `fsRefreshNonce` changes; clears refs when no vault is active; ignores stale async results via a generation ref and abort signal.
- **Danger-zone proximity:** Medium. It is read-only with respect to note bodies and persistence, but it is triggered by refresh nonces that are also used after vault mutations and watcher-driven updates. It must not absorb watcher/reconcile behavior.
- **Testability:** Medium. A focused hook test can mock `collectVaultMarkdownRefs`/`VaultFilesystem`, assert stale-generation suppression, abort cleanup, and no-vault clearing.
- **Likely files touched:** new `apps/desktop/src/hooks/workspaceVaultMarkdownRefs.ts`, new test file, `apps/desktop/src/hooks/useMainWindowWorkspace.ts`.
- **Risk:** medium.
- **Safe now/later/not yet:** later.

### 4. `deriveDefaultActiveTodayHubRestore`

- **Rough source location:** `apps/desktop/src/hooks/useMainWindowWorkspace.ts` lines ~3915-3977 (post-restore default active Today hub effect).
- **Current responsibility:** After restore completes, chooses a default active Today hub when none is active, switches away from a deleted active hub, and writes the active hub snapshot into `todayHubWorkspacesForSave`.
- **Danger-zone proximity:** Medium. It avoids the explicit save/cache/watch danger zones, but it is close to shell restore and Today Hub workspace persistence state.
- **Testability:** High if limited to a pure decision helper: current active hub, restored-vault match, hub list, selected URI, stored tabs, and expected snapshot.
- **Likely files touched:** `apps/desktop/src/hooks/workspaceTodayHubDerived.ts` or `apps/desktop/src/hooks/workspaceInboxShellRestoreBridge.ts`, corresponding test file, `apps/desktop/src/hooks/useMainWindowWorkspace.ts`.
- **Risk:** medium.
- **Safe now/later/not yet:** later.

### 5. `normalizeWorkspaceVaultRootPath`

- **Rough source location:** `apps/desktop/src/hooks/useMainWindowWorkspace.ts` lines ~257-259, with call sites around lines ~710, ~3802, and ~3919.
- **Current responsibility:** Canonicalizes a vault root for workspace restore/projection comparisons.
- **Danger-zone proximity:** Low. Pure string normalization only.
- **Testability:** High. Tests can cover trailing slash removal, Windows separators, already-normalized roots, and empty-ish roots if the helper accepts them.
- **Likely files touched:** new or existing small helper near workspace restore/projection code, test file, `apps/desktop/src/hooks/useMainWindowWorkspace.ts`.
- **Risk:** low.
- **Safe now/later/not yet:** safe now, but low value.

## Recommended Next Extraction

Recommend **`resolveModelBackedLegacyTabStrip`** as the next minimal implementation PR.

The `hasReopenableClosedEditorTab` extraction is complete. The next candidate is medium risk because it crosses tab open/close orchestration, but the audited extraction can stay pure: resolve model-derived vs legacy tabs, return mismatch metadata, and leave all side effects in `useMainWindowWorkspace.ts`. `normalizeWorkspaceVaultRootPath` remains safe but lower value.

# ADR 002: `useMainWindowWorkspace` decompositie baseline

## Status

Proposed — baseline capture for the phased extraction plan in `.claude/plans/useMainWindowWorkspace-decompositie.md`, **updated after Phase 4** (vault tree commands extracted to `workspaceTreeCommands.ts`, 2026-05-16).

## Context

`apps/desktop/src/hooks/useMainWindowWorkspace.ts` is the desktop workspace orchestrator hook. It still owns a large amount of UI state, effect wiring, and command coordination even though a number of helper modules and bridge tests already exist.

This ADR records the starting point for the phased decomposition so later PRs can compare against a fixed snapshot instead of ad hoc recollection.

## Baseline snapshot

- File size: `4062` LOC for `apps/desktop/src/hooks/useMainWindowWorkspace.ts`.
- Direct dependency surface: `19` `import` statements, of which `10` are local relative imports and `9` are package imports.
- Related test surface: `19` desktop hook test files in `apps/desktop/src/hooks/` currently cover this orchestration area, including `2` direct `useMainWindowWorkspace.*` tests and `17` adjacent bridge/helper tests.

## Post–Phase 4 snapshot (2026-05-16)

Phase 4 moved vault tree mutations out of the orchestrator into command modules with explicit `TreeCommandContext`. This section records the **current** module boundaries and line counts so later phases compare against an up-to-date snapshot (the baseline block above stays the historical anchor).

### Line counts (measured with `wc -l`)

| Artifact | LOC |
|---|---:|
| `apps/desktop/src/hooks/useMainWindowWorkspace.ts` | 2866 |
| `apps/desktop/src/hooks/workspaceTreeCommands.ts` | 656 |
| `apps/desktop/src/hooks/workspaceTreeCommands.test.ts` | 393 |
| `apps/desktop/src/hooks/workspaceVaultTreeMutations.ts` | 66 |

Net change for `useMainWindowWorkspace.ts` versus the Phase 0 baseline in this ADR: **4062 → 2866** (−1196 LOC).

### Orchestration module map (extracted stores and commands)

These modules are composed by `useMainWindowWorkspace` today (Phase 4 complete). They are **not** the full import graph; they are the decomposition targets called out in `.claude/plans/reviewpunten-fase0-6-aanpak.md` step 5.

| Module | Responsibility |
|---|---|
| `useVaultBootstrap.ts` | Vault root, shared/local settings, device id, `hydrateVault` and first-launch wiring |
| `useDiskConflictState.ts` | Hard/soft disk conflict state, defer timer, resolver callbacks |
| `useMergeViewState.ts` | Merge view state and merge/discard callbacks |
| `useInboxEditorState.ts` | Inbox editor surface state (selection, body, frontmatter, compose guards, scroll directives); **not** the note-body cache (`inboxContentByUri` / `lastPersistedRef` — planned Phase 7) |
| `useEditorTabsState.ts` | Editor tab strip + active tab id (facade over shadow model where applicable), closed-tab stack bump API |
| `workspaceOpenMarkdownCommand.ts` | `runOpenMarkdownInEditorCommand` and the open pipeline sub-steps |
| `workspaceTreeCommands.ts` | `runDeleteNote`, `runDeleteFolder`, `runRenameFolder`, `runMoveVaultTreeItem`, `runBulkDeleteVaultTreeItems`, `runBulkMoveVaultTreeItems` (+ internal commit helpers) |
| `workspaceVaultTreeMutations.ts` | Pure helpers: bulk-delete tab/scroll pruning predicates and path collection |

### Phase 0 invariants checklist

The **Per-phase invariants checklist** in this ADR was added under Phase 0 and remains the authoritative gate for every decomposition PR. Step 5 does not duplicate it.

### Forward work (Phases 7–10)

Later planned extractions (`useNotesListing` + inbox body cache, Today hubs consolidation, compose commands + shell restore cleanup, final mirror cleanup per `.claude/plans/useMainWindowWorkspace-decompositie.md`) can proceed **without** re-disentangling inline vault tree command bodies from the orchestrator. Legacy workspace bridge modules and Phase 1 substeps 4–5 (runtime tab / shadow sync cleanup) stay on their **own** track and are unchanged by Phase 4 completion.

## Decision

1. Keep the decomposition phased and PR-sized.
2. Treat the workspace model migration as the primary ordering constraint.
3. Add a shape-level smoke test before larger refactors so the hook return contract has a cheap regression sentinel.
4. Use the existing desktop Vitest isolation rules ([ADR 001](./001-adr-vitest-desktop-test-isolation.md)) and the current integration harness for baseline validation.

## Phase 1 Matrix

Legacy state still exists as a synchronous React/runtime mirror because many command paths read refs before React commits. Phase 1 changes the source-of-truth direction: `WorkspaceModel` is authoritative for read-only workspace views and persistence; legacy state is synchronized from model-derived views.

| Legacy field | Former role | Phase 1 source |
|---|---|---|
| `activeTodayHubUri` | Active Today hub for selectors, persistence, switch bookkeeping | `workspaceShadowModel.activeHub`; legacy state/ref mirrors it |
| `activeEditorTabId` | Active editor tab id for selectors, return shape, history | `activeSurfaceTabIdFromWorkspaceModel(workspaceShadowModel)`; legacy state/ref mirrors it |
| `editorWorkspaceTabs` | Active hub tab strip for return shape and persistence | `activeEditorWorkspaceTabsFromWorkspaceModel(workspaceShadowModel)`; legacy state/ref mirrors it |
| `homeStatesByHub` | Home history map for selector subtitle and history controls | `workspaceHomeStatesFromWorkspaceModel(workspaceShadowModel)`; legacy state/ref mirrors it |
| `todayHubWorkspacesForSave` | Persistence/switch snapshot map | `serializeWorkspaceModelToPersistence(workspaceShadowModel)` for persistence and switch reads; legacy setter remains for existing switch-write plumbing |

The old runtime-projection layout effect and DEV persistence divergence check are removed from the hook. Shell restore now writes the model synchronously before marking restore complete, so model-derived persistence is available immediately for restored inactive hub workspaces.

## Consequences

- The baseline is explicit and can be updated in later phases when the hook shrinks.
- The smoke test gives a low-cost guard against accidental return-shape regressions while the hook is being split.
- Phase 1 keeps legacy refs/state for imperative command compatibility, but they are now mirrors rather than the read source for persistence, selector display, tab return shape, and history button state.

## Per-phase invariants checklist

Each PR in this decomposition must explicitly verify the following (see also the PR checklist in `.claude/plans/reviewpunten-fase0-6-aanpak.md`).

1. **Note-body cache** (`CLAUDE.md`, Desktop: Note body cache): keep `inboxContentByUri`, `lastPersistedRef`, and `lastPersistedExternalMutationSeqRef` **in sync together** for every change that touches editor or on-disk note body state.
2. **Vault disk sync** (`CLAUDE.md`, Desktop: Vault disk sync invariants): do not weaken watcher routing, cache invalidation, or conflict classification without concurrent tests and spec updates where needed.
3. **Vitest isolation** ([ADR 001](./001-adr-vitest-desktop-test-isolation.md), `CLAUDE.md`): `restoreMocks: false`, `isolate: true`, and **no** `@tauri-apps/*` imports in `vitest.setup.ts` at module scope.
4. **CodeMirror layout** (`CLAUDE.md`, Desktop: CodeMirror layout): use `padding`, not `margin`, for vertical spacing on `.cm-line`, line decorations, and block-widget roots whose height CodeMirror measures.

## Test execution

Run the desktop smoke test (`useMainWindowWorkspace.smoke.test.ts` via Vitest) with **`apps/desktop` as the current working directory**:

```bash
cd apps/desktop && npx vitest run
```

From the monorepo root (for example `npx vitest run apps/desktop/...`), the same suite can fail with `document is not defined` because the happy-dom environment is not initialized the way this workspace expects.

## `__resetForTests()` policy

- **`renderHook`-tested state-store sub-hooks** (for example `useVaultBootstrap`, `useDiskConflictState`) normally get a fresh hook instance per test and **do not** need a module-level `__resetForTests()` export.
- **`vitest.setup.ts` teardown** may call `__resetForTests()` only from modules that **do not** import `@tauri-apps/*` at module scope; see [ADR 001](./001-adr-vitest-desktop-test-isolation.md).
- **Modules that import Tauri at module scope** should still export `__resetForTests()` where needed, but tests that mock Tauri must call it from `beforeEach` / `afterEach` in those files — not from global setup before the mocks are installed.

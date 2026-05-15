# ADR: `useMainWindowWorkspace` decompositie baseline

## Status

Proposed — baseline capture for the phased extraction plan in `.claude/plans/useMainWindowWorkspace-decompositie.md`.

## Context

`apps/desktop/src/hooks/useMainWindowWorkspace.ts` is the desktop workspace orchestrator hook. It still owns a large amount of UI state, effect wiring, and command coordination even though a number of helper modules and bridge tests already exist.

This ADR records the starting point for the phased decomposition so later PRs can compare against a fixed snapshot instead of ad hoc recollection.

## Baseline snapshot

- File size: `4062` LOC for `apps/desktop/src/hooks/useMainWindowWorkspace.ts`.
- Direct dependency surface: `19` `import` statements, of which `10` are local relative imports and `9` are package imports.
- Related test surface: `19` desktop hook test files in `apps/desktop/src/hooks/` currently cover this orchestration area, including `2` direct `useMainWindowWorkspace.*` tests and `17` adjacent bridge/helper tests.

## Decision

1. Keep the decomposition phased and PR-sized.
2. Treat the workspace model migration as the primary ordering constraint.
3. Add a shape-level smoke test before larger refactors so the hook return contract has a cheap regression sentinel.
4. Use the existing desktop Vitest isolation rules and the current integration harness for baseline validation.

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

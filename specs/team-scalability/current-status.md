# Team Scalability Current Status

Date: 2026-05-14

## Completed

- Phase 1 extracted three helpers from `useMainWindowWorkspace.ts` with second-model reviews and focused tests:
  - `injectActiveHubIntoTodayHubPersistMap`
  - `popNextReopenableClosedTabRecord`
  - `collectShadowDivergenceDevDiagnostics`
- Phase 2 moved two low-risk `src/lib/` domains:
  - created `apps/desktop/src/lib/layout/`
  - filled existing `apps/desktop/src/lib/todayHub/` with root Today Hub helpers

## Current Metrics

- `useMainWindowWorkspace.ts`: 4118 -> 4087 LOC
- `apps/desktop/src/lib/` root files: 142 -> 130

## Process Notes

- Small prep entries with exact file lists, import call sites, targeted tests, and non-goals made reviews fast and concrete.
- Reviews caught issues before merge in phase 1, and phase 2 confirmed that file-move reviews still need body, constant, persisted value, default, and test assertion comparisons.
- Existing domain folders were safer early targets than broad new domain moves.

## Current Decision

Pause phase 2 after two successful domain moves.

Next candidate: `clipboard/`, but only after a fresh prep entry and explicit editor paste/import review.

Deferred high-risk domains:

- `vault/`
- `editor/`
- `gitSync/`
- `workspaceModel/`
- `tauri/`

Contributor-process docs remain deferred: no `CODEOWNERS`, `CONTRIBUTING.md`, or PR template yet.

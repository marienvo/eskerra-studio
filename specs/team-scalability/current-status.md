# Team Scalability Current Status

Date: 2026-05-14

## Completed

- Phase 1 extracted three helpers from `useMainWindowWorkspace.ts` with second-model reviews and focused tests:
  - `injectActiveHubIntoTodayHubPersistMap`
  - `popNextReopenableClosedTabRecord`
  - `collectShadowDivergenceDevDiagnostics`
- Phase 2 moved four `src/lib/` domains:
  - created `apps/desktop/src/lib/layout/`
  - filled existing `apps/desktop/src/lib/todayHub/` with root Today Hub helpers
  - created `apps/desktop/src/lib/clipboard/`
  - created `apps/desktop/src/lib/vault/` (two pure helpers: `vaultBacklinkBodySeed`, `countInboxVaultMarkdownRefs`)

## Current Metrics

- `useMainWindowWorkspace.ts`: 4118 -> 4087 LOC
- `apps/desktop/src/lib/` root files: 142 -> 118

## Process Notes

- Small prep entries with exact file lists, import call sites, targeted tests, and non-goals made reviews fast and concrete.
- Reviews caught issues before merge in phase 1, and phase 2 confirmed that file-move reviews still need body, constant, persisted value, default, and test assertion comparisons.
- Existing domain folders were safer early targets than broad new domain moves.
- `clipboard/` was movable because prep separated clipboard helpers from attachment persistence, vault preview, and storage files.
- `vault/` was started with only the two safest tested pure helpers; the rest of the vault group remains paused.

## Current Decision

Pause phase 2 after four successful domain moves.

Next candidates require a fresh high-effort audit first.

A vault-specific audit exists at `specs/team-scalability/phase-2-vault-domain-audit.md`. It keeps save, watcher, merge, bootstrap, and attachment/image persistence paths paused. Tree helpers, URI/path helpers, and link/rename/merge helpers each need a separate prep entry before any move.

Deferred high-risk domains (remaining work):

- `vault/` — additional subgroups (tree, URI/path, link/rename/merge, attachment/image, bootstrap/save/watcher) remain paused
- `editor/`
- `gitSync/`
- `workspaceModel/`
- `tauri/`

Contributor-process docs remain deferred: no `CODEOWNERS`, `CONTRIBUTING.md`, or PR template yet.

# ADR 002: `useMainWindowWorkspace` decompositie baseline

## Status

Accepted — phased extraction through **Phase 10** is merged (2026-05-16). This ADR keeps the **Phase 0 baseline** as a historical anchor and records the **post–Phase 10** orchestration snapshot plus **Phase 11+** forward work. The original plan file (`.claude/plans/useMainWindowWorkspace-decompositie.md`) may be archived once this ADR and any tracking issue reflect the same forward items.

## Context

`apps/desktop/src/hooks/useMainWindowWorkspace.ts` is the desktop workspace orchestrator hook. Much of the former inline command and store logic now lives in the modules listed under **Post–Phase 10 snapshot**; the hook remains the wiring layer for effects, refs, and cross-feature callbacks.

This ADR records the Phase 0 baseline and the post–Phase 10 decomposition snapshot so later PRs can compare against fixed numbers instead of ad hoc recollection.

## Baseline snapshot

- File size: `4062` LOC for `apps/desktop/src/hooks/useMainWindowWorkspace.ts`.
- Direct dependency surface: `19` `import` statements, of which `10` are local relative imports and `9` are package imports.
- Related test surface: `19` desktop hook test files in `apps/desktop/src/hooks/` currently cover this orchestration area, including `2` direct `useMainWindowWorkspace.*` tests and `17` adjacent bridge/helper tests.

## Post–Phase 10 snapshot (2026-05-16)

Phases **7–10** landed additional stores and command modules (`useNotesListing`, `useInboxBodyCache`, `useTodayHubsState`, `useInboxShellRestore`, `workspaceComposeCommands`) while shrinking the orchestrator. This section records **current** module boundaries and line counts so later work compares against an up-to-date snapshot (the baseline block above stays the historical anchor).

### Line counts (measured with `wc -l`)

| Artifact | LOC |
|---|---:|
| `apps/desktop/src/hooks/useMainWindowWorkspace.ts` | 2049 |
| `apps/desktop/src/hooks/useNotesListing.ts` | 67 |
| `apps/desktop/src/hooks/useNotesListing.test.ts` | 71 |
| `apps/desktop/src/hooks/useInboxBodyCache.ts` | 96 |
| `apps/desktop/src/hooks/useInboxBodyCache.test.ts` | 106 |
| `apps/desktop/src/hooks/useTodayHubsState.ts` | 913 |
| `apps/desktop/src/hooks/useTodayHubsState.test.ts` | 133 |
| `apps/desktop/src/hooks/useInboxShellRestore.ts` | 322 |
| `apps/desktop/src/hooks/workspaceComposeCommands.ts` | 204 |
| `apps/desktop/src/hooks/workspaceComposeCommands.test.ts` | 103 |
| `apps/desktop/src/hooks/workspaceTreeCommands.ts` | 650 |
| `apps/desktop/src/hooks/workspaceTreeCommands.test.ts` | 417 |
| `apps/desktop/src/hooks/workspaceVaultTreeMutations.ts` | 66 |

Net change for `useMainWindowWorkspace.ts` versus the Phase 0 baseline in this ADR: **4062 → 2049** (−2013 LOC).

### Orchestration module map (extracted stores and commands)

These modules are composed by `useMainWindowWorkspace` today through **Phase 10**. They are **not** the full import graph; they are the main decomposition surfaces for workspace orchestration.

| Module | Responsibility |
|---|---|
| `useVaultBootstrap.ts` | Vault root, shared/local settings, device id, `hydrateVault` and first-launch wiring |
| `useDiskConflictState.ts` | Hard/soft disk conflict state, defer timer, resolver callbacks |
| `useMergeViewState.ts` | Merge view state and merge/discard callbacks |
| `useInboxEditorState.ts` | Inbox editor surface state (selection, body, frontmatter, compose guards, scroll directives); not the note-body cache ownership |
| `useEditorTabsState.ts` | Editor tab strip + active tab id (facade over shadow model where applicable), closed-tab stack bump API |
| `useNotesListing.ts` | Inbox listing + refresh nonces tied to vault listing / podcast FS bumps |
| `useInboxBodyCache.ts` | `inboxContentByUri` + `lastPersistedRef` / `lastPersistedExternalMutationSeqRef` state and the **only** supported mutation API for disk-known snapshots (see checklist) |
| `useTodayHubsState.ts` | Today hub shell state, hub switch, row prehydrate/persist, home history mirrors, vault Today ref sync helpers |
| `useInboxShellRestore.ts` | Persisted inbox shell restore effect + bridge callbacks into workspace / shadow model |
| `workspaceComposeCommands.ts` | Compose flows: `runStartNewEntry`, `runCancelNewEntry`, `runSubmitNewEntry`, `runCleanNoteInbox`, `runAddNote` |
| `workspaceOpenMarkdownCommand.ts` | `runOpenMarkdownInEditorCommand` and the open pipeline sub-steps |
| `workspaceTreeCommands.ts` | Vault tree mutations: delete/rename/move/bulk (+ internal commit helpers) via `TreeCommandContext` |
| `workspaceVaultTreeMutations.ts` | Pure helpers: bulk-delete tab/scroll pruning predicates and path collection |
| `workspacePersistence.ts` | Autosave chain, flush, enqueue persist, merge cache helpers after successful writes |
| `workspaceVaultWatchEffects.ts` | Tauri `vault-files-changed` subscription, reconcile queueing, indexing touches, open-tab probe telemetry |
| `workspaceFsWatchReconcile.ts` | Open-tab inbox reconcile after vault FS events (tabs, cache, editor, disk conflicts) |

### Phase 0 invariants checklist

The **Per-phase invariants checklist** in this ADR was added under Phase 0 and remains the authoritative gate for every decomposition PR.

### Forward work (Phase 11+)

1. **Tab command extraction** — Move large tab helpers (`closeEditorTab`, `closeOtherEditorTabs`, `closeAllEditorTabs`, reorder/reopen/activate/select/refocus paths, ~350 LOC class) into a `workspaceTabCommands.ts` (or equivalent) with a `TabCommandContext`, matching the pattern used for tree commands and open-markdown. This is the largest remaining shrink lever for `useMainWindowWorkspace.ts`; a realistic post-extraction target for the orchestrator is on the order of **~1700 LOC** (not the original 600–800 LOC plan ceiling unless multiple optional splits also land).
2. **Risk-path tests** — Add focused Vitest coverage for `useTodayHubsState` (hub switch, prehydrate/persist rows, `syncHubWorkspacesToVaultTodayRefsAction` ordering vs `vaultMarkdownRefsReady`) and for `useInboxShellRestore` before stacking more extractions on top.
3. **Optional structural splits** — Split `useTodayHubsState` into a smaller state-store vs orchestration module; optionally extract a thin `useEditorHistory` (~130 LOC) from the main hook.
4. **Legacy bridge / Phase 1 follow-ups** — Runtime tab / shadow sync cleanup and other bridge-only items stay on their **own** track; they are not blocked by Phase 10 completion.

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
2. **`lastPersisted*` mutation discipline**: do not assign to `lastPersistedRef.current` or bump `lastPersistedExternalMutationSeqRef` outside `useInboxBodyCache.ts`. Use `setLastPersistedSnapshot`, `clearLastPersistedSnapshot`, and (for vault FS reconcile / open-tab probe) `writeLastPersistedSnapshotWithoutSeqBump` + `bumpLastPersistedExternalMutationSeq` as documented in `CLAUDE.md`. Desktop ESLint (`apps/desktop/eslint.config.js`, `no-restricted-syntax` on `src/hooks/**/*.ts`) enforces this outside tests and the hook module.
3. **Vault disk sync** (`CLAUDE.md`, Desktop: Vault disk sync invariants): do not weaken watcher routing, cache invalidation, or conflict classification without concurrent tests and spec updates where needed.
4. **Vitest isolation** ([ADR 001](./001-adr-vitest-desktop-test-isolation.md), `CLAUDE.md`): `restoreMocks: false`, `isolate: true`, and **no** `@tauri-apps/*` imports in `vitest.setup.ts` at module scope.
5. **CodeMirror layout** (`CLAUDE.md`, Desktop: CodeMirror layout): use `padding`, not `margin`, for vertical spacing on `.cm-line`, line decorations, and block-widget roots whose height CodeMirror measures.

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

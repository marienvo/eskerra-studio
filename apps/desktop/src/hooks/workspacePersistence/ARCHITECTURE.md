# Inbox note persistence (`workspacePersistence/`)

Navigation index for autosave, flush, and deferred outgoing saves. Product rules: [`specs/architecture/desktop-editor.md`](../../../../specs/architecture/desktop-editor.md).

**Not this package:** [`workspacePersistenceBridge.ts`](../workspacePersistenceBridge.ts) serializes `WorkspaceModel` shell JSON for disk — unrelated to inbox `.md` saves.

## Start here

| Module | Role |
|--------|------|
| [`useWorkspacePersistence.ts`](useWorkspacePersistence.ts) | Public hook; composes commands + autosave effect |
| [`useInboxPersistCommands.ts`](useInboxPersistCommands.ts) | Save chain, flush, shortcut, outgoing enqueue |
| [`useInboxAutosaveEffect.ts`](useInboxAutosaveEffect.ts) | Debounced autosave scheduling |
| [`persistActiveInboxNote.ts`](persistActiveInboxNote.ts) | Active-note persist body (awaited on flush/autosave) |
| [`persistOutgoingNoteSnapshot.ts`](persistOutgoingNoteSnapshot.ts) | Leave-note deferred persist (fire-and-forget on chain) |
| [`shouldScheduleInboxAutosave.ts`](shouldScheduleInboxAutosave.ts) | Pure autosave gate |
| [`workspacePersistenceTypes.ts`](workspacePersistenceTypes.ts) | `WorkspacePersistenceDeps` (`refs` + `actions` + `state`) |

## Two persist paths

1. **Active** (`persistActiveInboxNote`): current `selectedUri`; awaited by `enqueueInboxPersist` / flush; always merges cache on success.
2. **Outgoing** (`persistOutgoingNoteSnapshot`): fixed URI + snapshot from note switch; **not** awaited by open routing; skip helpers in [`inboxNoteBodyCache.ts`](../inboxNoteBodyCache.ts).

Both share [`enqueueOnSaveChain.ts`](enqueueOnSaveChain.ts) via `saveChainRef` (same chain as Today Hub row saves).

## Invariants

- `lastPersistedRef` updates only through `setLastPersistedSnapshot` from actions (never assign `.current` here).
- `inboxContentByUri` must match disk-known body after every successful persist (see desktop note-body cache rules).

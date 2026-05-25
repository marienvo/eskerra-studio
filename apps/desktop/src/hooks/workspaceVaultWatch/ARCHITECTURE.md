# Vault filesystem watch (`workspaceVaultWatch/`)

Tauri `vault-files-changed` subscription, index maintenance, vault refresh, and open-tab reconcile queue. Product rules: [`specs/architecture/desktop-editor.md`](../../../../specs/architecture/desktop-editor.md) (external FS changes); coarse alert policy: [`specs/observability/desktop-vault-watch-coarse-alert.md`](../../../../specs/observability/desktop-vault-watch-coarse-alert.md).

## Start here

| Module | Role |
|--------|------|
| [`useWorkspaceVaultWatchEffects.ts`](useWorkspaceVaultWatchEffects.ts) | React `useEffect`: `listen`, mount probe listeners |
| [`vaultWatchSession.ts`](vaultWatchSession.ts) | Per-vault session: event handler, reconcile queue, open-tab probe |
| [`buildVaultWatchReconcileEnv.ts`](buildVaultWatchReconcileEnv.ts) | Builds `ReconcileFsOpenMarkdownEnv` / Today env |
| [`vaultWatchObservability.ts`](vaultWatchObservability.ts) | Path signatures, backend/reason normalization for Sentry |
| [`vaultWatchTypes.ts`](vaultWatchTypes.ts) | `VaultWatchDeps` (`refs` + `actions` + `callbacks`) |

Reconcile implementation stays in [`workspaceFsWatchReconcile.ts`](../workspaceFsWatchReconcile.ts).

## Event flow

1. `planVaultFilesChangedEvent` — coarse vs path-limited, podcast refresh flag.
2. Incremental index touch (deduped) or full reindex schedule.
3. Coarse: Sentry warnings + full subtree invalidation (never path-limited).
4. Refresh work (deduped on coarse): `refreshNotes`, FS nonce, settings reload, reconcile queue.

**Open-tab probe** (focus + ~10s interval): empty-path reconcile with noop `bumpLastPersistedExternalMutationSeq`; telemetry if selected note body drifted without a prior watcher mutation.

## Invariants

- `coarse: true` → treat as full-vault invalidation.
- Probe telemetry fingerprint: `eskerra.desktop.vault_watch_open_tab_probe_reload`.
- Do not assign `lastPersistedRef.current` here; use `writeLastPersistedSnapshotWithoutSeqBump` / `bumpLastPersistedExternalMutationSeq` from `useInboxBodyCache`.

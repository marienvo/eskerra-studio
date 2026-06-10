# Git Sync Engine for Eskerra

## name

Vault Git Sync Engine (Rust/Tauri) — `eskerra-vault-git-sync`.

## overview

A policy-driven Git sync feature for Eskerra desktop. The sync engine lives in the Rust/Tauri layer, shells out to the system `git` CLI, and exposes a small set of Tauri commands. The frontend owns all product decisions (which vault, which config, when to run) and renders results; Rust owns correctness, safety, locking, and Git mechanics.

**Status (verified against the codebase 2026-06-10):** the engine and the full desktop sync UX are shipped — manual sync (button + Ctrl/Cmd+S), sync-on-close with Shift bypass, sync-on-startup with remote pull, batched autosync, remote polling, and status-chip UX including transient feedback and an autosync countdown. What remains in this plan:

1. **Phase M — conflict backup and policy resolution** (the main remaining engine work; everything is `manual` policy today and merge conflicts only produce a snapshot branch + abort).
2. **Phase K — `GitStatusChip` Storybook coverage** (small, independent).
3. **Phase 8 — code quality pass** over the touched modules (optional, scoped).

**Phase L (settings/config UI) is superseded** by `specs/plans/desktop-settings-workspace.md` (§7 "Sync" covers `syncBehavior.git`: remote name, include/exclude globs, backup directory, commit message template, conflict callout toggle/template, autosync toggle and timings). This plan no longer carries a settings phase; the hardcoded defaults below stay until that plan lands.

Non-goals (unchanged):
- libgit2 / `git2` crate — we use the `git` CLI. It matches the user's existing credential helpers, SSH config, hooks, and signing with zero new surface; `git merge`'s conflict machinery (rename detection, `:1:`/`:2:`/`:3:` stages) is exactly what conflict resolution needs; every step is a reproducible shell command.
- Rename-conflict heuristics beyond what `git merge` already handles (treated as `Manual`).
- Submodules, LFS, partial clones, shallow repos.
- iOS, mobile, or web parity. Desktop only (Linux reference environment).
- Authentication prompts inside the app — credentials are delegated to the user's existing Git/credential-helper setup.
- Structured per-step progress events (`vault-git-sync:progress`, `runId`, raw log streaming). Designed in an earlier revision of this plan, never implemented, and not missed: sync is fast enough that the chip "Syncing…" state plus the typed result covers the UX. Revisit only if a concrete need appears.

## current state

### Rust engine — `apps/desktop/src-tauri/src/vault_git_sync/`

| Module | Responsibility |
|---|---|
| `cli.rs` | `GitCmd` wrapper: cwd, env, timeout with back-off polling (10→25→100 ms), structured output |
| `commands.rs` | Tauri commands: `vault_git_status`, `vault_git_current_branch`, `vault_git_stage_plan`, `vault_git_sync_run`, `vault_git_remote_status` |
| `config.rs` | `SyncConfig` + validation; globs compiled once via `globset`; `ConflictPolicy` / `ConflictStrategy` (`PreferLocal` \| `PreferRemote` \| `Manual`) / `MarkdownCalloutConfig` types exist and are validated, but no code consumes them yet |
| `errors.rs` | Typed `SyncError` enum (includes `ConflictResolutionFailed` and `AuthenticationFailed` variants, already serialized to TS) |
| `local_commit.rs` | Stage-plan application + local sync commit with `{timestamp}`/`{host}` template; `skip_commit_hooks` honored (default `true` → `--no-verify`) |
| `lock.rs` | Per-vault advisory file lock outside the vault: `<locks_dir>/git-sync-<sha256(canonical_vault_path)[..16]>.lock`, OS file locking, RAII release |
| `stage_plan.rs` | Read-only stage plan from `git status --porcelain=v2 -z`, partitioned by include/exclude globs |
| `status.rs` | Local status (`git_status`) and `remote_status` (= narrow `git fetch --quiet <remote> <branch>` + local status); unsafe-state detection. A stale `REBASE_HEAD` without `rebase-merge/`/`rebase-apply/` is **not** unsafe (fix 2026-06-07) |
| `sync_run.rs` | `sync_fetch_merge_push`: lock → validate → local commit → record pre-merge HEAD → fetch → verify remote branch → merge `--no-edit` → push. On merge failure: snapshot branch `eskerra/sync-snapshot-<timestamp>` (up to 8 collision retries), `git merge --abort`, return `MergeFailed { stderr, snapshot_branch, pre_merge_sha }`. No hard reset to remote, ever |
| `validation.rs` | Safety checks (see below) |

Tests are inline `mod tests` per module, run real `git` against `tempfile` repos (local + bare remote), no mocks of `git` itself.

**Safety checks** (in order, after lock acquisition, before any mutation; each failure is a typed error):
1. inside a work tree, and `--show-toplevel` equals the canonicalized vault path (refuse parent repos) → `NotGitRepository`
2. HEAD is a symbolic ref → `DetachedHead`
3. no merge/rebase/cherry-pick/revert/bisect in progress → `UnsafeGitState{kind}` (rebase = `rebase-merge/` or `rebase-apply/` present; `REBASE_HEAD` alone is tolerated)
4. no `.git/index.lock` → `UnsafeGitState::IndexLock`
5. clean index (`git diff --cached --quiet`) → `UnsafeGitState::IndexNotClean` — we refuse to fold pre-staged user changes into a sync commit
6. checked-out branch equals `config.branch` → `WrongBranch{expected, actual}`
7. remote exists → `RemoteMissing`; remote branch existence is verified **after fetch** → `RemoteBranchMissing`
8. config validation up front → `InvalidConfig`

Result type (actual, `sync_run.rs` — note: leaner than the original design; no `raw_log`, no status enum, no `conflict_backups` yet):

```rust
pub struct SyncRunResult {
    pub local_commit: LocalCommitResult,
    pub pre_merge_sha: Option<String>,
    pub pushed: bool,
    pub snapshot_branch: Option<String>,
    pub final_head_sha: Option<String>,
}
```

### Frontend — actual layout

There is no `apps/desktop/src/features/gitSync/` module (earlier revisions of this plan assumed one). The code lives in:

- `apps/desktop/src/lib/`: `tauriVaultGitSync.ts` (typed client for the five commands), `gitSyncConfig.ts` (`buildManualGitSyncConfig`), `gitSyncPreflight.ts` (`shouldRunVaultGitSync(status, intent)`), `gitSyncManualView.ts` (disabled reasons, success/error formatting), `manualSyncClose.ts` (close orchestration, 30 s timeout), `gitStatusView.ts`, `gitAutosyncCountdown.ts`
- `apps/desktop/src/hooks/`: `useVaultGitStatus`, `useVaultGitCurrentBranch`, `useManualVaultGitSync` (single guarded `run({silent?})` shared by button / Ctrl+S / close / startup / autosync), `useVaultGitStartupSync`, `useVaultGitAutosyncScheduler`, `useVaultGitRemoteRefresh`, `useVaultGitRemoteStatusPolling`, `useVaultGitLocalWriteStatusRefresh`, `useVaultGitAutosyncCountdown`, `useGitSyncTransientStatus`
- `apps/desktop/src/shell/`: `useAppGitSyncOrchestration` (wires everything, owns the shared `backgroundGitOperationBusyRef`, runs the calendar/feed pipeline before manual and close sync), `useAppOsCloseSync`, `CloseSyncProgressOverlay`
- `apps/desktop/src/components/`: `GitStatusChip` (presentational; syncing > transient > unsafe > wrong branch > diverged > remote/local states; autosync countdown "Syncs in M:SS")

### Shipped behavior summary

- **Manual sync**: status-bar button + Ctrl/Cmd+S, both through the same gates (`getManualSyncDisabledReason`: running, branch loading/unavailable, status loading/error, unsafe state, staged changes, wrong branch). Ctrl+S additionally preflights and silently no-ops when there is nothing to sync; the button always runs.
- **Branch/remote**: branch is read from the actual checkout (`git symbolic-ref --short HEAD` via `useVaultGitCurrentBranch`; detached HEAD surfaces as such); status and sync consume the same value, so they cannot drift. Remote is hardcoded `origin` until the settings plan lands.
- **Local write → status**: every successful vault write (notes and TodayHub) advances `saveSettledNonce`; `useVaultGitLocalWriteStatusRefresh` refreshes local status only (no fetch, no sync). `useVaultGitStatus` is latest-request-wins.
- **Remote polling**: one fetch when the vault opens (with a 250 ms retry when the initial fetch hits a busy Git ref), then every 5 min (`REMOTE_POLL_INTERVAL_MS`) plus on `visibilitychange`; skipped while any sync runs; failures keep last-known status silently.
- **Autosync**: `useVaultGitAutosyncScheduler` coalesces pending writes behind `AUTOSYNC_INTERVAL_MS = 5 min`, with `AUTOSYNC_RETRY_DELAY_MS = 30 s` after failures and `AUTOSYNC_MIN_CHANGE_AGE_MS = 60 s` so a just-written change isn't synced mid-burst. At most one run in flight; pending work survives failed/skipped runs and vault switches reset it. Silent on success and failure.
- **Startup sync**: once per vault per session, after the initial remote fetch settles; pulls behind-only remote changes; silent on success, error notification on failure.
- **Close sync**: normal close = sync-then-close (custom titlebar and OS close both intercepted); Shift bypasses; failure/timeout (30 s) keeps the app open; blocking `CloseSyncProgressOverlay` while close sync runs; preflight skips sync and closes immediately when clean or when status is stale/unknown (behind-only does not block close).
- **Pre-sync orchestration**: `useAppGitSyncOrchestration` runs the calendar/ICS/feed pipeline before manual and close sync so generated Today Hub content is committed in the same sync; pipeline failures never block the Git sync.
- **Feedback**: success feedback is a transient status-bar chip state (~3 s, `useGitSyncTransientStatus` + `formatVaultGitSyncSuccessChip`), not a toast; failures use session notifications. Background paths are silent.
- **Shared busy gate**: `backgroundGitOperationBusyRef` prevents remote polling and autosync from overlapping; all sync entry points share one running flag.

### Current hardcoded config (until the settings plan lands)

`buildManualGitSyncConfig(branch)` in `gitSyncConfig.ts`:

```ts
remote: 'origin',                       // GIT_SYNC_REMOTE
include: ['**/*.md'],
exclude: [],
backupDirectory: '_sync-backups',
conflictPolicies: [{glob: '**/*.md', strategy: 'manual'}],
markdownConflictCallout: {enabled: false, calloutKind: 'warning',
                          template: 'Conflict backup: [[{backup_path}]]'},
commitMessageTemplate: 'chore: sync {timestamp} {host}',
hostLabel: null,                        // Rust renders a safe local fallback
backupLocalSubdir: 'local', backupRemoteSubdir: 'remote',
timeouts: {fetchSecs: 30, pushSecs: 30, mergeSecs: 30},
allowCreateBackupDirectory: false,
skipCommitHooks: true,
```

Hardcoded-only inside Rust (protocol, not policy): implicit excludes `.git/**` and the lock dir; merge stage numbers (2 = ours, 3 = theirs).

These defaults are the source for the settings plan's §7 defaults table; keep them in sync if either changes.

## remaining work

### Phase M — conflict backup and policy resolution (primary)

Today a merge conflict always ends in: snapshot branch → `git merge --abort` → `MergeFailed` with `snapshot_branch` + `pre_merge_sha` in the error notification. That is safe but dead-ends the user, and it blocks ever shipping non-`manual` policies. Phase M implements the policy engine that this plan's config types already anticipate.

**Rust work** — new `conflicts.rs` (and a backup-path helper, either in `conflicts.rs` or a small `backup_paths.rs`), hooked into `sync_fetch_merge_push`:

When `merge_remote` fails with a non-zero exit **and** `git diff --name-only --diff-filter=U -z` lists at least one path, run conflict resolution instead of going straight to `recover_after_merge_failure`. For each unresolved path `p`:

1. **Pick a policy.** First matching glob in `config.conflict_policies` wins; no match behaves as `Manual`.
2. **`Manual`** → record the path and continue the loop. If any `Manual` paths exist after the loop, resolution fails as a whole (no partially-resolved merge commits).
3. **`PreferLocal`** → winner = ours (stage 2), loser = theirs (stage 3), backup root = `{backup_directory}/{backup_remote_subdir}`.
4. **`PreferRemote`** → winner = theirs (stage 3), loser = ours (stage 2), backup root = `{backup_directory}/{backup_local_subdir}`.
5. **Save the loser.** `git show :<loser_stage>:<p>` into a unique backup path derived from the original path + timestamp + numeric collision suffix. Two stage-missing cases, with distinct annotations:
   - **Loser stage missing** (loser deleted the file, winner kept it): nothing to back up — skip the backup; the annotation stays `winner: Local`/`Remote` per the policy, since the file survives.
   - **Winner stage missing** (winner deleted the file): skip the backup and annotate `winner: Deleted`; step 6 applies the delete. The loser's discarded content remains reachable through Git history (both conflict sides are committed), so no working-tree backup is written.
   If `allow_create_backup_directory` is `false` and the directory is missing, fail loudly (typed error), do not commit a half-resolved tree.
6. **Apply the winner.** `git checkout --ours|--theirs -- <p>`, or `git rm -f -- <p>` when the winner deleted the file.
7. **Markdown callout.** Only if `markdown_conflict_callout.enabled`, `p` matches `*.md` (case-insensitive), the winner is a real file, **and** a backup was written: prepend the rendered template (`{backup_path}`, `{timestamp}`, `{winner}`). Binary files never get a callout — detect via `git check-attr binary` (respects `.gitattributes`).
8. **Stage the resolution.** `git add -- <p>` (deletes already staged by `git rm`).

After the loop: bail to the existing snapshot+abort recovery if any path was `Manual` or `--diff-filter=U` is still non-empty (`ConflictResolutionFailed { unresolved, manual }` — variant already exists). Otherwise `git commit --no-edit` (honoring `skip_commit_hooks`) unless the index is empty (both sides made identical changes), then continue to push.

Edge cases (decided, keep as-is):
- A conflict on a file **inside the backup directory** is force-classified `Manual`; never write backups of backups.
- **Rename conflicts** and **symlinks** are `Manual` in v1; documented limitation.
- The implicit exclude list always contains the backup directory unless `include` explicitly re-adds it.

**Result extension:** add `conflict_backups: Vec<ConflictBackup>` to `SyncRunResult` (and the TS mirror):

```rust
pub struct ConflictBackup {
    pub file: String,
    pub winner: Winner,              // Local | Remote | Deleted | Manual
    pub backup_path: Option<String>, // None for manual / no-backup-possible
    pub callout_added: bool,
}
```

**Frontend work** (small for this phase):
- Extend `SyncRunResult` in `tauriVaultGitSync.ts`; surface resolved-conflict outcomes in the success path (`gitSyncManualView.ts`: transient chip + a notification when backups were written, since silent content rewriting is not acceptable).
- Keep the shipped defaults: every policy `manual`, callouts disabled. Behavior is unchanged until the settings plan exposes policies — Phase M lands the capability, the settings plan turns it on. Decide then whether `allowCreateBackupDirectory` flips to `true` as the default.
- A richer conflict-resolution UI (open backup next to winner, etc.) stays out of scope; the notification should at least name the backup path(s).

**Tests** (in `conflicts.rs`/`sync_run.rs` inline test mods, same real-git tempdir style):
- prefer-local writes remote backup (+ callout when enabled, on `.md`)
- prefer-remote writes local backup (+ callout)
- winner-deleted applies delete, no backup, no callout, annotates `winner: Deleted`
- loser-deleted keeps the file, no backup, annotates `winner: Local`/`Remote` per the policy (not `Deleted`)
- callout template renders all placeholders; callout disabled writes no callout
- non-Markdown conflict gets no callout; binary file with `.md` extension + `binary` gitattribute gets no callout
- backup path collision uses numeric suffix until unique
- manual policy (and policy-less path) aborts, creates snapshot branch, restores pre-merge HEAD — no hard reset
- mixed manual + auto-resolvable paths abort as a whole
- conflict inside the backup directory is forced `Manual`
- missing backup directory with `allow_create_backup_directory: false` fails loudly without committing
- both-sides-identical resolution skips the merge commit
- frontend: result mapping renders backups; notification fires when backups were written

**Risks:** conflict policy mistakes can overwrite user-visible note content — this is the one phase where the engine intentionally rewrites files, so the review skill for Markdown integrity applies to every step that touches the working tree. Backups must be written and fsync-safe **before** the winner is applied.

### Phase K — `GitStatusChip` Storybook coverage

Stories for the presentational chip: loading, error, syncing, transient success, synced, local changes, not pushed, remote changes, diverged, wrong branch, unsafe/merge state, remote unknown, autosync countdown. No runtime behavior, no command wiring. If stories need heavy app context, that is a signal the chip drifted from presentational. Low risk, any time.

### Phase 8 — code quality pass (after Phase M)

One focused review pass over the engine and sync frontend, no new behavior:
- Start with the biggest Rust modules: `stage_plan.rs` (1108 LOC), `status.rs` (1021), `sync_run.rs` (905) — split by responsibility where natural seams exist (e.g. `sync_run.rs` merge-recovery + Phase M conflicts could justify the split).
- Then the hooks and `lib/` sync modules; chip last.
- Remove leftover scaffolding and misleading names; keep tests healthy (extract repeated repo-setup helpers).
- Done when: no in-scope function above ~10 branches/nesting without a tracked follow-up, lint/type/test clean, module budgets respected.

## frontend/Rust contract (reference)

Still the operative contract; documented here because it is not visible in any one file:

- **Pre-sync flush.** The frontend flushes pending editor state before `vault_git_sync_run` (await in-flight saves; no in-memory state newer than disk). Rust cannot detect editor state; dirty *files* are fine — they are what gets committed.
- **Vault watcher.** No pausing during sync (Option A). Sync-time filesystem bursts ride the watcher's coarse invalidation path; the editor cache heals from disk.
- **Lock directory.** Resolved by the frontend as `join(await appLocalDataDir(), 'locks')` and passed into commands; lives outside the vault so it can never enter Git history.
- **Rust is stateless.** The full config is passed per call; persistence belongs to the frontend (the settings plan).

## open questions

1. **Settings integration details** — owned by `specs/plans/desktop-settings-workspace.md`: config lives in the synced app-settings document (`syncBehavior.git`), host label is device-scoped. When that plan wires `buildManualGitSyncConfig` to settings, re-check that status and sync still consume one config source.
2. **`.eskerra/settings-shared.json` vs git include globs.** The git engine syncs only `**/*.md` today, so the settings vault-mirror file does not travel over git — only over Syncthing or R2. If git is a user's sole sync channel, the include defaults may need to add the shared settings file. Align when the settings plan lands.
3. **Snapshot branch cleanup.** `eskerra/sync-snapshot-<timestamp>` branches are never pruned. A retention knob + one-shot cleanup at sync start is cheap; candidate setting for the settings plan.
4. **Authentication UX.** `AuthenticationFailed` is best-effort stderr matching; today we just surface the message. A "configure credentials" pointer remains out of scope.
5. **Telemetry.** Autosync now exists and fails silently by design; Sentry breadcrumbs / `captureObservabilityMessage` for repeated background failures is the first telemetry worth adding.
6. **Dry-run mode** for a "Preview sync" UI — still out unless trivial.
7. **Multi-vault.** Lock + per-call config already accommodate it; no further plumbing until the product needs it.

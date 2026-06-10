# Git Sync Engine for Eskerra

## name

Vault Git Sync Engine (Rust/Tauri) — `eskerra-vault-git-sync`.

## overview

Add a first-class, policy-driven Git sync feature to Eskerra desktop. The sync engine lives in the Rust/Tauri layer, shells out to the system `git` CLI, and exposes a single high-level Tauri command plus structured progress events. The frontend owns all product decisions (which vault, which config, when to run) and renders results; Rust owns correctness, safety, locking, and Git mechanics.

The existing personal Bash autosync script is treated as **behavioral inspiration only**. None of its conventions (`Phone/` wins local, `Scripts/` excluded, root files excluded, `_autosync-backup-*` directory names, `chore: autosync ...` commit messages, Markdown callout text) bleed into product defaults. Everything that varies between users is moved to a config object that the frontend supplies per invocation.

The first shippable version is **manual sync only** (a button + result panel). Batched autosync scheduling, throttling/coalescing, and background triggers are explicitly deferred to a later phase.

Non-goals for v1:
- libgit2 / `git2` crate (we use the `git` CLI; rationale in *architecture*).
- Rename-conflict heuristics beyond what `git merge` already handles.
- Submodules, LFS, partial clones, shallow repos.
- iOS, mobile, or web parity. Desktop only (Linux reference environment).
- Authentication prompts inside the app — credentials are delegated to the user's existing Git/credential-helper setup.

## current manual sync milestone

The current implementation has reached a minimal explicit manual sync milestone.

What works now:
- Rust validates the vault Git repository and sync config before mutation.
- Rust builds a read-only stage plan from `git status --porcelain=v2 -z`.
- Rust applies the stage plan only to included paths:
  - `git add -- <path>` for modified tracked and untracked included files.
  - `git rm -- <path>` for deleted included files.
  - excluded and unsupported paths are not staged.
- Rust creates a local sync commit when staged changes exist.
- Rust runs fetch, merge, and push for the configured remote/branch.
- Merge failures are recovered conservatively: snapshot branch creation is attempted, `git merge --abort` is always attempted, and `MergeFailed` returns the snapshot branch when one was created plus the pre-merge SHA.
- `vault_git_stage_plan` exposes read-only stage planning through Tauri.
- `vault_git_sync_run` exposes the full manual sync run through Tauri.
- The TypeScript client wraps both commands.
- The desktop UI has a small explicit manual sync button in the status bar next to the Git status chip.
- Manual sync feedback is delivered through existing toast/session notifications.
- The manual sync button is disabled while status is loading, status is unavailable, Git is in an unsafe state, the branch is wrong, or a sync is already running.
- Git status refreshes after sync success and after sync failure. This is a one-shot refresh, not polling.

Intentionally not implemented yet:
- No automatic conflict resolution.
- No conflict backup file creation.
- No Markdown conflict callouts.
- No settings UI or persisted sync profile.
- No batched autosync / sync-needed scheduler.
- No polling.
- No save-event sync trigger.
- No result panel or conflict-resolution UI.
- No automatic retries, rebases, branch switching, hard resets, or remote HEAD auto-detection.

Known temporary assumptions:
- The desktop UI currently uses hardcoded sync config:
  - `remote: "origin"`
  - `branch: "main"`
  - `include: ["**/*.md"]`
  - `exclude: ["Scripts/**"]`
  - manual conflict policy placeholder for Markdown files
  - backup/callout config fields are present only because the Rust config type requires them; backup/callout behavior is not implemented or invoked.
- The lock directory is resolved by the frontend as `join(await appLocalDataDir(), "locks")` and passed to the Tauri command.
- `host_label` is currently `null`, so Rust renders the safe local fallback in commit messages.

### Known issue: hardcoded sync branch
- Problem:
  - Hardcoded branch breaks sync/status for repos using a different default/current branch.
  - It affects both `useVaultGitStatus` and `MANUAL_GIT_SYNC_CONFIG`.
  - The status chip can incorrectly show "Wrong branch" purely because the app constant disagrees with the repo branch.
- Current temporary behavior:
  - Remote is hardcoded to `origin`.
  - Branch is hardcoded for now. We temporarily changed/used `"master"` for one test vault, but many repos and existing Rust integration tests use `"main"`.
  - This is acceptable only for local/manual testing, not as final product behavior.
- Recommended fix:
  - Move remote/branch/config into per-vault settings.
  - As an interim step, consider using the currently checked-out branch from a read-only Git command/helper.
  - Do not auto-switch branches.
  - Do not infer in a way that hides misconfiguration.
- UX requirement:
  - Until branch/config is known, disable manual sync with a clear reason.
  - Do not show "Wrong branch" merely because a temporary hardcoded constant is stale.
- Priority:
  - Fix this before remote polling, startup sync, close sync, and the batched autosync / sync-needed scheduler.
  - It can happen before or alongside conflict backup/policy handling.
- Tests to add later:
  - repo on `main`
  - repo on `master`
  - repo on feature branch
  - detached HEAD
  - missing remote branch
  - status and manual sync use the exact same selected branch

Manual smoke test result:
- Manual sync works through the status-bar button in a real vault setup. The run creates local commits when needed, fetches/merges/pushes, shows toast feedback, and refreshes Git status afterward.

Next recommended phases:
1. Fix status refresh for all vault writes, including TodayHub writes. ✅ **Done**
2. Fix the `useVaultGitStatus` refresh race so stale loads cannot overwrite newer status. ✅ **Done**
3. Add visible in-progress sync state. ✅ **Done**
4. Add Ctrl+S manual sync using the same gates as the button. ✅ **Done**
5. Resolve hardcoded remote/branch selection before broader automatic sync behavior. ✅ **Done**
6. Clean up `GitCmd` timeout waiting before background polling or frequent remote checks. ✅ **Done**
7. Add low-noise remote polling and remote-change status. ✅ **Done**
8. Add sync-on-close with Shift bypass. ✅ **Done** (custom title-bar path only; see Phase H status note)
9. Add sync-on-startup after the safer manual-close path exists. ✅ **Done**
10. Add batched autosync / sync-needed scheduling. ✅ **Done**
11. Track `GitStatusChip` Storybook coverage in the UI polish/documentation lane.
12. Defer settings/config UI and conflict backup/policy resolution as separate follow-up phases.

## Current implementation status

Last audited: 2026-05-12.

### Phase A — Shared save-settled signal after every successful vault write ✅ Implemented

**Files:** `useMainWindowWorkspace.ts`, `workspacePersistence.ts`, `App.tsx`, `useVaultGitLocalWriteStatusRefresh.ts`

`useMainWindowWorkspace` owns `vaultWriteSettledNonce` (a counter that increments on every successful disk write). `markVaultWriteSettled()` is called from two paths:
- `workspacePersistence.ts` at every successful `saveNoteMarkdown` call (normal note autosave and manual save).
- Directly inside `useMainWindowWorkspace` at every TodayHub row persist and TodayHub row delete.

As of the Phase J/G hardening pass, `App.tsx` also wires `saveSettledNonce` into `useVaultGitLocalWriteStatusRefresh`. When the nonce advances, the hook calls only the existing local `refreshGitStatus()` path so the status chip learns about local uncommitted changes shortly after note and TodayHub saves.

This write-settled refresh is status-only:
- no `manualGitSync.run()`
- no `vault_git_sync_run`
- no remote fetch

Vault writes still only mark sync-needed for actual Git sync. Batched autosync remains responsible for consuming pending work at most once per interval.

**Tests:** `workspacePersistence.test.ts` covers persistence paths, `useMainWindowWorkspace.hydrateVault.test.ts` covers nonce increments for note and TodayHub writes, and `useVaultGitLocalWriteStatusRefresh.test.ts` covers local status refresh without sync.

---

### Phase B — useVaultGitStatus latest-request-wins ✅ Implemented

**Files:** `useVaultGitStatus.ts`, `useVaultGitStatus.test.ts`

`requestIdRef` is incremented at the start of every `load()` call and in the `useEffect` cleanup. Guards in `try`/`catch`/`finally` prevent stale results or stale `setLoading(false)` from landing. `useVaultGitCurrentBranch` uses the same pattern.

**Tests:** 17 tests in `useVaultGitStatus.test.ts` covering all race scenarios (stale success, stale error, stale finally, vaultPath change mid-flight, two rapid refreshes).

---

### Phase C — Visible in-progress sync state ✅ Implemented

**Files:** `GitStatusChip.tsx`, `GitStatusChip.test.tsx`, `App.tsx`

`GitStatusChip` accepts `syncing?: boolean`. When `true`, it renders "Syncing…" with `git-status-chip--info` tone, `aria-label="Syncing vault"`, and `data-tooltip="Syncing vault"`, overriding all other states. `App.tsx` passes `syncing={manualGitSync.running}`.

**Tests:** 9 syncing-specific tests in `GitStatusChip.test.tsx` plus 8 pre-existing chip tests (17 total).

---

### Phase D — Ctrl/Cmd+S manual sync ✅ Implemented

**Files:** `useAppMainWindowKeyboardEffects.ts`, `useAppMainWindowKeyboardEffects.test.ts`, `App.tsx`

The Ctrl+S / Meta+S handler lives in its own `useEffect` inside the keyboard hook. It checks `manualSyncDisabledRef`, `manualSyncRunningRef`, and `onManualSyncRef` (all kept current via `useLayoutEffect` to avoid stale closure issues). On success it calls `preventDefault()` + `stopPropagation()`. Disabled Ctrl+S is silent (no toast) — the reason is already visible in the button tooltip. `App.tsx` passes `manualSyncDisabled: manualSyncDisabledReason != null`, `manualSyncRunning: manualGitSync.running`, and `onManualSync: manualGitSync.run`.

**Tests:** 6 tests in `useAppMainWindowKeyboardEffects.test.ts` (Ctrl+S, Meta+S, disabled, running, preventDefault, no duplicate listeners).

---

### Phase E — Resolve hardcoded sync branch/config ✅ Implemented

**Files:** `useVaultGitCurrentBranch.ts`, `gitSyncConfig.ts`, `App.tsx`, `useVaultGitCurrentBranch.test.ts`

`useVaultGitCurrentBranch` reads the actual checked-out branch from `git symbolic-ref --short HEAD` and exposes `detachedHead` when HEAD is detached. `buildManualGitSyncConfig(branch)` takes the dynamically-read branch as a parameter. Both `useVaultGitStatus` and `buildManualGitSyncConfig` consume the same `currentGitBranch` value from `App.tsx`, so they cannot drift.

Remote is still hardcoded to `'origin'` via `GIT_SYNC_REMOTE`. This is the documented interim default until per-vault settings exist (Plan Phase L).

**Tests:** 7 tests in `useVaultGitCurrentBranch.test.ts` covering main, master, detached HEAD, null vault path, null→real, real→null, and race hardening.

---

### Phase F — Clean up `GitCmd` timeout wait behavior ✅ Implemented

**Files:** `cli.rs`

The `GitCmd` timeout loop was updated to use a back-off strategy: 10 ms initial sleep, 25 ms mid, 100 ms steady-state. A `next_poll_interval` helper function encapsulates the back-off logic. Timeout behavior and all 128 existing Rust tests continue to pass. No behavior change.

---

### Phase G — Remote polling / remote-change status ✅ Implemented

**Part 1 — Remote status command (Rust + TypeScript):**
- New `remote_status()` function in `status.rs`: validates → `fetch_remote()` (`git fetch --quiet <remote> <branch>` with timeout) → `git_status()` (local).
- New `SyncError::FetchFailed { stderr }` variant.
- New `vault_git_remote_status` Tauri command in `commands.rs`.
- New `refreshVaultGitRemoteStatus` TypeScript client in `tauriVaultGitSync.ts`.
- New `useVaultGitRemoteRefresh` hook: on-demand, guards null vaultPath/branch and manualSyncRunning, latest-request-wins, `onRefreshed` callback.

**Part 2 — Polling scheduler (frontend only):**
- New `useVaultGitRemoteStatusPolling` hook: one immediate fetch when vault + branch become ready (exposes `initialRemoteStatusSettled` for startup sync), then a 5-minute interval (`REMOTE_POLL_INTERVAL_MS = 5 * 60 * 1000`) plus `visibilitychange` refresh when window becomes visible.
- No polling while `manualSyncRunning`, `vaultPath == null`, `branch == null`, or a shared frontend Git operation busy ref is set (guarded in `useVaultGitRemoteRefresh`).
- On failure, last-known status is preserved; no toast notification.
- No autosync, no `vault_git_sync_run` invocation, no background commit/push.
- Wired in `App.tsx`; `onRefreshed` calls `refreshGitStatus` to update the status chip via remote-tracking refs.

**Phase J/G hardening:** `App.tsx` owns a shared frontend `backgroundGitOperationBusyRef` used by remote polling and autosync. Remote polling sets the ref while `vault_git_remote_status` is in flight; autosync checks the same ref before starting. This prevents same-tick interval overlap between remote fetch/status refresh and background autosync. Skipped remote polls are silent and do not clear or mutate the last-known status.

**Note:** The status chip shows "Remote changes" based on `behind > 0` from remote-tracking refs. Remote polling keeps this state fresh without requiring a manual sync first. The 5-minute interval is hardcoded with a TODO and should stay conservative until per-vault settings (Phase L) exist. The Phase J/G hardening did not change this interval.

---

### Phase H — Sync on close with Shift bypass ✅ Fully implemented

**Files:** `WindowTitleBar.tsx`, `manualSyncClose.ts`, `manualSyncClose.test.ts`, `App.tsx`, `useAppTauriCloseAndFocusSave.ts`, `useAppOsCloseSync.ts`

**Custom titlebar close:**
- `WindowTitleBar` tracks Shift key state and shows "Sync and close" / "Syncing before close" / "Close instantly" labels.
- Clicking the close button calls `handleWindowCloseRequest({ instant: shiftHeld })` in `App.tsx`, which delegates to `handleManualSyncCloseRequest` with `showCloseSyncFeedback: true`.
- `handleManualSyncCloseRequest` gates on `instant`, `manualSyncRunning`, and `manualSyncDisabledReason`; shows "Syncing before close…" notification; runs sync; closes only on success; shows "Sync before close failed. Eskerra stayed open." on failure.

**OS/window-manager close (Alt+F4, window manager X button):**
- `useAppOsCloseSync` registers `onCloseRequested` via `getCurrentWindow().onCloseRequested(...)`.
- `event.preventDefault()` is called immediately; the close event is never allowed to proceed directly.
- Sync-before-close runs via `handleOsCloseRequest` (pure function in `manualSyncClose.ts`).
- An `allowCloseRef` flag prevents close loops: after successful sync, `programmaticClose()` sets the flag before calling `win.close()`, so the second `onCloseRequested` fires `performShutdown()` (playback flush + inbox flush + window state save + `win.destroy()`) without re-running sync.
- `closeSyncInProgressRef` deduplicates repeated OS close attempts: if close-sync is already running, further close events are silently dropped.
- Overall close-sync timeout: `CLOSE_SYNC_TIMEOUT_MS = 30_000 ms` via `Promise.race`. If exceeded, the app stays open and shows a timeout notification.
- If manual sync is already running when OS close fires, no second sync starts; app stays open.
- `useAppTauriCloseAndFocusSave` now handles focus-save only (flush on blur); close handling moved to `useAppOsCloseSync`.
- The custom titlebar close button now uses `programmaticClose` as its `close` arg so the same allow-close guard is shared by both paths.

**Notifications:**
- Sync start: "Syncing before close…" (info)
- Sync failure: "Sync before close failed. Eskerra stayed open." (error)
- Timeout: "Sync before close timed out. Eskerra stayed open so you can retry or close instantly." (error)
- Disabled (OS close): "Cannot sync before closing: {reason}. Use the close button while holding Shift to close instantly." (error)

**Tests:** 21 tests in `manualSyncClose.test.ts` (original 6 for `handleManualSyncCloseRequest` + 5 for `showCloseSyncFeedback` + 10 for `handleOsCloseRequest` covering: sync runs, start notification, success closes, failure stays open + notification, timeout stays open + notification, timeout clears ref, dedup guard, disabled reason, already-running guard, ref cleanup).

---

### Phase I — Sync on startup ✅ Implemented

**Files:** `useVaultGitStartupSync.ts`, `useVaultGitStartupSync.test.ts`, `App.tsx`, `useManualVaultGitSync.ts`

`useVaultGitStartupSync` runs at most one guarded sync after a vault becomes ready. It calls `useManualVaultGitSync.run({ silent: true })` so success is always silent, including no-op success (nothing to commit).

**Gates (all must pass before the sync fires):**
1. `vaultPath` is non-null
2. The first remote status fetch for this vault path has settled (success or failure)
3. Git status / branch is not loading
4. Git status has no error
5. `manualSyncDisabledReason` is null
6. Manual sync is not already running
7. Preflight allows sync (including behind-only remote changes after the initial fetch)
8. The vault path has not already had a startup sync this session

**Per-session deduplication:** A `Set<string>` ref (`attemptedVaultPathsRef`) records every vault path that has triggered startup sync. Switching to a new vault allows one startup sync for that vault. Switching back to a previously attempted vault does not fire a second sync.

**Notifications:**
- Success (including no-op): silent — no notification of any kind.
- Failure: `'error', 'Startup sync failed. You can retry manually.'`

**`run()` silent option:** `useManualVaultGitSync.run()` now accepts an optional `{ silent?: boolean }` parameter. When `silent: true`, the success notification is suppressed; error notifications always fire regardless. Manual sync via button, Ctrl+S, and close sync call `run()` without args — behavior unchanged.

**Tests:** 13 tests in `useVaultGitStartupSync.test.ts` (all gates, deduplication, cross-vault behavior, failure notification, silent success). Two additional tests in `useManualVaultGitSync.test.ts` cover `silent: true` suppresses info notification and still fires error notification.

---

### Phase J — Batched autosync / sync-needed scheduler ✅ Implemented

**Files:** `useVaultGitAutosyncScheduler.ts`, `useVaultGitAutosyncScheduler.test.ts`, `useVaultGitLocalWriteStatusRefresh.ts`, `useVaultGitRemoteRefresh.ts`, `useVaultGitRemoteStatusPolling.ts`, `App.tsx`

Vault writes advance the existing `saveSettledNonce` signal. `useVaultGitAutosyncScheduler` treats each non-zero nonce change as "sync needed" and coalesces all pending writes behind a fixed interval (`AUTOSYNC_INTERVAL_MS = 5 * 60 * 1000`).

The Phase J/G hardening restored immediate local status visibility separately from autosync: `useVaultGitLocalWriteStatusRefresh` calls only `refreshGitStatus()` when `saveSettledNonce` advances. This keeps the status chip current for note and TodayHub local changes after saves without starting a sync, fetching remotes, or calling `vault_git_sync_run`.

The scheduler is the only autosync trigger for local writes. It runs `useManualVaultGitSync.run({ silent: true })` at most once per interval and only when the normal manual-sync gates are open:
- vault path exists
- Git status/branch are not loading
- Git status has no error
- manual sync is not disabled
- manual sync is not already running
- no autosync run is already in flight
- no shared frontend Git operation is in flight

Successful autosync clears only the write generation that was current when the run started. If another vault write settles during the sync, the scheduler leaves sync-needed pending for the next interval. Failed sync attempts keep sync-needed pending and retry on later intervals. Switching vault paths resets pending sync-needed state so writes from one vault do not trigger autosync in another vault. If autosync skips because remote polling is currently refreshing, pending sync-needed work is preserved for a later interval. Success and failure notifications are silent for this background path.

**Status chip countdown:** When autosync is pending, the chip would show "Local changes", and the next interval tick can run autosync, `GitStatusChip` shows a live **"Syncs in M:SS"** countdown (`useVaultGitAutosyncCountdown`, `gitAutosyncCountdown.ts`) tied to the scheduler's next interval fire. Higher-priority chip states, blocked gates, and non-pending dirty trees keep the existing labels.

**Shared frontend busy gate:** `App.tsx` owns `backgroundGitOperationBusyRef` and passes it to both `useVaultGitRemoteStatusPolling` / `useVaultGitRemoteRefresh` and `useVaultGitAutosyncScheduler`.
- Remote polling skips while manual/autosync sync is running.
- Autosync skips while remote polling is refreshing.
- Skips are silent and do not create notifications.
- The autosync and remote-poll intervals remain unchanged.

**Tests:** `useVaultGitAutosyncScheduler.test.ts` covers no mount sync, save-only marking, interval sync, coalescing, no-op without pending writes, gate preservation, retry after failure, no overlapping runs, vault-switch reset, preserving newer writes during an in-flight sync, preserving pending work when a remote refresh is in flight, and exposed `autosyncPending` / `nextAutosyncAtMs` state. `gitAutosyncCountdown.test.ts`, `useVaultGitAutosyncCountdown.test.ts`, and `GitStatusChip.test.tsx` cover countdown formatting, display gates, and chip override. `useVaultGitRemoteRefresh.test.ts` and `useVaultGitRemoteStatusPolling.test.ts` cover the shared busy gate. `useVaultGitLocalWriteStatusRefresh.test.ts` covers write-settled local status refresh without sync.

---

### Conflict backup and policy handling ❌ Not implemented

No `conflicts.rs` module exists. All conflict policies are set to `'manual'` in `buildManualGitSyncConfig`. Merge failures return `MergeFailed` and surface the snapshot branch + pre-merge SHA in the toast, but no backup files are written and no Markdown callouts are inserted.

---

### GitStatusChip Storybook coverage ❌ Not implemented

No `GitStatusChip.stories.tsx` exists. The chip states (loading, error, syncing, synced, local changes, not pushed, remote changes, diverged, wrong branch, unsafe state, remote unknown) are covered only by Vitest tests, not Storybook stories.

---

### Phase N — Manual/close sync preflight + close progress overlay ✅ Implemented

**Files:** `gitSyncPreflight.ts`, `gitSyncPreflight.test.ts`, `CloseSyncProgressOverlay.tsx`, `manualSyncClose.ts`, `useVaultGitStartupSync.ts`, `useVaultGitAutosyncScheduler.ts`, `useAppMainWindowKeyboardEffects.ts`, `useAppOsCloseSync.ts`, `useAppGitSyncOrchestration.ts`, `App.tsx`

`shouldRunVaultGitSync(status, intent)` is a pure preflight helper. It returns `false` (skip sync) when:
- status is null and intent is not `manual`
- status is clean/synced (nothing to do) for any intent including `manual`
- status has unsafeState or isWrongBranch and intent is not `manual`
- status is behind-only and intent is `close` or `autosync` (startup pulls remote-only changes after the initial fetch)
- status has an error (unsafeState) and intent is not `manual`

The helper is wired into Ctrl/Cmd+S (keyboard intent, silent no-op when false), close sync in both custom-titlebar and OS-close paths (close immediately when false), startup sync (skip silently when false), and autosync scheduler (clear pending when clean/synced, keep pending when unknown/error). The manual button is not gated by preflight.

`CloseSyncProgressOverlay` renders a full-window semi-transparent overlay with "Syncing before close…" text when `visible` is true. It is wired into `useAppOsCloseSync` via reactive `closeSyncInProgress` state, exposed through `useAppGitSyncOrchestration`, and rendered in all three `App.tsx` branches.

All hooks use an `undefined`-sentinel pattern for the optional `gitStatus` parameter: when `gitStatus` is `undefined` (not passed by callers that have not yet wired preflight), the preflight check is skipped and the hook behaves as before.

**Tests:** 35 tests in `gitSyncPreflight.test.ts`; 8 tests in `useAppMainWindowKeyboardEffects.test.ts` (+2 new); 14 tests in `manualSyncClose.titleBar.test.ts` (+2 new); 13 tests in `manualSyncClose.os.test.ts` (+2 new); 15 tests in `useVaultGitStartupSync.test.ts` (+2 new); 14 tests in `useVaultGitAutosyncScheduler.test.ts` (+3 new). 1433 Vitest tests total pass. `tsc --noEmit` clean, lint clean, `check-module-budgets.mjs` clean.

Implementation summary:
- Ctrl/Cmd+S now silently no-ops when preflight says there is nothing to sync.
- Close sync now skips sync and closes immediately when status is clean/no-op; behind-only does not block close.
- Startup sync waits for the initial remote fetch, then runs when preflight says there is work (including behind-only); it still skips silently when status is clean/no-op.
- Autosync skips full sync when status is clean and clears pending; preserves pending for unknown/error status.
- Manual sync button remains explicit and is not gated by preflight.
- Diverged state still runs through the existing conservative sync path for all intents.
- Close sync now shows a centered blocking progress overlay (`CloseSyncProgressOverlay`) while actually syncing before close; the overlay is not shown for clean/no-op close or Shift bypass; cleared on failure or timeout when the app remains open.
- No Rust changes. No settings UI. No conflict policy/backup behavior. No autosync interval change.

---

### Recommended next implementation order

Given the above, the recommended order is:

1. **Phase F** — GitCmd 10 ms busy-wait cleanup. ✅ **Done** (back-off: 10→25→100 ms, `next_poll_interval` helper)
2. **Phase G** — Remote polling + "Remote changes" chip state. ✅ **Done** (5-minute interval + visibilitychange; no autosync)
3. **Phase H OS gap** — OS-level close interception via `onCloseRequested`. ✅ **Done** (30 s timeout; allow-close guard; dedup; shared `programmaticClose`)
4. **Phase I** — Sync on startup (custom-close and OS-close now both stable; Phase G exists). ✅ **Done**
5. **Phase J** — Batched autosync / sync-needed scheduler. ✅ **Done** (interval-batched; local write status refresh restored separately; remote polling/autosync overlap guarded by shared frontend busy ref)
6. **Phase K** — GitStatusChip Storybook coverage (independent; can happen any time, low risk, good to do before the chip grows more states).
7. **Phase L** — Settings/config UI (still not implemented; needed for persisted/per-vault sync configuration).
8. **Phase M** — Conflict backup and policy handling (still not implemented; needed before richer background conflict behavior).
9. **Phase N** — Manual/close sync preflight + close progress overlay. ✅ **Done** (preflight helper + close overlay + wiring into Ctrl/S, close, startup, autosync paths)
10. **Phase 8** — Code quality review of all touched files (final cleanup pass per the plan).

## Next sync UX phases

This section originally planned the desktop UX and orchestration work after the manual sync milestone. It is retained as a historical planning appendix; the current implementation status above is authoritative.

Recommended implementation order:
A. Fix status refresh for all vault writes, including TodayHub. ✅ **Done**
B. Fix the `useVaultGitStatus` refresh race. ✅ **Done**
C. Add visible in-progress sync state. ✅ **Done**
D. Add Ctrl+S manual sync shortcut using the same gates. ✅ **Done**
E. Resolve hardcoded sync branch/config selection. ✅ **Done**
F. Clean up `GitCmd` timeout wait behavior. ✅ **Done**
G. Add remote polling / remote changes refresh strategy. ✅ **Done**
H. Add sync on close with Shift bypass. ✅ **Done** (custom title bar + OS/window close; 30 s timeout; see Phase H status)
I. Add sync on startup. ✅ **Done** (once per vault per session; silent on success including no-op; error on failure; see Phase I status)
J. Batched autosync / sync-needed scheduler. ✅ **Done** (interval-batched; no sync-after-save; Phase J/G hardening added local status refresh and shared remote/autosync busy gate)
K. UI polish/documentation: add `GitStatusChip` Storybook coverage.
L. Later: settings/config UI.
M. Later: conflict backup/policy resolution.
N. UX hardening: manual/close sync preflight + close progress overlay.

### Phase A — Refresh Git status after every successful vault write ✅ Implemented

Goal:
- Make the Git status chip reflect any successful persisted vault change, not only normal note saves.
- Fix the observed TodayHub bug where edits could leave the chip at "Synced" until a normal note was edited. ✅ Resolved by routing note and TodayHub writes through `saveSettledNonce` plus `useVaultGitLocalWriteStatusRefresh`.
- Move the refresh trigger to the shared persistence/save-settled path so normal notes, TodayHub writes, and future vault writers all get the same behavior.

Current behavior:
- Successful vault writes advance `saveSettledNonce`.
- `useVaultGitLocalWriteStatusRefresh` observes that nonce and calls only `refreshGitStatus()`.
- This is local status-only: no sync run, no remote fetch, no notification.
- The same nonce also marks sync-needed for Phase J autosync; actual Git sync remains interval-batched.

Files likely touched:
- `apps/desktop/src/hooks/` save orchestration and persistence hooks.
- TodayHub persistence entry points under `apps/desktop/src/features/` or the current TodayHub module.
- Git status state/query hook in `apps/desktop/src/features/gitSync/` or the app shell status-bar wiring.
- Existing tests near editor persistence, TodayHub writes, and Git status refresh if present.

Explicit non-goals:
- Do not add batched autosync.
- Do not special-case only TodayHub.
- Do not poll Git status after every keystroke; refresh only after a successful disk write/save-settled event.
- Do not change Rust or Git sync engine behavior.

Tests:
- Unit/integration test that a normal note save emits or reaches the common save-settled signal and schedules one Git status refresh.
- Regression test that a TodayHub write uses the same path or emits the same signal and refreshes Git status.
- Test that failed writes do not mark Git status stale or force a misleading refresh.
- Test/debounce assertion that a burst of writes coalesces into a bounded number of status refreshes.

Risks:
- TodayHub may write through a separate persistence path that bypasses existing save-settled state.
- A naive refresh per write could make the status chip noisy or expensive during multi-file operations.
- Refreshing too early, before the write is actually durable, can keep showing "Synced" until the next unrelated update.

Implementation notes:
- First identify the common disk-write completion point. Prefer adding a single "vault write settled" signal there over wiring Git status refresh into individual features.
- If TodayHub writes do not currently emit the same signal as note saves, route them through the shared persistence completion hook or add a small adapter at the TodayHub persistence boundary.
- The Git status hook should expose an explicit `markStaleAndRefresh` / `refreshGitStatus` entry point that can be called by save orchestration without importing sync-run behavior.

### Phase B — Fix `useVaultGitStatus` refresh race

Goal:
- Ensure stale Git status loads cannot overwrite newer status, error, or loading state.
- Fix the race where `refresh()` creates its own `cancelled` object but cannot cancel a still-running `load()` from the initial `useEffect` or a prior `refresh()`.
- Keep this as a frontend hook-only hardening fix with no Rust changes.

Files likely touched:
- `useVaultGitStatus` hook and nearby Git status tests.
- Any shared test helpers that mock delayed status responses.

Explicit non-goals:
- Do not change Rust Git status or sync commands.
- Do not add polling or batched autosync.
- Do not change status-chip presentation beyond whatever tests need to observe final hook state.

Tests:
- Initial load starts, then refresh starts and resolves first, then initial load resolves; final state must stay from refresh.
- Two refreshes start in quick succession; the latest result wins.
- Stale `finally` blocks must not incorrectly toggle `loading` or cause loading flicker.
- Expand the existing stale-result test to cover refresh while an initial load is still in flight.

Risks:
- Multiple independent cancellation objects make it easy for old requests to update state after a newer request has already rendered.
- Stale `finally` blocks can incorrectly clear loading even when a newer request is still active.
- The bug becomes more visible once polling, startup sync, close sync, or batched autosync add more status refresh triggers.

Recommended strategy:
- Add request generation tracking or a shared cancellation/ref mechanism inside the hook.
- Give every load a monotonically increasing request id.
- Only the latest request id may set `status`, `error`, or `loading`.
- Treat this as high priority and complete it before remote polling, startup sync, close sync, or batched autosync.

### Phase C — Visible in-progress sync state

Goal:
- Show that sync is running immediately after manual sync starts.
- Avoid displaying "Synced" while the repo is actively staging, committing, fetching, merging, or pushing.
- Keep `GitStatusChip` presentational if possible by passing a synthetic/loading state or rendering a small adjacent sync indicator from the container.

Files likely touched:
- Status bar / app shell component that owns the chip and manual sync button.
- `GitStatusChip` props/types if a synthetic state is passed in.
- `apps/desktop/src/features/gitSync/` state mapper and manual sync hook.
- Existing tooltip/aria-label tests or component tests.

Explicit non-goals:
- Do not change sync progress event shape.
- Do not add a result panel.
- Do not infer detailed Git phases unless the existing frontend already receives them.
- Do not make the chip own sync orchestration.

Tests:
- Component test: while sync is running, the chip or adjacent UI renders "Syncing..." and the manual button is disabled.
- Tooltip/aria-label test: running state says what is happening.
- Regression test: when sync finishes or fails, the status refresh result replaces the synthetic running state.
- Test that a pre-existing "Synced" status is hidden or superseded during sync.

Risks:
- Overloading the status chip model can blur the difference between repository state and operation state.
- If the running flag is not cleared on thrown errors, the UI can remain stuck in "Syncing...".
- Multiple entry points, such as button, Ctrl+S, startup, and close, need one shared running state.

Implementation notes:
- Use one `isSyncing` state owned by the Git sync container/hook.
- The chip should receive either the real Git status or a derived display state like `{ kind: "syncing" }`; it should not start commands.
- The manual sync button, future Ctrl+S handler, startup sync, and close sync should all call the same guarded `runManualSync` function.

### Phase D — Ctrl+S triggers guarded manual sync

Goal:
- Make Ctrl+S explicitly run manual sync, since the app likely does not use Ctrl+S as a classic save action.
- Use exactly the same safety gates, notifications, running flag, and post-run status refresh as the manual sync button.
- Prevent duplicate concurrent syncs.

Files likely touched:
- App-level keyboard shortcut handler, likely in the desktop app shell.
- Manual sync hook/container in `apps/desktop/src/features/gitSync/`.
- Notification/session message mapper.
- Tests for keyboard shortcuts and sync gating.

Explicit non-goals:
- Do not add save-only behavior to Ctrl+S.
- Do not bypass the existing button safety gates.
- Do not allow Ctrl+S to sync while status is loading/error, branch is wrong, repo is unsafe, no vault is open, or another sync is running.
- Do not change Rust.

Tests:
- Ctrl+S calls the same sync action as the button when all gates pass.
- Ctrl+S is ignored or shows the same disabled reason when already syncing, no vault is open, status is loading/error, wrong branch, or unsafe state.
- Ctrl+S prevents default browser/app save behavior where appropriate.
- Success and failure both trigger the same status refresh and notifications as button sync.

Risks:
- Shortcut handling can conflict with text editor focus, browser defaults, or platform conventions.
- If the button and shortcut use separate code paths, they will drift in gating behavior.
- Ctrl+S during an in-flight save must rely on the existing pre-sync flush contract.

Implementation notes:
- Centralize a `canRunManualSync` selector and `runManualSync` action.
- The shortcut should only dispatch the shared action; it should not duplicate branch/status checks inline.
- Consider exposing a single disabled reason for button tooltip, shortcut no-op handling, and future close/startup gates.

### Phase E — Resolve hardcoded sync branch/config selection

Goal:
- Stop relying on temporary app constants for the sync branch.
- Ensure `useVaultGitStatus` and `MANUAL_GIT_SYNC_CONFIG` use the exact same selected remote/branch.
- Prevent the status chip from showing "Wrong branch" just because a stale hardcoded constant says `main` or `master`.

Files likely touched:
- Git status hook/client, including `useVaultGitStatus`.
- Manual sync config builder, including `MANUAL_GIT_SYNC_CONFIG` or its replacement.
- Per-vault settings/config surface once available.
- Read-only Git helper/client used to inspect the current branch.
- Status chip disabled-reason mapping and tests.

Explicit non-goals:
- Do not auto-switch branches.
- Do not silently infer a branch in a way that hides misconfiguration.
- Do not implement the full settings UI unless this phase is intentionally combined with the later settings/config phase.
- Do not change Rust integration tests just to match a frontend hardcoded branch.

Tests:
- Repo on `main` reports status and manual sync uses `main`.
- Repo on `master` reports status and manual sync uses `master`.
- Repo on a feature branch does not fail because the app constant expects `main` or `master`.
- Detached HEAD still reports the proper unsafe/detached state.
- Missing remote branch still reports a real missing-remote-branch or configuration error.
- Status and manual sync use the exact same selected branch and remote.

Risks:
- Using the current checked-out branch as an interim default is practical, but it can hide that the user actually intended a different branch unless the UI clearly labels it as the selected branch.
- Per-vault settings need a clear shared/local split before config becomes durable.
- If status and sync build config separately, they can drift again.

Recommended strategy:
- Short term: derive the branch from a read-only Git command/helper for the currently opened vault, and use that single selected branch for both status and manual sync config.
- Keep `origin` as a temporary remote only until per-vault config exists, but make the limitation explicit in disabled reasons/tooltips where relevant.
- If branch/config is unknown, disable manual sync with a clear reason instead of showing "Wrong branch" from a stale constant.
- Long term: move remote/branch/include/exclude and other sync config into per-vault settings, then have both status and sync consume that one config source.
- Do this before remote polling, startup sync, close sync, and the batched autosync / sync-needed scheduler. It can happen before or alongside conflict backup/policy handling.

### Phase F — Clean up `GitCmd` timeout wait behavior

Goal:
- Reduce waste in the Rust `GitCmd` timeout loop without changing sync semantics.
- Preserve existing timeout behavior and tests.
- Complete this before adding background polling or frequent remote checks.

Files likely touched:
- Rust Git command wrapper / `GitCmd` timeout implementation.
- Existing Rust timeout tests.

Explicit non-goals:
- Do not change sync semantics.
- Do not change configured timeout values.
- Do not convert the sync engine to async process management as part of this cleanup unless the surrounding code already moves that way.

Tests:
- Existing timeout test remains and continues to verify timeout behavior.
- No exact iteration-count test is required unless a helper is introduced and can be tested cleanly.

Risks:
- The current fixed 10ms sleep can do around 3000 `try_wait` calls during a 30s timeout. That is probably fine in practice for manual sync, but it is wasteful before background operations exist.
- Making the interval too large could delay timeout detection noticeably.

Recommended strategy:
- Replace fixed 10ms polling with a less busy wait strategy.
- Acceptable options:
  - Increase the sleep interval to roughly 50-100ms for Git network operations.
  - Implement a helper that starts with a short wait and then backs off to a larger interval.
  - Later consider an async/Tokio process approach if the app already moves in that direction.
- Treat this as medium priority cleanup before batched autosync, polling, or long-running background sync.

### Phase G — Remote polling and remote-change status

Goal:
- Let the existing status chip show remote state: "Synced", "Local changes", "Not pushed", and "Remote changes".
- Detect remote changes without triggering sync automatically.
- Avoid noisy polling and expensive operations.

Files likely touched:
- Git status client/state in `apps/desktop/src/features/gitSync/`.
- Status chip display mapping.
- Possibly a new lightweight Tauri command later if current status cannot distinguish remote divergence without full sync.
- Tests for status mapping and polling scheduler.

Explicit non-goals:
- Do not autosync when remote changes are found.
- Do not fetch aggressively in the foreground while the user is typing.
- Do not block note editing on remote checks.
- Do not solve merge conflicts or remote preview UI in this phase.

Tests:
- Status mapping covers clean, local dirty, local ahead/not pushed, remote ahead, and diverged states.
- Polling does not run while sync is in progress.
- Polling backs off or pauses after errors.
- Remote changes update the chip without starting a sync.
- Save-triggered local status refresh and remote polling do not fight each other.

Risks:
- `git fetch` is the most accurate way to update remote-tracking refs, but it can be network-expensive and may prompt for credentials in misconfigured environments.
- A lighter remote check such as `git ls-remote` avoids touching local refs but still uses network/auth and then requires comparison logic.
- Pure local status can only report against the last fetched remote-tracking ref; it cannot know about new remote commits.

Recommended strategy:
- Use a two-tier status model:
  - Local status refresh is cheap and file-write driven. It reports working tree dirtiness, unsafe state, branch, and ahead/behind relative to the current local remote-tracking ref.
  - Remote refresh is timer/visibility driven and performs a bounded `git fetch --quiet <remote> <branch>` or equivalent narrow fetch to update `refs/remotes/<remote>/<branch>`.
- Default interval: fetch-based remote refresh no more often than every 3-5 minutes while a vault is open and the app is visible/focused. Also refresh once when the app regains focus after a longer idle period, with a minimum cooldown.
- Never start remote polling while a sync is running or while the repository is in an unsafe state.
- If fetch fails, keep the last known local status and surface a subtle error/tooltip state rather than a noisy toast.
- Do not sync automatically just because the status becomes "Remote changes".

UI notes:
- Chip states should prioritize safety/running first, then local working tree changes, then ahead/not pushed, then remote changes.
- Diverged state can display as "Sync needed" or "Local + remote changes" later; for the first pass, avoid implying conflict unless a sync actually detects one.
- Tooltip should include the last remote check time and a brief reason when remote state is stale or unavailable.

### Phase H — Sync on close with Shift bypass

Goal:
- Make normal close mean "sync and close".
- Make Shift+close bypass sync and close instantly.
- Keep the app open and show an error if sync fails, as the safest first implementation.
- Avoid blocking forever on close by relying on existing sync timeouts.

Files likely touched:
- Custom titlebar close button.
- Window close event handling in the desktop shell.
- Manual sync hook/container and shared gating.
- Tooltip/keyboard modifier state for the close button.
- Tests for close behavior and failure handling.

Explicit non-goals:
- Do not add a modal conflict resolution flow.
- Do not close after a failed sync in the first implementation.
- Do not start a second sync if one is already running.
- Do not change Rust timeouts.

Tests:
- Close button tooltip says "Sync and close" by default.
- Holding Shift changes tooltip to "Close instantly" and bypasses sync.
- Normal close calls the same guarded sync action when gates pass, then closes after success.
- Sync failure keeps the app open, clears running state, refreshes Git status, and shows the same error notification style.
- If already syncing, close waits for the existing sync outcome or refuses to start another run; it does not create a duplicate sync.
- Native window close event follows the same policy where technically possible.

Risks:
- Native window close events and custom titlebar close button may have different capabilities for intercepting and delaying close.
- A failed or slow network sync during close can feel like the app is stuck unless the in-progress state is visible.
- OS shutdown may not allow a long async sync-and-close flow.

Recommended behavior:
- Custom titlebar close is the primary controlled path: prevent immediate close, run guarded sync, close only on success.
- Shift+custom-close bypasses sync and closes immediately.
- Native window close should attempt the same path if Tauri event handling allows cancellation; otherwise document the limitation and keep custom titlebar behavior correct first.
- If gates fail because status is loading/error, wrong branch, unsafe state, or no vault is open, do not attempt sync; keep the app open and show a concise reason. Shift bypass remains available.
- If a sync is already running, do not start another. Treat close as pending on the existing sync only if the shared hook can represent that cleanly; otherwise keep the app open and explain that sync is already running.

### Phase I — Sync on startup/open vault

Goal:
- Consider an automatic sync when the app starts or a vault opens, after the safer manual and close paths are stable.
- Avoid running sync before vault bootstrap and initial status are ready.
- Use the same safety gates as the manual button.

Files likely touched:
- Vault open/bootstrap lifecycle in the desktop shell.
- Git status initialization hook.
- Shared manual sync action/gates.
- Notification policy near session notifications.
- Tests for startup lifecycle and gating.

Explicit non-goals:
- Do not run before a vault is selected and initialized.
- Do not bypass branch/unsafe/status gates.
- Do not show noisy success notifications for an automatic no-op startup sync.
- Do not add settings UI yet, though the behavior should be easy to make configurable later.

Tests:
- Startup sync waits until vault bootstrap completes and initial Git status is available.
- Startup sync does not run when no vault is open, status is loading/error, wrong branch, unsafe state, or another sync is running.
- Startup sync runs at most once per vault open session.
- Startup failure shows a subdued error and leaves the app usable.
- Startup success refreshes status without duplicating notifications.

Risks:
- Startup is already a busy lifecycle; syncing too early can race vault scan, cache hydration, or initial editor state.
- Network/auth failures at startup can feel intrusive.
- If remote polling lands first, startup sync and initial remote fetch need cooldown coordination.

Recommended safe default:
- Do not ship startup sync before close sync and Ctrl+S are stable.
- When implemented, schedule it after vault bootstrap, after initial Git status, and after the first idle moment.
- Gate it exactly like manual sync.
- Show only chip in-progress state during the run; show a notification only on actionable failure or when local/remote changes were actually synchronized.
- Make it internally feature-flag/config-ready so a later settings phase can expose "sync on startup".

### Phase J — Batched autosync / sync-needed scheduler ✅ Implemented

Goal:
- Add a throttled/coalesced scheduler that syncs local changes at most once per configured interval. ✅ Implemented.
- Build it on the same save-settled signal from Phase A so TodayHub and normal note writes can mark sync-needed identically. ✅ Implemented.
- Keep future configurability ready for settings/config UI, which is still not implemented.
- Preserve frequent local disk persistence. Vault writes may mark a dirty/sync-needed flag, but must not immediately run Git sync each time.

Files likely touched:
- Shared save-settled signal from Phase A.
- Git sync-needed scheduler/throttler in `apps/desktop/src/hooks/useVaultGitAutosyncScheduler.ts`.
- Local write status refresh in `apps/desktop/src/hooks/useVaultGitLocalWriteStatusRefresh.ts`.
- Remote/autosync overlap gate in `useVaultGitRemoteRefresh.ts`, `useVaultGitRemoteStatusPolling.ts`, and `App.tsx`.
- Settings/config store once Phase L exists. ❌ Not implemented.
- Notification policy and status chip.

Explicit non-goals:
- Do not sync on every keystroke.
- Do not sync after every save/write/letter.
- Do not run Git sync immediately for every vault write.
- Do not autosync while unsafe, wrong branch, missing config, status loading/error, offline/auth failing repeatedly, manual sync is running, another autosync is already running, or remote polling is currently refreshing.
- Do not invent conflict-resolution UX in the batched autosync scheduler.

Tests:
- Multiple successful writes during the configured interval collapse into one sync attempt.
- TodayHub writes and note saves mark sync-needed through the same signal.
- Failed writes do not mark sync-needed.
- Autosync runs at most once per configured interval and never overlaps itself.
- Autosync failures keep pending work for a later interval.
- Manual sync remains available immediately and cancels, clears, or supersedes a pending autosync without duplicate runs.
- Autosync does not run while manual sync is running and refreshes Git status after completion/failure.
- Autosync skips while remote polling is refreshing and preserves pending work.
- Remote polling skips while manual/autosync sync is running without clearing status or showing a toast.

Risks:
- Conflict backup/policy handling is still not implemented, so richer background conflict behavior remains deferred.
- Repeated network/auth failures can become noisy.
- Save bursts from imports or refactors are coalesced by the interval scheduler, but future settings should make the interval configurable.

Recommendation:
- Treat wording such as "autosync after saves" as inaccurate: disk persistence remains frequent and local; Git sync is batched/throttled/coalesced.
- Keep settings/config UI and conflict backup/policy decisions as separate follow-up phases.

### Phase K — UI polish/documentation: `GitStatusChip` Storybook coverage

Goal:
- Add Storybook coverage for the presentational `GitStatusChip` component.
- Document its visual states without adding runtime behavior.
- Keep this in the UI polish/documentation lane.

Files likely touched:
- `GitStatusChip.stories.tsx` next to the component.
- Storybook mocks/fixtures for Git status states if existing local patterns require them.

Explicit non-goals:
- Do not change sync behavior.
- Do not add runtime state or command wiring to `GitStatusChip`.
- Do not make the chip own status loading or sync orchestration.

Tests/stories:
- Storybook stories should cover at least:
  - loading
  - error
  - synced
  - local changes
  - not pushed
  - remote changes
  - diverged
  - wrong branch
  - unsafe/merge state
  - remote unknown

Risks:
- Without stories, visual regressions across many compact chip states are easy to miss.
- If stories require too much app context, the component may have drifted away from being presentational.

Priority:
- Medium/low. Good design-system/documentation hygiene; can happen before or after the immediate UX hardening phases.

### Phase L — Later settings/config UI

Goal:
- Replace temporary hardcoded sync config with a persisted profile.
- Expose remote, branch, include/exclude globs, host label, hook policy, timeouts, startup/close/batched autosync toggles, autosync interval, and polling interval.

Files likely touched:
- Settings store and settings UI.
- Sync config builder in `apps/desktop/src/features/gitSync/`.
- Validation UI for remote/branch/globs.
- Migration/defaults logic.

Explicit non-goals:
- Do not mix settings UI into the status-chip work.
- Do not let the UI write invalid config that only fails later in Rust.
- Do not solve conflict backup UI here unless Phase M is combined deliberately.

Tests:
- Defaults match the current hardcoded behavior.
- Invalid globs/empty remote/empty branch are rejected before sync.
- Local-only and shared settings are stored in the intended files once the config-location question is answered.
- Toggling startup/close/batched autosync changes scheduling behavior without changing manual sync gates.

Risks:
- Shared versus local settings affects Git history and multi-device behavior.
- Too many settings before the defaults are proven can make the feature harder to understand.
- Config migration needs care once users have existing vault settings.

### Phase M — Later conflict backup and policy resolution

Goal:
- Implement the deferred conflict policy engine and user-facing conflict recovery behavior.
- Add backup loser versions, configured policy application, and optional Markdown callouts.
- Make batched autosync safer by ensuring conflicts have a predictable policy before background sync is enabled.

Files likely touched:
- Rust conflict modules already outlined in this plan.
- Frontend result mapping and conflict UI.
- Settings/config UI for policies and backup locations.
- Tests under `apps/desktop/src-tauri/src/vault_git_sync/tests/`.

Explicit non-goals:
- Do not attempt this as part of the next UX polish batch.
- Do not add automatic hard reset or rebase.
- Do not hide manual conflicts; unresolved conflicts should remain explicit.

Tests:
- Use the existing Rust conflict test matrix in this plan.
- Add frontend tests for conflict result rendering, backup links, and manual-conflict notifications.
- Verify failed conflict resolution aborts merge, preserves pre-merge SHA, and reports snapshot branch.

Risks:
- Conflict policy mistakes can overwrite user-visible note content.
- Backup/callout behavior needs clear defaults before batched autosync.
- Rename, binary, symlink, and delete conflicts need conservative handling.

### Phase N — Manual/close sync preflight + close progress overlay ✅ Implemented

Status: ✅ Implemented. See implementation summary in § "Current implementation status" above.

Goal:
- Stop Ctrl/Cmd+S from running a full sync when there is nothing meaningful to sync.
- Stop close/exit sync from running when there is no local work to commit/push and no other clearly actionable sync state.
- When close sync does need to run, give the user a clear central/blocking progress UI instead of relying on the small status-bar chip.

Files likely touched:
- `apps/desktop/src/features/gitSync/` — preflight helper (e.g., `shouldRunSyncForStatus(status)`) and any orchestrator that calls it from Ctrl/Cmd+S and close paths.
- `apps/desktop/src/hooks/` — keyboard shortcut hook (manual sync entry from Ctrl/Cmd+S) and close-sync orchestrator/hook.
- `apps/desktop/src/App.tsx` or a sibling shell component for hosting the close progress overlay.
- New presentational component for the close progress overlay (DS-aligned; central modal-style surface, not a chip).
- Tests next to each touched file (preflight helper, keyboard hook, close orchestrator, overlay component).

Explicit non-goals:
- Do not change the Rust sync engine or `vault_git_sync_run` contract.
- Do not change the manual sync button's behavior: it remains an intentionally explicit "force a sync/check" entry point.
- Do not remove or replace the existing `GitStatusChip` syncing state; the chip stays as the ambient indicator. The overlay is additive for the close path only.
- Do not introduce a new long-running scheduler. Preflight is a pure decision over the most recent `GitStatusResult`.
- Do not auto-merge or auto-pull remote-only changes as part of close behavior.

Preflight design:
- Reuse the existing `GitStatusResult` shape — no new Rust call, no extra `vault_git_sync_run` round trip just to discover there is nothing to do.
- Add a small pure helper, e.g. `shouldRunSyncForStatus(status: GitStatusResult): boolean`, that returns true when at least one of the following is true:
  - local (working-tree) changes are present
  - staged changes are present (if surfaced by status)
  - untracked files are present
  - `ahead > 0`
  - the repo is in a diverged state that the plan treats as actionable on this path
- Remote-only behind state (`behind > 0`, `ahead === 0`, clean working tree) should not block close. Closing is allowed to proceed without sync; remote changes are picked up by startup sync on next launch (after the initial remote fetch) and by manual sync / Ctrl+S at any time.
- Unsafe states (merge/rebase/cherry-pick in progress, wrong branch, detached HEAD, missing config) should not trigger close sync — they already disable manual sync, and the user needs to resolve them explicitly.
- Stale-or-unavailable status fallback: if the latest status is loading, errored, or missing (`null`), the safe choice is to **skip close sync and close immediately**, and document this fallback inline. Rationale: the user just asked to close; a stale status is not strong enough evidence to delay exit. (Manual Ctrl/Cmd+S in the same situation may still no-op silently for parity.)
- Ctrl/Cmd+S consults the same helper. When it returns false, the shortcut is a silent no-op (no toast, no chip flash). The manual sync button does **not** consult the helper and always runs.

Close progress overlay:
- Renders centrally over the app surface while a close sync is in flight (after preflight has said "yes, sync"). It should not be a small chip-sized affordance.
- Suggested content:
  - Title: "Syncing before close…"
  - Body: "Eskerra is saving your vault before closing."
  - Secondary hint: "Hold Shift next time to close instantly."
  - Optional minimal spinner/progress indication consistent with the design system.
- The overlay is shown only for close-driven sync. Background autosync and manual Ctrl/Cmd+S keep using the existing chip.
- Failure path: on close sync failure, hide the overlay and keep the app open (consistent with the existing close-failure policy). Surface the failure via the existing error path (toast/chip), not the overlay.
- Timeout path: on close sync timeout, hide the overlay and keep the app open. Same surfacing as failure.
- Shift-close still bypasses sync entirely and therefore never shows the overlay.

Tests:
- Ctrl/Cmd+S with clean/synced status does not call `vault_git_sync_run`.
- Ctrl/Cmd+S with local changes calls `vault_git_sync_run`.
- Close with clean/synced status closes without running sync and without showing the overlay.
- Close with local changes shows the close progress overlay and runs sync.
- Close sync failure hides the overlay and keeps the app open.
- Close sync timeout hides the overlay and keeps the app open.
- Shift-close still bypasses sync and the overlay regardless of status.
- The manual sync button still runs `vault_git_sync_run` on a clean/synced status (intentionally explicit).
- Stale/unknown status on close path takes the documented safe fallback (close immediately) and is asserted in a test.

Risks:
- A too-eager preflight could skip a sync that the user actually expected (e.g., a state the helper does not yet recognize as actionable). Mitigation: keep the predicate explicit and easy to read; cover each "yes" condition with a dedicated test.
- An overlay that is hard to dismiss on failure can feel like the app is stuck closing. Mitigation: always hide overlay on failure/timeout and keep the app interactive.
- Divergence between Ctrl/Cmd+S preflight and close preflight could surprise users. Mitigation: a single shared helper used by both.
- Adding the overlay component close to shell rendering risks coupling sync logic into UI. Mitigation: keep the overlay presentational; let the close orchestrator own state.

Open questions:
- Exact visual treatment of the central overlay (modal vs. inline central card) — to be resolved against the design system before implementation.
- Whether the overlay should expose a "Cancel and close anyway" affordance, given that the current policy keeps the app open on failure. Default for first cut: no cancel button; rely on Shift-close as the documented bypass.

Open questions and decisions to carry forward:
- Remote polling should start with narrow fetch-based refresh because it updates local remote-tracking refs and keeps status comparison simple. Run one fetch when the vault opens (before startup sync), then keep a conservative interval around 3-5 minutes while visible/focused, plus focus-return refresh with cooldown.
- Sync-on-close should keep the app open on sync failure for the first implementation. Closing anyway can lose the last obvious chance to surface the problem.
- Startup sync should wait until vault bootstrap, initial Git status, and an idle moment. It should be configurable later and quiet on no-op success.
- Batched autosync should wait until save-settled/sync-needed signaling, conflict handling, and settings are ready. The next safe step is the signal design, not background syncing.
- The most important unknown for Phase A is exactly where TodayHub writes hit persistence and whether that path already emits save-settled events. Identify this before editing code.

## architecture

**Layer placement.**
- New Rust crate-internal module: `apps/desktop/src-tauri/src/vault_git_sync/` with submodules `cli.rs`, `config.rs`, `engine.rs`, `errors.rs`, `events.rs`, `lock.rs`, `conflicts.rs`, `result.rs`, `validation.rs`, `paths.rs`, `tests/`.
- One public Tauri command: `vault_git_sync_run(vault_path, config) -> SyncResult`.
- One channel of structured progress events emitted via Tauri's event system on a per-invocation channel id (so multiple windows / future autosync runs don't cross-talk).
- Frontend module: `apps/desktop/src/features/gitSync/` with a thin client (`runVaultGitSync`), a typed config schema, a result-to-UI mapper, and the manual-sync UI.

**Why Git CLI, not libgit2.**
1. Matches the user's existing credential helpers, SSH config, `.gitconfig` hooks, signing, and `safe.directory` settings with zero new surface.
2. `git merge`'s file-level conflict resolution (including rename detection and the `:1:`/`:2:`/`:3:` stage interface) is exactly what the Bash script already relies on. Reimplementing it via libgit2 would be more code and more subtle bugs.
3. Easier to reason about and reproduce manually: every step is a shell command we can log verbatim for support.
4. Cost: we shell out per step. That is acceptable for a manual, user-triggered sync (single-digit invocations per minute at the absolute worst). We can revisit libgit2 only if we hit a concrete bottleneck.

**Process model.** Each sync is one Tauri command invocation that runs to completion in a dedicated Tokio task. Inside that task, every `git` subprocess is awaited sequentially (no parallel `git` calls share the working tree). Stdout/stderr are streamed, line-buffered, and forwarded both into structured events and into a per-run raw log buffer returned with the result.

**Locking.** A per-vault advisory lock prevents concurrent sync runs against the same working tree. The lock lives **outside the vault** so it can never accidentally end up in Git history, conflict rules, or file watching. We key it by a hash of the canonicalized vault path and place it in the Tauri app data / app local data directory — concretely something like `<app_local_data_dir>/locks/git-sync-<sha256(canonical_vault_path)[..16]>.lock`. The exact directory is resolved via the Tauri `path` API (`app_local_data_dir()`); we do not hardcode `~/.local/share/eskerra/...`, but that is what it resolves to on Linux. Lock acquisition uses OS file locking (`fs2::FileExt::try_lock_exclusive` or equivalent); the lock is released on task drop, including panics. Stale locks from a crashed previous run are detected via OS-level file lock semantics — we do not parse PID files. The lock directory is created on demand.

## configuration model

The frontend passes the full config per call. Rust does not read defaults from disk and does not "remember" prior configs. If the frontend wants to persist config it does so in its own settings store (see `specs/architecture/desktop-editor.md` patterns for `.eskerra/settings-*.json`); persistence is **out of scope** for the Rust engine.

Proposed Rust types (serde-friendly, matches the TS shape sketched in the request):

```rust
pub struct SyncConfig {
    pub remote: String,                              // e.g. "origin"
    pub branch: String,                              // explicit; no auto-detect of remote HEAD
    pub include: Vec<String>,                        // globs, vault-relative
    pub exclude: Vec<String>,                        // globs, vault-relative; always implicitly includes ".git/**" and the lock dir
    pub backup_directory: String,                    // vault-relative; default supplied by frontend, not Rust
    pub conflict_policies: Vec<ConflictPolicy>,      // ordered; first match wins
    pub markdown_conflict_callout: MarkdownCalloutConfig,
    pub commit_message_template: String,             // supports {timestamp} and {host} placeholders
    pub host_label: Option<String>,                  // resolved by frontend (e.g. from settings-local.json)
    pub backup_local_subdir: String,                 // e.g. "local"   -> backups under {backup_directory}/{backup_local_subdir}
    pub backup_remote_subdir: String,                // e.g. "remote"
    pub timeouts: SyncTimeouts,                      // per-step timeouts (fetch, push, merge)
    pub allow_create_backup_directory: bool,         // if false and backup needed, fail loudly
}

pub struct ConflictPolicy {
    pub glob: String,                                // vault-relative
    pub strategy: ConflictStrategy,                  // PreferLocal | PreferRemote | Manual
}

pub enum ConflictStrategy { PreferLocal, PreferRemote, Manual }

pub struct MarkdownCalloutConfig {
    pub enabled: bool,
    pub callout_kind: String,                        // e.g. "warning"
    pub template: String,                            // "Conflict backup: [[{backup_path}]]" — supports {backup_path}, {timestamp}, {winner}
}

pub struct SyncTimeouts {
    pub fetch_secs: u32,
    pub push_secs: u32,
    pub merge_secs: u32,
}
```

Hardcoded-only inside Rust:
- The implicit excludes `.git/**` and `<vault>/.eskerra/locks/**`. Everything else (including whether `.eskerra/**` is synced) is policy.
- Stage numbers (2 = ours, 3 = theirs) — Git protocol constants, not policy.

Validation: `SyncConfig` is validated up-front (`InvalidConfig` error) before any Git operation. Globs are compiled once via `globset` and reused.

## sync algorithm

All steps run inside the per-vault lock. Each step emits a structured progress event before it starts and a completion or error event after.

1. **Acquire lock.** Try non-blocking. If held: emit `sync:error` with `LockAlreadyHeld` and return `status: skipped` (script behavior preserved — locked is not a failure).
2. **Validate vault path.** Path exists, is a directory, canonicalizes inside an allowed root (frontend already passes a known vault; Rust re-validates).
3. **Validate repository state** (see *safety checks*).
4. **Require a clean index** before staging anything. We run `git diff --cached --quiet`; if it returns non-zero, return `UnsafeGitState::IndexNotClean` and stop. The Git index is not a sandbox — we refuse to silently mix in whatever the user had pre-staged. Documented loudly in the manual sync UI ("commit or unstage your pending changes first").
5. **Stage** files matched by `include` minus `exclude`. Implementation: enumerate `git status --porcelain=v2 -z` output, partition into included/excluded by `globset`, run `git add -- <paths>` (and explicit `git rm --cached`/etc. for deletions) on only the included paths. Never use `git add -A` followed by a blanket reset (the Bash script's approach) — too coarse for arbitrary include/exclude, and dangerous now that we require a clean index on entry.
6. **Local commit** if `git diff --cached --quiet` is non-empty. Commit message comes from `commit_message_template` with `{timestamp}` and `{host}` substituted. Hook policy is controlled by `skip_commit_hooks: bool` on `SyncConfig`; **default `true`** (i.e., `--no-verify`). Rationale: sync must be reliable, not opinionated; pre-commit hooks from other contexts (linters, formatters) commonly mistreat user-authored Markdown and would block sync for reasons unrelated to data safety. Users can flip the flag if they specifically want hooks to run.
7. **Record pre-merge HEAD** (`git rev-parse HEAD`) for recovery.
8. **Fetch** the configured remote. Bounded by `timeouts.fetch_secs`.
9. **Verify remote branch exists** at `refs/remotes/<remote>/<branch>`. If not: `RemoteBranchMissing`.
10. **Merge** `<remote>/<branch>` with `--no-edit`.
11. **If merge conflicts:** run *conflict resolution* (next section). On failure (any `Manual` policy, any unresolved file, or unexpected error):
    - Create a snapshot branch `eskerra/sync-snapshot-<timestamp>` pointing at the **pre-merge local HEAD** captured in step 7 (an extra recovery handle; never the only safety net).
    - `git merge --abort` to leave the working tree at the pre-merge state.
    - **Do not** hard-reset to remote. The Bash script's `reset --hard <remote_ref>` is too aggressive as an app default: it discards local work that may have made it into the local commit at step 6. v1 stops at "abort + restore pre-merge HEAD" and surfaces the snapshot branch + pre-merge SHA in the result for the user to act on manually.
    - Return `MergeFailed` or `ConflictResolutionFailed` with `snapshot_branch` and `pre_merge_sha` populated.
12. **Push** `HEAD:<branch>` to `<remote>`. On non-fast-forward rejection emit `PushRejected` with the remote's stderr captured. Do not auto-rebase or auto-retry in v1.
13. **Release lock** (RAII) and emit `sync:complete` with the structured result.

Steps 5–6 and 11–12 are no-ops when there is nothing to do; the result reflects that via boolean flags rather than failure.

## conflict resolution algorithm

Triggered when `git merge` exits non-zero **and** `git diff --name-only --diff-filter=U -z` returns at least one path.

For each unresolved path `p`:
1. **Pick a policy.** Walk `config.conflict_policies` in order, return the first whose glob matches `p`. If none match, behave as `Manual`.
2. **`Manual`** → record the path and continue. After the loop, if any `Manual` paths exist, conflict resolution fails as a whole (we do not partially resolve and commit a half-merged tree).
3. **`PreferLocal`** → winner = ours (stage 2), loser = theirs (stage 3), backup root = `{backup_directory}/{backup_remote_subdir}`.
4. **`PreferRemote`** → winner = theirs (stage 3), loser = ours (stage 2), backup root = `{backup_directory}/{backup_local_subdir}` (host label may be appended by the frontend if desired).
5. **Save the loser.** `git show :<loser_stage>:<p>` into a unique backup path computed from the original path, timestamp, and a numeric suffix to avoid collisions (see *paths*). If the loser stage does not exist (loser deleted the file), no backup is written and the conflict is annotated `winner: deleted`.
6. **Apply the winner.**
   - If winner stage exists: `git checkout --ours|--theirs -- <p>`.
   - If winner deleted the file: `git rm -f -- <p>`.
7. **Markdown callout.** If `markdown_conflict_callout.enabled`, the path matches `*.md` (case-insensitive), the winner is a real file (not a delete), **and** a backup was actually written, prepend the rendered template to the file. Non-Markdown files never get a callout. Binary files never get a callout (detected via `git check-attr binary` or by reading the first chunk and looking for NUL bytes — pick one and document; lean toward `git check-attr binary` because it respects `.gitattributes`).
8. **Stage the resolution.** `git add -- <p>` (or the delete already staged by `git rm`).

After the loop:
- If any path was `Manual`: bail (see step 11 of *sync algorithm*).
- If `git diff --name-only --diff-filter=U` is still non-empty: bail with `ConflictResolutionFailed`.
- If `git diff --cached --quiet` is true: no merge commit needed (rare, but possible if both sides made identical changes).
- Otherwise `git commit --no-edit` (hook policy follows `skip_commit_hooks`).

Edge cases:
- **Backup directory itself appearing as a conflict.** The implicit exclude list always contains the backup directory unless `include` explicitly re-adds it. Conflict resolution never writes a backup of a file already inside the backup directory; instead, the conflict is force-classified as `Manual`.
- **Rename conflicts.** v1 treats `git`-detected rename conflicts as `Manual` (we do not split into add+delete) and surfaces them in the result. Documented as an explicit limitation.
- **Symlinks.** Out of scope for v1; if encountered as a conflict, classify as `Manual`.

## frontend/Rust boundary

**Pre-sync handshake.** The frontend MUST flush pending editor state before calling `vault_git_sync_run`:
1. Frontend calls the existing save orchestration (`enqueueInboxPersist` and friends in `apps/desktop/src/hooks/` — see CLAUDE.md "Desktop: Note body cache"). It awaits all in-flight saves and confirms `inboxContentByUri` is aligned with `lastPersistedRef` for every dirty URI.
2. Frontend then sets a UI flag that disables editing (or at least suppresses new saves) for the duration of the sync.
3. Frontend calls `vault_git_sync_run`.
4. Rust performs sync. It does not call back into the frontend mid-run except via fire-and-forget progress events.
5. On result, frontend re-enables editing, triggers a vault rescan (the existing `vault_watch` reconcile path will pick up changes too — see CLAUDE.md "Desktop: Vault disk sync invariants"), and re-opens the previously selected note if it still exists (or shows the conflict-backup file if it was overwritten).

**Refusing while dirty.** Rust additionally checks `git diff --quiet` on tracked files; if a file is dirty in the working tree because the frontend has unsaved changes, Rust will still proceed because dirty files are exactly what we want to commit. The contract is that the frontend has *flushed* — meaning no in-memory state newer than disk. Rust cannot detect editor state, so the frontend must hold this invariant. The plan documents this; it is not a Rust check.

**Concurrency with the vault watcher.** The desktop vault watcher (see CLAUDE.md "Desktop: Vault disk sync invariants") will see many filesystem changes during sync. Two options:
- **Option A (chosen):** Do nothing special. The watcher's coarse invalidation path is designed for exactly this. Sync-time bursts will trigger one or more coarse invalidations, and the editor cache will heal from disk after. We document this in the plan and add a regression test that a sync produces at most one coarse invalidation burst (or accept N and document it).
- Option B: Pause the watcher for the duration of sync. Rejected because it adds cross-layer coupling and a new failure mode if sync hangs.

**Run identity.** Each call carries a `runId` (see *events and result types*). The frontend subscribes to the single `vault-git-sync:progress` Tauri event and filters by `runId`. No per-run channel URLs, no multi-window fan-out — those are deferred.

## safety checks

Performed in order, before any mutation. Each failure returns a typed error and emits `sync:error`.

1. `is_inside_work_tree` → else `NotGitRepository`.
2. `git rev-parse --show-toplevel` equals the canonicalized vault path → else `NotGitRepository` (we refuse to operate on a parent repository).
3. `HEAD` is a symbolic ref → else `DetachedHead`.
4. `MERGE_HEAD`, `REBASE_HEAD`/`rebase-merge/`/`rebase-apply/`, `CHERRY_PICK_HEAD`, `REVERT_HEAD`, `BISECT_LOG` absent → else `UnsafeGitState` with the specific sub-kind.
5. `.git/index.lock` absent (or older than a configurable grace period — default no grace, fail fast) → else `UnsafeGitState::IndexLock`.
5b. Index clean (`git diff --cached --quiet`) → else `UnsafeGitState::IndexNotClean`. We refuse to fold pre-staged user changes into a sync commit.
6. Current branch name (from `git symbolic-ref --short HEAD`) equals `config.branch` → else `WrongBranch`.
7. Remote exists (`git remote get-url <remote>`) → else `RemoteMissing`.
8. **Config validation** (globs compile; backup_directory is vault-relative and non-empty; templates parse) → else `InvalidConfig`.

These run after lock acquisition, so a non-fatal "another sync is running" returns `LockAlreadyHeld` before any of the above.

The remote branch existence check happens **after fetch** (step 7 in the sync algorithm) since fetch is what makes remote refs available.

## events and result types

**Progress events are intentionally minimal in v1.** Sync can take a few seconds (fetch/push over the network), so the UI needs *something* to show, but rich payloads, sequence numbers, and stdout streaming are over-engineered for a manual one-shot operation. Keep the wire shape boring; we can grow it later without breaking compatibility because the frontend mapper is the only consumer.

Wire shape (single TS-style type, mirrored on the Rust side):

```ts
type SyncProgressEvent = {
  runId: string;                                    // opaque, generated per invocation
  stage: "start" | "stage" | "commit" | "fetch" | "merge" | "push" | "complete" | "error";
  message: string;                                  // short, human-readable; safe to render verbatim
};
```

That's it. No `seq`, no per-stage payload, no raw stdout streaming, no channel URL routing, no `PushKind`/`MergeKind` enums, no `refs_updated`, no multi-window broadcasting, no telemetry counters. The structured *result* below already carries the rich data; events are just a heartbeat.

Tauri emission uses one event name (`vault-git-sync:progress`); subscribers filter by `runId`. (Frontend creates the `runId` and passes it into the command, or accepts the one Rust returns — decide in Phase 5; either way it's one string.)

Final result:

```rust
pub struct SyncResult {
    pub status: SyncStatus,                          // Success | Skipped | Failed
    pub local_commit: Option<CommitInfo>,
    pub merge_commit: Option<CommitInfo>,
    pub pushed: bool,
    pub conflict_backups: Vec<ConflictBackup>,
    pub snapshot_branch: Option<String>,             // present on failed merge recovery
    pub pre_merge_sha: Option<String>,               // captured before merge for recovery
    pub error: Option<SyncError>,
    pub message: String,
    pub raw_log: String,                             // captured stdout+stderr per step, bounded; for support, not the event stream
}

pub struct ConflictBackup {
    pub file: String,
    pub winner: Winner,                              // Local | Remote | Deleted | Manual
    pub backup_path: Option<String>,                 // None for manual / no-backup-possible
    pub callout_added: bool,
}
```

Typed errors:

```rust
pub enum SyncError {
    NotGitRepository,
    DetachedHead,
    WrongBranch { expected: String, actual: String },
    RemoteMissing { remote: String },
    RemoteBranchMissing { remote: String, branch: String },
    UnsafeGitState { kind: UnsafeKind },             // Merge | Rebase | CherryPick | Revert | Bisect | IndexLock | IndexNotClean
    FetchFailed { stderr: String },
    MergeFailed { stderr: String, snapshot_branch: Option<String>, pre_merge_sha: Option<String> },
    ConflictResolutionFailed { unresolved: Vec<String>, manual: Vec<String> },
    PushRejected { stderr: String },
    AuthenticationFailed { stderr: String },         // detected via stderr heuristics; documented as best-effort
    LockAlreadyHeld,
    InvalidConfig { reason: String },
    GitCommandFailed { command: String, exit_code: Option<i32>, stderr: String },
    Timeout { step: String, secs: u32 },
}
```

`AuthenticationFailed` is best-effort: we detect common patterns in stderr from fetch/push (`Permission denied (publickey)`, `Authentication failed`, `could not read Username`). Otherwise we fall through to `FetchFailed` / `PushRejected` / `GitCommandFailed`. Document this in the plan and in code comments.

## test plan

All tests live under `apps/desktop/src-tauri/src/vault_git_sync/tests/` and run via `cargo test`. They use real `git` against temporary directories — no libgit2, no mocks of `git` itself. A helper builds two linked repositories (local + bare remote) in a `tempfile::TempDir`, performs scripted setup, and runs the engine.

Test matrix maps 1:1 to the 17 requirements:

1. `no_changes_either_side_returns_success_skipped_pieces` — empty staging, no commit, fetch is up to date, no push.
2. `local_changes_only_commits_and_pushes`.
3. `remote_changes_only_fast_forwards_no_local_commit_no_push_needed` (push is still attempted; it's a no-op).
4. `non_conflicting_changes_both_sides_merges_cleanly`.
5. `conflict_prefer_local_writes_remote_backup_and_callout_on_md`.
6. `conflict_prefer_remote_writes_local_backup_and_callout_on_md`.
7. `conflict_winner_deleted_applies_delete_no_backup_no_callout`.
8. `markdown_callout_template_renders_with_placeholders`.
9. `non_markdown_conflict_no_callout`.
10. `backup_path_collision_uses_numeric_suffix_until_unique`.
11. `detached_head_returns_detached_head_error_without_mutating`.
12. `wrong_branch_returns_wrong_branch_error`.
13. `merge_in_progress_returns_unsafe_git_state_merge` (+ variants for rebase, cherry-pick, index lock).
14. `missing_remote_branch_returns_typed_error_after_fetch`.
15. `push_rejected_returns_typed_error_with_snapshot_unchanged` (set up by an out-of-band remote commit between fetch and push).
16. `lock_prevents_concurrent_sync_runs` — second invocation returns `LockAlreadyHeld` and does not mutate the working tree.
17. `include_exclude_rules_stage_only_intended_paths` — covers (a) include only `**/*.md`, ignore everything else; (b) exclude `Scripts/**`; (c) exclude root-level files; (d) implicit exclude of `.git/**` and `.eskerra/locks/**`.

Additional regression tests worth adding alongside the matrix:
- `manual_policy_aborts_and_creates_snapshot_branch`.
- `binary_file_conflict_no_callout_even_with_md_extension_attribute` (drives the `.gitattributes` binary check).
- `commit_message_template_substitutes_timestamp_and_host`.
- `repo_subdirectory_passed_as_vault_path_returns_not_git_repository` (we refuse to operate on a child of the git toplevel).
- `cancellation_releases_lock` (drop the future mid-run, lock file should be unlocked).
- `lock_file_lives_outside_vault_and_is_not_visible_to_git_status`.
- `pre_staged_changes_in_index_return_index_not_clean_error` (covers the new clean-index precondition).
- `failed_conflict_resolution_aborts_merge_restores_pre_merge_head_and_records_snapshot` (verifies we do **not** hard-reset to remote).
- `progress_events_emit_each_stage_at_least_once_with_runid`.

A small frontend test file (`vitest`) covers the TS client: it mocks `invoke`, asserts the config it sends, and verifies result-to-UI mapping.

## phases

**Phase 1 — Rust Git CLI wrapper and repository validation.**
- `cli.rs` with one `git(&[...]).cwd(...).env(...).timeout(...).run()` helper that captures stdout/stderr and returns structured `GitCommandOutput`.
- `validation.rs` implementing all safety checks.
- `lock.rs` implementing per-vault file lock.
- Tests for all validation failure modes (covers #11–14 partially) and lock contention (#16).
- No Tauri command yet; exercised purely via `cargo test`.

**Phase 2 — Configurable staging and local commit.**
- `config.rs` with glob compilation and validation.
- `engine.rs` step "stage + local commit".
- Tests for include/exclude (#17), commit message templating, no-op when nothing to stage.

**Phase 3 — Fetch / merge / push without automatic conflict resolution.**
- Add fetch, remote-branch verification, merge (`--no-edit`), push.
- On conflict, abort merge, snapshot, return `MergeFailed` (no policy yet).
- Tests for #1–4, #14, #15, snapshot-on-conflict, plain merge commit case.

**Phase 4 — Policy-based conflict backups and resolution.**
- `conflicts.rs` implementing the per-file algorithm.
- Backup-path generator in `paths.rs` with collision suffixing.
- Markdown callout rendering (with binary-file detection via `git check-attr binary`).
- Tests for #5–10, manual policy abort, snapshot branch on `Manual`.

**Phase 5 — Frontend command integration and progress events.**
- Register `vault_git_sync_run` Tauri command.
- `events.rs` emitting structured progress.
- TS client in `apps/desktop/src/features/gitSync/client.ts` + types.
- Vitest coverage of the client.
- Manual end-to-end smoke against a scratch vault.

**Phase 6 — Manual sync UI.**
- A "Sync vault" action in the app shell (placement decided in the UI sub-plan, not here).
- A result panel showing status, conflicts, backup links (clickable to open the backup file in the editor), and a "show raw log" disclosure.
- Pre-sync flush hook into existing save orchestration; disable editor during sync; re-trigger vault rescan after.
- Add Storybook sandbox stories for the result panel (sandbox tag — this is L3 composition, not a DS primitive).

**Phase 7 — Batched autosync / sync-needed scheduler (deferred, separate plan).**
- Listed here for completeness only. Likely lives in a separate plan document. Will need to address: sync-needed marking, at-most-once-per-configured-interval throttling, idle/visibility policy, exponential backoff on repeated failures, opt-in per vault, and a clear UI for "autosync paused because…".

## Phase 8 — Code quality review of all touched files

After the full sync engine is working and all tests pass, do a focused review pass over every file meaningfully touched during this plan. The goal is to leave the basecamp cleaner than we found it — no scope creep, no new features, just reduction of complexity.

**Scope:** every file listed in "Files likely touched" across Phases A–M, plus the Rust crate modules in `apps/desktop/src-tauri/src/vault_git_sync/` and their counterparts in `apps/desktop/src/features/gitSync/`.

**What to check per file:**

1. **Cognitive complexity.** Any function scoring high (rough threshold: > 10 branches/nesting levels) should be a refactor candidate. Extract helpers, flatten conditionals, split at natural seams.
2. **Lines of code.** Any module exceeding roughly 200–250 LOC without a compelling reason (e.g., a large exhaustive match that cannot be split) is a signal the file has too many responsibilities. Split by responsibility, not by line count alone.
3. **Dead code / temporary scaffolding.** Remove constants, flags, or branches introduced as temporary placeholders during development (e.g., hardcoded remote/branch values that should no longer exist after Phase E).
4. **Naming drift.** Rename identifiers that picked up misleading names during iteration — especially anything with `tmp`, `new`, `v2`, `fixme`, or a name that no longer matches its behaviour.
5. **Test file health.** Same criteria apply to test files: overly long test helpers, repeated setup logic that can be extracted, test names that no longer match what they assert.

**How to prioritize:**
- Start with the Rust engine modules (`engine.rs`, `conflicts.rs`, `cli.rs`) — these accumulate the most churn.
- Then the hooks in `apps/desktop/src/hooks/` and `apps/desktop/src/features/gitSync/`.
- Status chip and status bar container last (smallest surface, lowest risk).

**What this phase is not:**
- Not a feature pass. No new behavior, no new commands, no new Tauri APIs.
- Not a full architectural redesign. If a file needs a major restructure that touches other systems, file a follow-up spec rather than doing it here.
- Not a docs pass. CLAUDE.md and specs should already be updated in the phases that introduced changes.

**Done criteria:**
- No file in scope exceeds the LOC threshold without a written justification comment at the top.
- No function in scope scores above the cognitive complexity threshold without a tracked follow-up.
- All temporary constants and placeholder values removed.
- All tests still pass. Lint and type-check clean.

## open questions

1. **Where does the config live on disk?** The plan keeps Rust stateless and lets the frontend persist config. Should the canonical location be `.eskerra/settings-shared.json` (synced) or `.eskerra/settings-local.json` (per-device)? Likely shared for `include`/`exclude`/`policies`, local for `host_label` and possibly `branch`. Decide before Phase 5.
2. **Hook execution.** Resolved: `skip_commit_hooks` defaults to `true` (i.e., `--no-verify`). Sync commits should be reliable; foreign pre-commit hooks (linters/formatters that mangle Markdown) must not be able to wedge sync. Configurable for users who explicitly want hooks.
3. **Should `vault_git_sync_run` accept a "dry run" mode** that performs validation + fetch but no commit/merge/push, returning what *would* happen? Useful for a "Preview sync" UI. Out of v1 unless trivial.
4. **Snapshot branch naming and cleanup.** We create `eskerra/sync-snapshot-<timestamp>` on failed merges, but never prune them. Do we want a config knob `snapshot_branch_retention: Option<Duration>` and a one-shot cleanup pass at start? Probably yes; trivial to add.
5. **What is the contract when `config.branch` differs from the remote's default branch?** We refuse if the local checkout is on a different branch. Do we want a separate, friendlier error when the user is on `main` but config says `master` (or vice versa) because they forgot to update config? Likely the existing `WrongBranch` with `expected`/`actual` is enough.
6. **Authentication UX.** If `AuthenticationFailed` is detected, do we just surface the stderr, or do we offer a "configure credentials" link? Out of scope for v1, but should be tracked.
7. **Telemetry.** Deferred from v1 along with rich events. We can add Sentry breadcrumbs / `captureObservabilityMessage` later without breaking the event wire shape. Revisit when batched autosync (Phase 7) lands, since silent background failures are the case where telemetry actually pays for itself.
8. **Multi-vault future.** The lock and event channel design already accommodate multiple vaults, but the current desktop app is single-vault. Confirm with product before investing further multi-vault plumbing.
9. **`.eskerra/**` sync policy.** Should the default include/exclude that the *frontend* ships sync `.eskerra/settings-shared.json` (yes, that's the whole point of "shared") and exclude `.eskerra/settings-local.json` and `.eskerra/locks/**` (yes)? This is a frontend default decision, but worth aligning before Phase 6.

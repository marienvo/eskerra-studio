//! The daemon state machine: turns `reminderd.json` config + vault-watch
//! batches into an accurate, atomically-written reminder index, implementing
//! the LOCKED *Vault / config edge cases* (ADR §5, plan §*Vault / config edge
//! cases* + *Settings-only config change*) with fail-safe behavior.
//!
//! This type owns **no threads**: `main` runs the config-file watcher and the
//! vault watcher and calls [`Daemon::reload_config`] / [`Daemon::on_watch_batch`]
//! / [`Daemon::retry`]. Filesystem watching is injected through [`WatchControl`]
//! so the edge cases are unit-testable without spawning watchers.

use std::path::{Path, PathBuf};

use eskerra_reminder_core::{merge_reminders, DefaultTime, ReminderIndex};

use crate::config::ReminderdConfig;
use crate::index_store::{load_index, write_index, IndexLoadError};
use crate::notify::{NotificationRequest, Notifier};
use crate::paths::index_path_in;
use crate::rederive::rederive_for_settings;
use crate::scan::{rescan_changed_files, scan_vault};
use crate::scheduler::{self, Action, ActionOutcome, FireKind, FireRequest, SCHEDULER_GRACE_MS};

/// Injected control over the real vault filesystem watcher, so the daemon's
/// edge-case logic is testable without spawning `notify` backends. The real
/// implementation wraps `eskerra_vault_watch::VaultWatchEngine`.
pub trait WatchControl: Send {
    fn start_watching(&self, root: &Path) -> Result<(), String>;
    fn stop(&self);
}

/// What the daemon is currently doing — queried in tests and logged for
/// observability.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DaemonStateKind {
    /// No active vault (config absent / no vault) — idle, watching config only.
    Idle,
    /// Config names a vault whose path is missing/unmounted: not scanning, the
    /// previous index is preserved on disk, retrying on the next signal.
    VaultUnavailable,
    /// Actively watching + indexing a vault.
    Active,
}

/// Outcome of applying a config reload or watch batch — surfaced for
/// observability/tests. Side effects (index writes, watch start/stop) have
/// already happened by the time this is returned.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Outcome {
    /// Went (or stayed) idle — no active vault.
    Idle,
    /// Vault path missing; index preserved, no scan, no notify.
    VaultUnavailable,
    /// Config unparseable/invalid; kept the last-known-good config and current
    /// state (`reason` is the stable observability tag).
    InvalidConfigKeptLastKnownGood { reason: &'static str },
    /// Config unparseable/invalid and there is no last-known-good → idle.
    InvalidConfigIdle { reason: &'static str },
    /// Switched to (or first activated) a vault: full scan + merge written.
    VaultSwitched { reminder_count: usize },
    /// Settings-only change (no vault switch): re-derived reminder schedules.
    SettingsRederived { rederived_count: usize },
    /// Config reload found nothing actionable changed.
    NoChange,
    /// A watch batch produced a rescan.
    Rescanned { reminder_count: usize, full: bool },
    /// A watch batch arrived with no active vault — ignored.
    Ignored,
}

struct ActiveVault {
    root: PathBuf,
    hash: String,
    default_time: DefaultTime,
    lead_minutes: u32,
    index: ReminderIndex,
}

pub struct Daemon {
    config_path: PathBuf,
    data_dir: PathBuf,
    watch: Box<dyn WatchControl>,
    notifier: Box<dyn Notifier>,
    /// Grace tolerance for scheduled fires past `dueAt` (timer jitter / brief
    /// suspend). Configurable for tests; defaults to [`SCHEDULER_GRACE_MS`].
    grace_ms: i64,
    last_known_good: Option<ReminderdConfig>,
    active: Option<ActiveVault>,
    /// Set when the active config names a vault whose path is currently missing
    /// (so `retry` knows to re-check without re-reading the file).
    unavailable: bool,
    /// Earliest instant the run loop should wake to fire/flip a reminder, or
    /// `None` when nothing is armed. Recomputed after every reminder change.
    next_wakeup_ms: Option<i64>,
    /// Set when the active vault has a valid index but the filesystem watcher
    /// failed to arm. Retry/config reloads reattempt the watch without forcing
    /// a full rescan.
    watch_needs_rearm: bool,
}

impl Daemon {
    pub fn new(
        config_path: PathBuf,
        data_dir: PathBuf,
        watch: Box<dyn WatchControl>,
        notifier: Box<dyn Notifier>,
    ) -> Self {
        Self {
            config_path,
            data_dir,
            watch,
            notifier,
            grace_ms: SCHEDULER_GRACE_MS,
            last_known_good: None,
            active: None,
            unavailable: false,
            next_wakeup_ms: None,
            watch_needs_rearm: false,
        }
    }

    /// Earliest armed fire/flip instant (epoch ms), for the run loop's
    /// sleep-until-next. `None` = nothing armed; the loop falls back to its
    /// periodic safety tick.
    pub fn next_wakeup_ms(&self) -> Option<i64> {
        self.next_wakeup_ms
    }

    pub fn state(&self) -> DaemonStateKind {
        if self.active.is_some() {
            DaemonStateKind::Active
        } else if self.unavailable {
            DaemonStateKind::VaultUnavailable
        } else {
            DaemonStateKind::Idle
        }
    }

    /// The in-memory index for the active vault, if any (for tests / app reads
    /// happen via the file, not this).
    pub fn active_index(&self) -> Option<&ReminderIndex> {
        self.active.as_ref().map(|a| &a.index)
    }

    pub fn index_path_for(&self, vault_hash: &str) -> PathBuf {
        index_path_in(&self.data_dir, vault_hash)
    }

    /// Re-read `reminderd.json` and apply it. Fail-safe per ADR §5.
    pub fn reload_config(&mut self, now_ms: i64) -> Outcome {
        let text = match std::fs::read_to_string(&self.config_path) {
            Ok(text) => text,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
                // Restart before the app ever wrote a config → no vault → idle.
                return self.go_idle();
            }
            Err(err) => {
                eprintln!("[reminderd] config read error: {err}");
                // Transient read error: keep whatever we have rather than churn.
                return self.keep_or_idle("read_error");
            }
        };

        match ReminderdConfig::from_json(&text) {
            Ok(cfg) => {
                self.last_known_good = Some(cfg.clone());
                self.apply_config(cfg, now_ms)
            }
            Err(err) => {
                eprintln!("[reminderd] {err}");
                self.keep_or_idle(err.reason_tag())
            }
        }
    }

    /// Re-apply the last-known-good config (used by a backoff retry while a
    /// vault is unavailable, or to re-evaluate without re-reading the file).
    pub fn retry(&mut self, now_ms: i64) -> Outcome {
        match self.last_known_good.clone() {
            Some(cfg) => self.apply_config(cfg, now_ms),
            None => self.go_idle(),
        }
    }

    /// Handle a debounced vault-watch batch by rescanning. No-op without an
    /// active vault.
    pub fn on_watch_batch(&mut self, coarse: bool, paths: &[String], now_ms: i64) -> Outcome {
        let Some(active) = self.active.as_ref() else {
            return Outcome::Ignored;
        };
        // Snapshot what the scan needs, ending the immutable borrow before the
        // mutable re-borrow / `&mut self` discovery call below.
        let root = active.root.clone();
        let default_time = active.default_time;
        let lead_minutes = active.lead_minutes;
        let prior = active.index.reminders.clone();

        // Decide full vs incremental. Coarse → full. A still-existing touched
        // directory → full (conservative: we don't track which files it
        // contains). Otherwise incremental over the changed paths under the
        // vault root. NOTE: `is_dir()` is best-effort — a *deleted* directory no
        // longer reports as one, so it falls through to the incremental path;
        // `rescan_changed_files` drops prior reminders by prefix there, so that
        // race cannot leave stale entries for files under a removed directory.
        let abs_paths: Vec<PathBuf> = paths.iter().map(PathBuf::from).collect();
        let touches_directory = abs_paths.iter().any(|p| p.is_dir());
        let full = coarse || touches_directory;

        let fresh = if full {
            scan_vault(&root, default_time, lead_minutes)
        } else {
            rescan_changed_files(&root, &prior, &abs_paths, default_time, lead_minutes)
        };
        let merged = merge_reminders(&prior, fresh);
        let count = merged.len();
        if let Some(active) = self.active.as_mut() {
            active.index.reminders = merged;
        }
        // Re-classify against `now` (discovery) and persist + re-arm.
        self.run_discovery_and_dispatch(now_ms);
        Outcome::Rescanned {
            reminder_count: count,
            full,
        }
    }

    /// Scheduled-fire / minute-tick: execute armed fires whose `fireAt` arrived
    /// (with grace), then run a discovery pass to flip overdue reminders to
    /// `Due` and fire any now-inside-window lead. Persists + re-arms. No-op
    /// without an active vault.
    pub fn on_tick(&mut self, now_ms: i64) -> usize {
        if self.active.is_none() {
            return 0;
        }
        let grace = self.grace_ms;
        let mut fires = {
            let active = self.active.as_mut().unwrap();
            let mut f = scheduler::run_timers(&mut active.index.reminders, now_ms, grace);
            f.extend(scheduler::discover(&mut active.index.reminders, now_ms));
            f
        };
        let fired = fires.len();
        // De-dup defensively (a reminder cannot appear in both passes, but keep
        // the contract that we send each notification at most once per tick).
        fires.dedup_by(|a, b| a.reminder_id == b.reminder_id);
        self.dispatch(fires, now_ms);
        fired
    }

    /// Resume catch-up on the wake edge (`PrepareForSleep(false)`): re-evaluate
    /// already-armed reminders as deferred scheduled fires (same rule as a
    /// timer, honoring `lastNotifiedMs` so a brief suspend never double-fires),
    /// then discover any reminders first seen on the wake scan. Identical wiring
    /// to [`Daemon::on_tick`]; kept distinct for observability/clarity.
    pub fn on_resume(&mut self, now_ms: i64) -> usize {
        self.on_tick(now_ms)
    }

    /// Handle a notification action for `reminder_id`, where `notification_id`
    /// is the platform id of the triggering notification (so an at-time
    /// `FiredNow` can replace it in place rather than duplicate it). Applies the
    /// snooze / remove / open rules, persists any state change, re-arms, and (for
    /// an at-time snooze-0 fire) sends the notification. Returns the outcome for
    /// logging. `Remove`/`Open` are Phase 4 / Phase 5 hooks here.
    pub fn on_action(
        &mut self,
        reminder_id: &str,
        notification_id: u32,
        action: Action,
        now_ms: i64,
    ) -> ActionOutcome {
        if self.active.is_none() {
            return ActionOutcome::Unknown;
        }
        let outcome = {
            let active = self.active.as_mut().unwrap();
            scheduler::apply_action(&mut active.index.reminders, reminder_id, action, now_ms)
        };
        match &outcome {
            // These mutate no reminder state. `Unknown` never matched a reminder;
            // `Remove`/`Open` are Phase 4/5 stubs that only route (they will mutate
            // state once wired). Skip the dispatch so we don't rewrite the index or
            // bump `generatedAt` for a no-op.
            ActionOutcome::Unknown
            | ActionOutcome::RemoveRequested
            | ActionOutcome::OpenRequested => {}
            // snooze-0 at exactly due fires immediately. Replace the triggering
            // notification (`replaces_id = notification_id`) so the desktop never
            // shows two live notifications for the same reminder.
            ActionOutcome::FiredNow => {
                let fires = vec![FireRequest {
                    reminder_id: reminder_id.to_string(),
                    kind: FireKind::AtTime,
                }];
                self.dispatch_replacing(fires, notification_id, now_ms);
            }
            // Rescheduled / ExpiredNoOp may have changed scheduling state (e.g. a
            // snooze re-arm or an overdue snooze-0 flipping to `Due`): persist +
            // re-arm, nothing to send.
            ActionOutcome::Rescheduled { .. } | ActionOutcome::ExpiredNoOp => {
                self.dispatch(Vec::new(), now_ms);
            }
        }
        outcome
    }

    // --- internals ---

    fn apply_config(&mut self, cfg: ReminderdConfig, now_ms: i64) -> Outcome {
        if !cfg.has_vault() {
            return self.go_idle();
        }
        let root = PathBuf::from(cfg.vault_root.as_deref().unwrap());
        let hash = cfg.vault_hash.clone().unwrap();

        // Vault path must exist and be a directory, else "vault unavailable":
        // do not scan, do not clear/overwrite the index, do not notify.
        if !root.is_dir() {
            self.watch.stop();
            self.active = None;
            self.unavailable = true;
            self.next_wakeup_ms = None;
            self.watch_needs_rearm = false;
            eprintln!(
                "[reminderd] vault unavailable (path missing): {}",
                root.display()
            );
            return Outcome::VaultUnavailable;
        }

        // Same vault still active → either settings-only change or no change.
        if let Some(active) = self.active.as_mut() {
            if active.hash == hash && active.root == root {
                let settings_changed = active.default_time != cfg.date_only_default_time
                    || active.lead_minutes != cfg.lead_minutes;
                if !settings_changed {
                    self.rearm_watch_if_needed();
                    return Outcome::NoChange;
                }
                // Settings-only re-derive: no session bump, no teardown. Update
                // the times, then re-run discovery (the changed schedule is a
                // schedule change) and persist + re-arm.
                active.default_time = cfg.date_only_default_time;
                active.lead_minutes = cfg.lead_minutes;
                let rederived = rederive_for_settings(
                    &mut active.index.reminders,
                    cfg.date_only_default_time,
                    cfg.lead_minutes,
                );
                self.run_discovery_and_dispatch(now_ms);
                self.rearm_watch_if_needed();
                return Outcome::SettingsRederived {
                    rederived_count: rederived,
                };
            }
        }

        // Vault switch (or first activation): tear down, load prior index, full
        // scan, merge, then discover + write + re-arm watch.
        self.watch.stop();
        self.watch_needs_rearm = false;
        let prior_index = match load_index(&index_path_in(&self.data_dir, &hash)) {
            Ok(index) => index,
            Err(IndexLoadError::NotFound) => ReminderIndex::new(hash.clone(), now_ms, vec![]),
            Err(other) => {
                eprintln!("[reminderd] index unreadable, rebuilding from scratch: {other:?}");
                ReminderIndex::new(hash.clone(), now_ms, vec![])
            }
        };
        let fresh = scan_vault(&root, cfg.date_only_default_time, cfg.lead_minutes);
        let merged = merge_reminders(&prior_index.reminders, fresh);
        let count = merged.len();
        let index = ReminderIndex::new(hash.clone(), now_ms, merged);
        self.unavailable = false;
        self.active = Some(ActiveVault {
            root: root.clone(),
            hash,
            default_time: cfg.date_only_default_time,
            lead_minutes: cfg.lead_minutes,
            index,
        });
        if let Err(err) = self.watch.start_watching(&root) {
            eprintln!("[reminderd] watch start failed: {err}");
            self.watch_needs_rearm = true;
        } else {
            self.watch_needs_rearm = false;
        }
        // Discovery classifies the freshly-scanned reminders against `now`
        // (overdue -> due in-app, in-window -> fire, future -> armed) and writes
        // the index post-classification.
        self.run_discovery_and_dispatch(now_ms);
        Outcome::VaultSwitched {
            reminder_count: count,
        }
    }

    fn rearm_watch_if_needed(&mut self) {
        if !self.watch_needs_rearm {
            return;
        }
        let Some(active) = self.active.as_ref() else {
            self.watch_needs_rearm = false;
            return;
        };
        match self.watch.start_watching(&active.root) {
            Ok(()) => {
                self.watch_needs_rearm = false;
            }
            Err(err) => {
                eprintln!("[reminderd] watch rearm failed: {err}");
            }
        }
    }

    /// Run a discovery pass over the active index, then dispatch (send fires +
    /// persist). The single funnel used after every index change (vault switch,
    /// settings re-derive, watch rescan).
    fn run_discovery_and_dispatch(&mut self, now_ms: i64) {
        if self.active.is_none() {
            self.next_wakeup_ms = None;
            return;
        }
        let fires = {
            let active = self.active.as_mut().unwrap();
            scheduler::discover(&mut active.index.reminders, now_ms)
        };
        self.dispatch(fires, now_ms);
    }

    /// Send the decided notifications, persist the active index, and recompute
    /// the next wakeup. The reminder state transitions behind `fires` have
    /// already been applied by the scheduler; sending is best-effort (a D-Bus
    /// failure is logged, never fatal, and never re-fires thanks to the
    /// `lastNotifiedMs` guard).
    fn dispatch(&mut self, fires: Vec<FireRequest>, now_ms: i64) {
        self.dispatch_replacing(fires, 0, now_ms);
    }

    /// Like [`Daemon::dispatch`], but the sent notifications replace the platform
    /// notification `replaces_id` (0 = fresh). Used by [`Daemon::on_action`] for
    /// an at-time `FiredNow`, which carries exactly one fire, so a single
    /// `replaces_id` applies cleanly; the normal scheduling paths pass 0.
    fn dispatch_replacing(&mut self, fires: Vec<FireRequest>, replaces_id: u32, now_ms: i64) {
        // Phase 1: build requests + persist under the active borrow.
        let requests: Vec<NotificationRequest> = {
            let Some(active) = self.active.as_mut() else {
                self.next_wakeup_ms = None;
                return;
            };
            let requests = fires
                .iter()
                .filter_map(|f| {
                    active
                        .index
                        .reminders
                        .iter()
                        .find(|r| r.id == f.reminder_id)
                        .map(|r| NotificationRequest::for_reminder(r, f.kind).replacing(replaces_id))
                })
                .collect();
            active.index.generated_at_ms = now_ms;
            let path = index_path_in(&self.data_dir, &active.hash);
            if let Err(err) = write_index(&path, &active.index) {
                eprintln!("[reminderd] index write failed: {err}");
            }
            self.next_wakeup_ms = scheduler::next_wakeup_ms(&active.index.reminders, now_ms);
            requests
        };
        // Phase 2: send (no active borrow held — distinct field `notifier`).
        for req in &requests {
            if let Err(err) = self.notifier.send(req) {
                eprintln!("[reminderd] notification_send failed: {err}");
            }
        }
    }

    fn go_idle(&mut self) -> Outcome {
        self.watch.stop();
        self.active = None;
        self.unavailable = false;
        self.next_wakeup_ms = None;
        self.watch_needs_rearm = false;
        Outcome::Idle
    }

    /// On invalid config: keep the current state if there is a last-known-good
    /// config (and we were doing something), otherwise idle.
    fn keep_or_idle(&mut self, reason: &'static str) -> Outcome {
        if self.last_known_good.is_some() {
            Outcome::InvalidConfigKeptLastKnownGood { reason }
        } else {
            self.watch.stop();
            self.active = None;
            self.unavailable = false;
            self.next_wakeup_ms = None;
            self.watch_needs_rearm = false;
            Outcome::InvalidConfigIdle { reason }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    use eskerra_reminder_core::ReminderState;

    const NOW: i64 = 1_700_000_000_000;

    /// Records start/stop calls so tests can assert teardown vs. no-teardown:
    /// a vault switch must `stop` then `start`; a settings-only change must do
    /// neither (no session bump / no index teardown).
    struct RecordingWatch {
        log: Arc<Mutex<Vec<String>>>,
        start_failures_remaining: Arc<Mutex<usize>>,
    }

    impl WatchControl for RecordingWatch {
        fn start_watching(&self, root: &Path) -> Result<(), String> {
            self.log
                .lock()
                .unwrap()
                .push(format!("start:{}", root.display()));
            let mut failures = self.start_failures_remaining.lock().unwrap();
            if *failures > 0 {
                *failures -= 1;
                return Err("injected start failure".to_string());
            }
            Ok(())
        }
        fn stop(&self) {
            self.log.lock().unwrap().push("stop".to_string());
        }
    }

    /// Records the full notification requests sent, so tests can assert firing
    /// (reminder id) and replacement (`replaces_id`) without a live D-Bus / GNOME.
    struct RecordingNotifier {
        sent: Arc<Mutex<Vec<NotificationRequest>>>,
    }

    impl crate::notify::Notifier for RecordingNotifier {
        fn send(&self, req: &NotificationRequest) -> Result<u32, String> {
            self.sent.lock().unwrap().push(req.clone());
            // A distinct, non-zero id per send, mimicking the platform handing
            // back a fresh notification id (used to correlate replacement).
            Ok(self.sent.lock().unwrap().len() as u32)
        }
    }

    struct Harness {
        _tmp: tempfile::TempDir,
        config_path: PathBuf,
        data_dir: PathBuf,
        vault: PathBuf,
        log: Arc<Mutex<Vec<String>>>,
        sent: Arc<Mutex<Vec<NotificationRequest>>>,
        start_failures_remaining: Arc<Mutex<usize>>,
    }

    impl Harness {
        fn new() -> Self {
            let tmp = tempfile::tempdir().unwrap();
            let config_path = tmp.path().join("config/reminderd.json");
            let data_dir = tmp.path().join("data/reminders");
            let vault = tmp.path().join("vault");
            std::fs::create_dir_all(&vault).unwrap();
            std::fs::create_dir_all(config_path.parent().unwrap()).unwrap();
            Self {
                _tmp: tmp,
                config_path,
                data_dir,
                vault,
                log: Arc::new(Mutex::new(Vec::new())),
                sent: Arc::new(Mutex::new(Vec::new())),
                start_failures_remaining: Arc::new(Mutex::new(0)),
            }
        }

        fn daemon(&self) -> Daemon {
            Daemon::new(
                self.config_path.clone(),
                self.data_dir.clone(),
                Box::new(RecordingWatch {
                    log: Arc::clone(&self.log),
                    start_failures_remaining: Arc::clone(&self.start_failures_remaining),
                }),
                Box::new(RecordingNotifier {
                    sent: Arc::clone(&self.sent),
                }),
            )
        }

        fn sent(&self) -> Vec<String> {
            self.sent
                .lock()
                .unwrap()
                .iter()
                .map(|r| r.reminder_id.clone())
                .collect()
        }

        fn sent_requests(&self) -> Vec<NotificationRequest> {
            self.sent.lock().unwrap().clone()
        }

        fn fail_next_watch_starts(&self, count: usize) {
            *self.start_failures_remaining.lock().unwrap() = count;
        }

        fn write_config(&self, json: &str) {
            std::fs::write(&self.config_path, json).unwrap();
        }

        fn write_note(&self, rel: &str, body: &str) {
            let path = self.vault.join(rel);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, body).unwrap();
        }

        fn config_for(&self, hash: &str, time: &str, lead: u32) -> String {
            format!(
                r#"{{"schemaVersion":1,"vaultRoot":{:?},"vaultHash":"{hash}","dateOnlyDefaultTime":"{time}","leadMinutes":{lead}}}"#,
                self.vault.to_string_lossy()
            )
        }

        fn index_path(&self, hash: &str) -> PathBuf {
            index_path_in(&self.data_dir, hash)
        }

        fn log(&self) -> Vec<String> {
            self.log.lock().unwrap().clone()
        }
    }

    #[test]
    fn no_vault_config_is_idle() {
        let h = Harness::new();
        h.write_config(r#"{"schemaVersion":1}"#);
        let mut d = h.daemon();
        assert_eq!(d.reload_config(NOW), Outcome::Idle);
        assert_eq!(d.state(), DaemonStateKind::Idle);
        assert_eq!(h.log(), vec!["stop"]);
    }

    #[test]
    fn config_not_found_is_idle() {
        let h = Harness::new();
        // no config file written
        let mut d = h.daemon();
        assert_eq!(d.reload_config(NOW), Outcome::Idle);
        assert_eq!(d.state(), DaemonStateKind::Idle);
    }

    #[test]
    fn vault_switch_full_scans_merges_and_writes_index() {
        let h = Harness::new();
        h.write_note("Inbox/a.md", "meet @2026-06-06_0900 soon");
        h.write_note("Inbox/b.md", "deadline @2026-12-31");
        h.write_config(&h.config_for("vh1", "09:00", 5));

        let mut d = h.daemon();
        assert_eq!(
            d.reload_config(NOW),
            Outcome::VaultSwitched { reminder_count: 2 }
        );
        assert_eq!(d.state(), DaemonStateKind::Active);

        // Index file written with both reminders.
        let index =
            ReminderIndex::from_json(&std::fs::read_to_string(h.index_path("vh1")).unwrap())
                .unwrap();
        assert_eq!(index.reminders.len(), 2);
        assert_eq!(index.vault_hash, "vh1");

        // A switch tears down then re-arms the watcher.
        assert_eq!(
            h.log(),
            vec!["stop".to_string(), format!("start:{}", h.vault.display())]
        );
    }

    #[test]
    fn missing_vault_path_preserves_index_and_does_not_scan() {
        let h = Harness::new();
        // Pre-populate an index for vh1, then point config at a missing vault.
        let preexisting = ReminderIndex::new("vh1".to_string(), 42, vec![]);
        crate::index_store::write_index(&h.index_path("vh1"), &preexisting).unwrap();
        let before = std::fs::read(h.index_path("vh1")).unwrap();

        let missing = h.vault.join("does-not-exist");
        let cfg = format!(
            r#"{{"schemaVersion":1,"vaultRoot":{:?},"vaultHash":"vh1"}}"#,
            missing.to_string_lossy()
        );
        h.write_config(&cfg);

        let mut d = h.daemon();
        assert_eq!(d.reload_config(NOW), Outcome::VaultUnavailable);
        assert_eq!(d.state(), DaemonStateKind::VaultUnavailable);

        // Index untouched; watcher stopped, never started.
        assert_eq!(std::fs::read(h.index_path("vh1")).unwrap(), before);
        assert_eq!(h.log(), vec!["stop"]);
    }

    #[test]
    fn settings_only_change_rederives_without_teardown_keeps_ids_and_timed_fire_at() {
        let h = Harness::new();
        h.write_note("Inbox/a.md", "@2026-06-06"); // date-only → default time
        h.write_note("Inbox/timed.md", "@2026-06-06_2330"); // explicit time
        h.write_config(&h.config_for("vh1", "09:00", 5));

        let mut d = h.daemon();
        assert_eq!(
            d.reload_config(NOW),
            Outcome::VaultSwitched { reminder_count: 2 }
        );

        let date_id_before = d
            .active_index()
            .unwrap()
            .reminders
            .iter()
            .find(|r| r.normalized_token_text == "@2026-06-06")
            .unwrap()
            .id
            .clone();
        let due_before = d
            .active_index()
            .unwrap()
            .reminders
            .iter()
            .find(|r| r.normalized_token_text == "@2026-06-06")
            .unwrap()
            .due_at_ms;
        let timed_before = d
            .active_index()
            .unwrap()
            .reminders
            .iter()
            .find(|r| r.normalized_token_text == "@2026-06-06_2330")
            .unwrap()
            .clone();
        let timed_due_before = timed_before.due_at_ms;
        let timed_fire_before = timed_before.fire_at_ms;
        let log_after_switch = h.log();

        // Same vault/hash, earlier default time and longer lead.
        h.write_config(&h.config_for("vh1", "08:00", 10));
        assert_eq!(
            d.reload_config(NOW + 1),
            Outcome::SettingsRederived { rederived_count: 2 }
        );

        let date_after = d
            .active_index()
            .unwrap()
            .reminders
            .iter()
            .find(|r| r.normalized_token_text == "@2026-06-06")
            .unwrap()
            .clone();
        // Identity preserved; due moved one hour earlier.
        assert_eq!(date_after.id, date_id_before);
        assert_eq!(due_before - date_after.due_at_ms, 60 * 60 * 1000);

        // Timed token keeps its explicit due time but moves fireAt for the new lead.
        let timed_after = d
            .active_index()
            .unwrap()
            .reminders
            .iter()
            .find(|r| r.normalized_token_text == "@2026-06-06_2330")
            .unwrap()
            .clone();
        assert_eq!(timed_after.due_at_ms, timed_due_before);
        assert_eq!(timed_fire_before - timed_after.fire_at_ms, 5 * 60_000);
        assert_eq!(timed_after.state, ReminderState::Scheduled);
        assert_eq!(timed_after.last_notified_ms, None);

        // No teardown / re-arm on a settings-only change.
        assert_eq!(
            h.log(),
            log_after_switch,
            "settings-only change must not stop/start the watcher"
        );
    }

    #[test]
    fn restart_reconstructs_from_disk_carries_notified_then_settings_resets_it() {
        let h = Harness::new();
        h.write_note("Inbox/a.md", "@2026-06-06");
        h.write_config(&h.config_for("vh1", "09:00", 5));

        // First run builds the index.
        let mut d1 = h.daemon();
        assert!(matches!(
            d1.reload_config(NOW),
            Outcome::VaultSwitched { .. }
        ));

        // Simulate the date-only reminder having fired at the old 09:00 by
        // editing the persisted index, then "restart" with a fresh Daemon.
        let mut index =
            ReminderIndex::from_json(&std::fs::read_to_string(h.index_path("vh1")).unwrap())
                .unwrap();
        let snooze_fire = index.reminders[0].fire_at_ms;
        index.reminders[0].state = ReminderState::Notified;
        index.reminders[0].last_notified_ms = Some(snooze_fire);
        crate::index_store::write_index(&h.index_path("vh1"), &index).unwrap();

        let mut d2 = h.daemon();
        assert!(matches!(
            d2.reload_config(NOW),
            Outcome::VaultSwitched { .. }
        ));
        // Merge carried the notified state across the restart.
        let after_restart = &d2.active_index().unwrap().reminders[0];
        assert_eq!(after_restart.state, ReminderState::Notified);
        assert_eq!(after_restart.last_notified_ms, Some(snooze_fire));

        // A settings-only re-derive must reset that stale notified state so the
        // new time can fire.
        h.write_config(&h.config_for("vh1", "08:00", 5));
        assert_eq!(
            d2.reload_config(NOW + 1),
            Outcome::SettingsRederived { rederived_count: 1 }
        );
        let after_rederive = &d2.active_index().unwrap().reminders[0];
        assert_eq!(after_rederive.state, ReminderState::Scheduled);
        assert_eq!(after_rederive.last_notified_ms, None);
    }

    #[test]
    fn settings_rederive_keeps_stale_reminder_stale_and_non_firing() {
        let h = Harness::new();
        h.write_note("Inbox/a.md", "@2026-06-06"); // date-only
        h.write_config(&h.config_for("vh1", "09:00", 5));

        // Build the index, then mark the reminder Stale on disk and "restart" so
        // the merge carries the Stale state across (same config → same dueAt).
        let mut d1 = h.daemon();
        assert!(matches!(d1.reload_config(NOW), Outcome::VaultSwitched { .. }));
        let mut index =
            ReminderIndex::from_json(&std::fs::read_to_string(h.index_path("vh1")).unwrap())
                .unwrap();
        index.reminders[0].state = ReminderState::Stale;
        index.reminders[0].last_notified_ms = None;
        crate::index_store::write_index(&h.index_path("vh1"), &index).unwrap();

        let mut d = h.daemon();
        assert!(matches!(d.reload_config(NOW), Outcome::VaultSwitched { .. }));
        assert_eq!(
            d.active_index().unwrap().reminders[0].state,
            ReminderState::Stale,
            "stale carried across restart"
        );
        let due_before = d.active_index().unwrap().reminders[0].due_at_ms;

        // Settings-only change (earlier time + longer lead) must NOT resurrect it.
        h.write_config(&h.config_for("vh1", "08:00", 10));
        assert_eq!(
            d.reload_config(NOW + 1),
            Outcome::SettingsRederived { rederived_count: 0 },
            "a stale reminder is not a schedule change"
        );
        let after = &d.active_index().unwrap().reminders[0];
        assert_eq!(after.state, ReminderState::Stale, "still stale after rederive");
        assert_eq!(after.due_at_ms, due_before, "stale times untouched");
        assert!(h.sent().is_empty(), "settings rederive fired nothing");

        // A subsequent discovery/timer pass well past the (old) due time must
        // still not fire the stale reminder.
        let fired = d.on_tick(due_before + 60_000);
        assert_eq!(fired, 0);
        assert!(h.sent().is_empty(), "discovery must not fire a stale reminder");
        assert_eq!(d.active_index().unwrap().reminders[0].state, ReminderState::Stale);
    }

    #[test]
    fn retry_rearms_watcher_after_start_failure_without_rebuilding_index() {
        let h = Harness::new();
        h.write_note("Inbox/a.md", "@2026-06-06_0900");
        h.write_config(&h.config_for("vh1", "09:00", 5));
        h.fail_next_watch_starts(1);

        let mut d = h.daemon();
        assert_eq!(
            d.reload_config(NOW),
            Outcome::VaultSwitched { reminder_count: 1 }
        );
        assert_eq!(d.state(), DaemonStateKind::Active);
        let generated_before = d.active_index().unwrap().generated_at_ms;
        assert_eq!(
            h.log(),
            vec!["stop".to_string(), format!("start:{}", h.vault.display())]
        );

        assert_eq!(d.retry(NOW + 1), Outcome::NoChange);
        assert_eq!(d.active_index().unwrap().generated_at_ms, generated_before);
        assert_eq!(
            h.log(),
            vec![
                "stop".to_string(),
                format!("start:{}", h.vault.display()),
                format!("start:{}", h.vault.display())
            ]
        );
    }

    #[test]
    fn settings_only_change_rearms_failed_watcher_without_teardown() {
        let h = Harness::new();
        h.write_note("Inbox/a.md", "@2026-06-06");
        h.write_config(&h.config_for("vh1", "09:00", 5));
        h.fail_next_watch_starts(1);

        let mut d = h.daemon();
        assert_eq!(
            d.reload_config(NOW),
            Outcome::VaultSwitched { reminder_count: 1 }
        );

        h.write_config(&h.config_for("vh1", "08:00", 5));
        assert_eq!(
            d.reload_config(NOW + 1),
            Outcome::SettingsRederived { rederived_count: 1 }
        );
        assert_eq!(
            h.log(),
            vec![
                "stop".to_string(),
                format!("start:{}", h.vault.display()),
                format!("start:{}", h.vault.display())
            ]
        );
    }

    #[test]
    fn invalid_config_keeps_last_known_good_and_does_not_disturb_active_vault() {
        let h = Harness::new();
        h.write_note("Inbox/a.md", "@2026-06-06_0900");
        h.write_config(&h.config_for("vh1", "09:00", 5));

        let mut d = h.daemon();
        assert!(matches!(
            d.reload_config(NOW),
            Outcome::VaultSwitched { .. }
        ));
        let index_before = std::fs::read(h.index_path("vh1")).unwrap();
        let log_before = h.log();

        // Corrupt the config.
        h.write_config("{ this is not valid json");
        assert_eq!(
            d.reload_config(NOW + 1),
            Outcome::InvalidConfigKeptLastKnownGood { reason: "parse" }
        );
        // Still active, index and watcher undisturbed.
        assert_eq!(d.state(), DaemonStateKind::Active);
        assert_eq!(std::fs::read(h.index_path("vh1")).unwrap(), index_before);
        assert_eq!(h.log(), log_before);
    }

    #[test]
    fn config_read_error_uses_distinct_reason_tag_and_keeps_last_known_good() {
        let h = Harness::new();
        h.write_note("Inbox/a.md", "@2026-06-06_0900");
        h.write_config(&h.config_for("vh1", "09:00", 5));

        let mut d = h.daemon();
        assert!(matches!(
            d.reload_config(NOW),
            Outcome::VaultSwitched { .. }
        ));
        let index_before = std::fs::read(h.index_path("vh1")).unwrap();
        let log_before = h.log();

        std::fs::remove_file(&h.config_path).unwrap();
        std::fs::create_dir(&h.config_path).unwrap();
        assert_eq!(
            d.reload_config(NOW + 1),
            Outcome::InvalidConfigKeptLastKnownGood {
                reason: "read_error"
            }
        );
        assert_eq!(d.state(), DaemonStateKind::Active);
        assert_eq!(std::fs::read(h.index_path("vh1")).unwrap(), index_before);
        assert_eq!(h.log(), log_before);
    }

    #[test]
    fn invalid_config_with_no_prior_is_idle() {
        let h = Harness::new();
        h.write_config(r#"{"schemaVersion":99}"#);
        let mut d = h.daemon();
        assert_eq!(
            d.reload_config(NOW),
            Outcome::InvalidConfigIdle { reason: "version" }
        );
        assert_eq!(d.state(), DaemonStateKind::Idle);
    }

    #[test]
    fn watch_batch_without_active_vault_is_ignored() {
        let h = Harness::new();
        let mut d = h.daemon();
        assert_eq!(
            d.on_watch_batch(false, &["/whatever/x.md".to_string()], NOW),
            Outcome::Ignored
        );
    }

    #[test]
    fn incremental_watch_batch_updates_index_for_edited_file() {
        let h = Harness::new();
        h.write_note("Inbox/a.md", "@2026-06-06_0900");
        h.write_note("Inbox/b.md", "@2026-07-07_1000");
        h.write_config(&h.config_for("vh1", "09:00", 5));

        let mut d = h.daemon();
        assert_eq!(
            d.reload_config(NOW),
            Outcome::VaultSwitched { reminder_count: 2 }
        );

        // Edit a.md's token on disk, then deliver a precise (non-coarse) batch.
        h.write_note("Inbox/a.md", "@2026-06-06_1100 moved");
        let changed = vec![h.vault.join("Inbox/a.md").to_string_lossy().into_owned()];
        let outcome = d.on_watch_batch(false, &changed, NOW + 1);
        assert_eq!(
            outcome,
            Outcome::Rescanned {
                reminder_count: 2,
                full: false
            }
        );

        let index =
            ReminderIndex::from_json(&std::fs::read_to_string(h.index_path("vh1")).unwrap())
                .unwrap();
        let a = index
            .reminders
            .iter()
            .find(|r| r.vault_relative_path == "Inbox/a.md")
            .unwrap();
        assert_eq!(a.normalized_token_text, "@2026-06-06_1100");
        // b.md unchanged.
        assert!(index
            .reminders
            .iter()
            .any(|r| r.normalized_token_text == "@2026-07-07_1000"));
    }

    #[test]
    fn deleted_directory_in_incremental_batch_drops_stale_reminders() {
        let h = Harness::new();
        h.write_note("Inbox/a.md", "@2026-06-06_0900");
        h.write_note("Inbox/b.md", "@2026-07-07_1000");
        h.write_note("Notes/keep.md", "@2026-08-08_1200");
        h.write_config(&h.config_for("vh1", "09:00", 5));

        let mut d = h.daemon();
        assert_eq!(
            d.reload_config(NOW),
            Outcome::VaultSwitched { reminder_count: 3 }
        );

        // Delete the whole Inbox/ directory, then deliver a precise (non-coarse)
        // batch carrying only the now-missing directory path. is_dir() is false
        // (it's gone), so this lands on the incremental path — which must still
        // drop both Inbox/ reminders rather than leave them stale.
        std::fs::remove_dir_all(h.vault.join("Inbox")).unwrap();
        let changed = vec![h.vault.join("Inbox").to_string_lossy().into_owned()];
        let outcome = d.on_watch_batch(false, &changed, NOW + 1);
        assert_eq!(
            outcome,
            Outcome::Rescanned {
                reminder_count: 1,
                full: false
            }
        );

        let index =
            ReminderIndex::from_json(&std::fs::read_to_string(h.index_path("vh1")).unwrap())
                .unwrap();
        assert_eq!(index.reminders.len(), 1);
        assert_eq!(index.reminders[0].vault_relative_path, "Notes/keep.md");
    }

    // --- scheduler / notification wiring (Phase 3) ------------------------

    /// Helper: the active reminder's (fire_at, due_at), asserting exactly one.
    fn the_times(d: &Daemon) -> (i64, i64) {
        let r = &d.active_index().unwrap().reminders[0];
        (r.fire_at_ms, r.due_at_ms)
    }

    #[test]
    fn switch_arms_future_reminder_without_firing() {
        let h = Harness::new();
        h.write_note("Inbox/a.md", "@2026-06-06_0900");
        h.write_config(&h.config_for("vh1", "09:00", 5));

        let mut d = h.daemon();
        assert!(matches!(
            d.reload_config(NOW),
            Outcome::VaultSwitched { .. }
        ));
        let (fire_at, _due) = the_times(&d);
        // NOW (2023) is far before the 2026 fire → armed, nothing sent.
        assert_eq!(
            d.active_index().unwrap().reminders[0].state,
            ReminderState::Scheduled
        );
        assert!(h.sent().is_empty());
        assert_eq!(d.next_wakeup_ms(), Some(fire_at));
    }

    #[test]
    fn tick_at_fire_time_sends_notification_and_marks_notified() {
        let h = Harness::new();
        h.write_note("Inbox/a.md", "@2026-06-06_0900");
        h.write_config(&h.config_for("vh1", "09:00", 5));

        let mut d = h.daemon();
        d.reload_config(NOW);
        let (fire_at, _due) = the_times(&d);

        let fired = d.on_tick(fire_at);
        assert_eq!(fired, 1);
        let id = d.active_index().unwrap().reminders[0].id.clone();
        assert_eq!(h.sent(), vec![id]);
        assert_eq!(
            d.active_index().unwrap().reminders[0].state,
            ReminderState::Notified
        );
        // Nothing left armed → no further wakeup.
        assert_eq!(d.next_wakeup_ms(), None);
        // A second tick does not re-fire.
        assert_eq!(d.on_tick(fire_at + 1), 0);
        assert_eq!(h.sent().len(), 1);
    }

    #[test]
    fn overdue_at_switch_is_due_in_app_only_no_notification() {
        let h = Harness::new();
        h.write_note("Inbox/a.md", "@2026-06-06_0900");
        h.write_config(&h.config_for("vh1", "09:00", 5));

        let mut d = h.daemon();
        d.reload_config(NOW);
        let (_fire, due) = the_times(&d);

        // Re-switch with `now` past due (simulate discovery of an overdue token).
        // A fresh daemon discovering it well after due must not pop a popup.
        let mut d2 = h.daemon();
        d2.reload_config(due + 60_000);
        assert_eq!(
            d2.active_index().unwrap().reminders[0].state,
            ReminderState::Due
        );
        assert!(h.sent().is_empty(), "overdue discovery must be in-app only");
    }

    #[test]
    fn snooze_action_reschedules_and_persists_to_index() {
        let h = Harness::new();
        h.write_note("Inbox/a.md", "@2026-06-06_0900");
        h.write_config(&h.config_for("vh1", "09:00", 5));

        let mut d = h.daemon();
        d.reload_config(NOW);
        let (fire_at, due) = the_times(&d);
        let id = d.active_index().unwrap().reminders[0].id.clone();

        // Fire the lead, then snooze-3 before dueAt-3min.
        d.on_tick(fire_at);
        let now = due - 4 * 60_000;
        let outcome = d.on_action(&id, 1, Action::Snooze { minutes: 3 }, now);
        assert_eq!(
            outcome,
            ActionOutcome::Rescheduled {
                fire_at_ms: due - 3 * 60_000
            }
        );

        // Persisted to disk with the new fire time + re-armed.
        let index =
            ReminderIndex::from_json(&std::fs::read_to_string(h.index_path("vh1")).unwrap())
                .unwrap();
        assert_eq!(index.reminders[0].fire_at_ms, due - 3 * 60_000);
        assert_eq!(d.next_wakeup_ms(), Some(due - 3 * 60_000));

        // The snoozed fire later executes once.
        let fired = d.on_tick(due - 3 * 60_000);
        assert_eq!(fired, 1);
        assert_eq!(h.sent(), vec![id.clone(), id]);
    }

    #[test]
    fn action_for_unknown_reminder_is_ignored_without_rewrite() {
        let h = Harness::new();
        h.write_note("Inbox/a.md", "@2026-06-06_0900");
        h.write_config(&h.config_for("vh1", "09:00", 5));

        let mut d = h.daemon();
        d.reload_config(NOW);
        let before = std::fs::read(h.index_path("vh1")).unwrap();

        let outcome = d.on_action("no-such-id", 1, Action::Snooze { minutes: 1 }, NOW + 1);
        assert_eq!(outcome, ActionOutcome::Unknown);
        // Index untouched (no needless rewrite / generatedAt bump).
        assert_eq!(std::fs::read(h.index_path("vh1")).unwrap(), before);
    }

    #[test]
    fn remove_and_open_stubs_do_not_rewrite_index_or_bump_generated_at() {
        let h = Harness::new();
        h.write_note("Inbox/a.md", "@2026-06-06_0900");
        h.write_config(&h.config_for("vh1", "09:00", 5));

        let mut d = h.daemon();
        d.reload_config(NOW);
        let id = d.active_index().unwrap().reminders[0].id.clone();
        let generated_before = d.active_index().unwrap().generated_at_ms;
        let before = std::fs::read(h.index_path("vh1")).unwrap();

        // Remove is a Phase 4 stub: routed but mutates no state → no index write.
        let outcome = d.on_action(&id, 7, Action::Remove, NOW + 1);
        assert_eq!(outcome, ActionOutcome::RemoveRequested);
        assert_eq!(std::fs::read(h.index_path("vh1")).unwrap(), before);
        assert_eq!(d.active_index().unwrap().generated_at_ms, generated_before);

        // Open (default click) is a Phase 5 stub: likewise no index write.
        let outcome = d.on_action(&id, 7, Action::Open, NOW + 2);
        assert_eq!(outcome, ActionOutcome::OpenRequested);
        assert_eq!(std::fs::read(h.index_path("vh1")).unwrap(), before);
        assert_eq!(d.active_index().unwrap().generated_at_ms, generated_before);

        // No notifications were sent for the stubs.
        assert!(h.sent().is_empty());
    }

    #[test]
    fn fired_now_replaces_the_triggering_notification_instead_of_duplicating() {
        let h = Harness::new();
        h.write_note("Inbox/a.md", "@2026-06-06_0900");
        h.write_config(&h.config_for("vh1", "09:00", 5));

        let mut d = h.daemon();
        d.reload_config(NOW);
        let (_fire, due) = the_times(&d);
        let id = d.active_index().unwrap().reminders[0].id.clone();

        // Fire the lead first (this is the "triggering" notification). The fake
        // notifier hands back id 1 for it.
        d.on_tick(due - 5 * 60_000);
        assert_eq!(h.sent_requests().len(), 1);
        let trigger_id = h.sent_requests()[0].replaces_id;
        assert_eq!(trigger_id, 0, "the lead is a fresh notification");

        // snooze-0 at exactly due, arriving from notification id 1 → FiredNow,
        // and the at-time notification must REPLACE notification id 1 rather than
        // open a second live notification.
        let outcome = d.on_action(&id, 1, Action::Snooze { minutes: 0 }, due);
        assert_eq!(outcome, ActionOutcome::FiredNow);

        let reqs = h.sent_requests();
        assert_eq!(reqs.len(), 2, "exactly one more notification, not a duplicate");
        assert_eq!(reqs[1].reminder_id, id);
        assert_eq!(
            reqs[1].replaces_id, 1,
            "FiredNow must replace the triggering notification id"
        );
    }
}

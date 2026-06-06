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
use crate::paths::index_path_in;
use crate::rederive::rederive_date_only;
use crate::scan::{rescan_changed_files, scan_vault};

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
    /// Settings-only change (no vault switch): re-derived date-only reminders.
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
    last_known_good: Option<ReminderdConfig>,
    active: Option<ActiveVault>,
    /// Set when the active config names a vault whose path is currently missing
    /// (so `retry` knows to re-check without re-reading the file).
    unavailable: bool,
}

impl Daemon {
    pub fn new(config_path: PathBuf, data_dir: PathBuf, watch: Box<dyn WatchControl>) -> Self {
        Self {
            config_path,
            data_dir,
            watch,
            last_known_good: None,
            active: None,
            unavailable: false,
        }
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
                return self.keep_or_idle("parse");
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
        let root = active.root.clone();

        // Decide full vs incremental. Coarse → full. A touched directory → full
        // (conservative: we don't track which files it contains). Otherwise
        // incremental over the changed file paths under the vault root.
        let abs_paths: Vec<PathBuf> = paths.iter().map(PathBuf::from).collect();
        let touches_directory = abs_paths.iter().any(|p| p.is_dir());
        let full = coarse || touches_directory;

        let prior = active.index.reminders.clone();
        let fresh = if full {
            scan_vault(&root, active.default_time, active.lead_minutes)
        } else {
            rescan_changed_files(&root, &prior, &abs_paths, active.default_time, active.lead_minutes)
        };
        let merged = merge_reminders(&prior, fresh);
        let count = merged.len();
        self.write_active_index(merged, now_ms);
        Outcome::Rescanned { reminder_count: count, full }
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
            eprintln!("[reminderd] vault unavailable (path missing): {}", root.display());
            return Outcome::VaultUnavailable;
        }

        // Same vault still active → either settings-only change or no change.
        if let Some(active) = self.active.as_mut() {
            if active.hash == hash && active.root == root {
                let settings_changed = active.default_time != cfg.date_only_default_time
                    || active.lead_minutes != cfg.lead_minutes;
                if !settings_changed {
                    return Outcome::NoChange;
                }
                // Settings-only re-derive: no session bump, no teardown.
                active.default_time = cfg.date_only_default_time;
                active.lead_minutes = cfg.lead_minutes;
                let rederived =
                    rederive_date_only(&mut active.index.reminders, cfg.date_only_default_time, cfg.lead_minutes);
                active.index.generated_at_ms = now_ms;
                let path = index_path_in(&self.data_dir, &hash);
                if let Err(err) = write_index(&path, &active.index) {
                    eprintln!("[reminderd] index write failed: {err}");
                }
                return Outcome::SettingsRederived { rederived_count: rederived };
            }
        }

        // Vault switch (or first activation): tear down, load prior index, full
        // scan, merge, write, re-arm watch.
        self.watch.stop();
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
        let path = index_path_in(&self.data_dir, &hash);
        if let Err(err) = write_index(&path, &index) {
            eprintln!("[reminderd] index write failed: {err}");
        }
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
        }
        Outcome::VaultSwitched { reminder_count: count }
    }

    fn write_active_index(&mut self, merged: Vec<eskerra_reminder_core::Reminder>, now_ms: i64) {
        if let Some(active) = self.active.as_mut() {
            active.index.reminders = merged;
            active.index.generated_at_ms = now_ms;
            let path = index_path_in(&self.data_dir, &active.hash);
            if let Err(err) = write_index(&path, &active.index) {
                eprintln!("[reminderd] index write failed: {err}");
            }
        }
    }

    fn go_idle(&mut self) -> Outcome {
        self.watch.stop();
        self.active = None;
        self.unavailable = false;
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
    }

    impl WatchControl for RecordingWatch {
        fn start_watching(&self, root: &Path) -> Result<(), String> {
            self.log.lock().unwrap().push(format!("start:{}", root.display()));
            Ok(())
        }
        fn stop(&self) {
            self.log.lock().unwrap().push("stop".to_string());
        }
    }

    struct Harness {
        _tmp: tempfile::TempDir,
        config_path: PathBuf,
        data_dir: PathBuf,
        vault: PathBuf,
        log: Arc<Mutex<Vec<String>>>,
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
            }
        }

        fn daemon(&self) -> Daemon {
            Daemon::new(
                self.config_path.clone(),
                self.data_dir.clone(),
                Box::new(RecordingWatch { log: Arc::clone(&self.log) }),
            )
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
        assert_eq!(d.reload_config(NOW), Outcome::VaultSwitched { reminder_count: 2 });
        assert_eq!(d.state(), DaemonStateKind::Active);

        // Index file written with both reminders.
        let index = ReminderIndex::from_json(&std::fs::read_to_string(h.index_path("vh1")).unwrap()).unwrap();
        assert_eq!(index.reminders.len(), 2);
        assert_eq!(index.vault_hash, "vh1");

        // A switch tears down then re-arms the watcher.
        assert_eq!(h.log(), vec!["stop".to_string(), format!("start:{}", h.vault.display())]);
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
    fn settings_only_change_rederives_without_teardown_keeps_ids_leaves_timed() {
        let h = Harness::new();
        h.write_note("Inbox/a.md", "@2026-06-06"); // date-only → default time
        h.write_note("Inbox/timed.md", "@2026-06-06_2330"); // explicit time
        h.write_config(&h.config_for("vh1", "09:00", 5));

        let mut d = h.daemon();
        assert_eq!(d.reload_config(NOW), Outcome::VaultSwitched { reminder_count: 2 });

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
        let log_after_switch = h.log();

        // Same vault/hash, earlier default time.
        h.write_config(&h.config_for("vh1", "08:00", 5));
        assert_eq!(d.reload_config(NOW + 1), Outcome::SettingsRederived { rederived_count: 1 });

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

        // Timed token untouched.
        let timed_after = d
            .active_index()
            .unwrap()
            .reminders
            .iter()
            .find(|r| r.normalized_token_text == "@2026-06-06_2330")
            .unwrap()
            .clone();
        assert_eq!(timed_after, timed_before);

        // No teardown / re-arm on a settings-only change.
        assert_eq!(h.log(), log_after_switch, "settings-only change must not stop/start the watcher");
    }

    #[test]
    fn restart_reconstructs_from_disk_carries_notified_then_settings_resets_it() {
        let h = Harness::new();
        h.write_note("Inbox/a.md", "@2026-06-06");
        h.write_config(&h.config_for("vh1", "09:00", 5));

        // First run builds the index.
        let mut d1 = h.daemon();
        assert!(matches!(d1.reload_config(NOW), Outcome::VaultSwitched { .. }));

        // Simulate the date-only reminder having fired at the old 09:00 by
        // editing the persisted index, then "restart" with a fresh Daemon.
        let mut index = ReminderIndex::from_json(&std::fs::read_to_string(h.index_path("vh1")).unwrap()).unwrap();
        let snooze_fire = index.reminders[0].fire_at_ms;
        index.reminders[0].state = ReminderState::Notified;
        index.reminders[0].last_notified_ms = Some(snooze_fire);
        crate::index_store::write_index(&h.index_path("vh1"), &index).unwrap();

        let mut d2 = h.daemon();
        assert!(matches!(d2.reload_config(NOW), Outcome::VaultSwitched { .. }));
        // Merge carried the notified state across the restart.
        let after_restart = &d2.active_index().unwrap().reminders[0];
        assert_eq!(after_restart.state, ReminderState::Notified);
        assert_eq!(after_restart.last_notified_ms, Some(snooze_fire));

        // A settings-only re-derive must reset that stale notified state so the
        // new time can fire.
        h.write_config(&h.config_for("vh1", "08:00", 5));
        assert_eq!(d2.reload_config(NOW + 1), Outcome::SettingsRederived { rederived_count: 1 });
        let after_rederive = &d2.active_index().unwrap().reminders[0];
        assert_eq!(after_rederive.state, ReminderState::Scheduled);
        assert_eq!(after_rederive.last_notified_ms, None);
    }

    #[test]
    fn invalid_config_keeps_last_known_good_and_does_not_disturb_active_vault() {
        let h = Harness::new();
        h.write_note("Inbox/a.md", "@2026-06-06_0900");
        h.write_config(&h.config_for("vh1", "09:00", 5));

        let mut d = h.daemon();
        assert!(matches!(d.reload_config(NOW), Outcome::VaultSwitched { .. }));
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
        assert_eq!(d.reload_config(NOW), Outcome::VaultSwitched { reminder_count: 2 });

        // Edit a.md's token on disk, then deliver a precise (non-coarse) batch.
        h.write_note("Inbox/a.md", "@2026-06-06_1100 moved");
        let changed = vec![h.vault.join("Inbox/a.md").to_string_lossy().into_owned()];
        let outcome = d.on_watch_batch(false, &changed, NOW + 1);
        assert_eq!(outcome, Outcome::Rescanned { reminder_count: 2, full: false });

        let index = ReminderIndex::from_json(&std::fs::read_to_string(h.index_path("vh1")).unwrap()).unwrap();
        let a = index.reminders.iter().find(|r| r.vault_relative_path == "Inbox/a.md").unwrap();
        assert_eq!(a.normalized_token_text, "@2026-06-06_1100");
        // b.md unchanged.
        assert!(index.reminders.iter().any(|r| r.normalized_token_text == "@2026-07-07_1000"));
    }
}

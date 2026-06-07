//! Phase 7 end-to-end integration tests.
//!
//! These exercise the daemon through its **public API** (`Daemon` +
//! `WatchControl` + `Notifier` + the `writeback::Remover`) against a **real
//! temp vault on disk**, so they cover the cross-module seams the per-module
//! unit tests do not: scan → index → schedule → fire → snooze → write-back →
//! index drop, the live-rescan merge/state-migration, settings-only re-derive,
//! vault switch, and suspend/resume catch-up — all wired together exactly as the
//! run loop wires them, just driven synchronously with an injected clock.
//!
//! Times are read back from the produced index (`due_at_ms`/`fire_at_ms`) rather
//! than hardcoded, so the assertions are timezone-independent.

use std::path::Path;
use std::sync::{Arc, Mutex};

use eskerra_reminder_core::{ReminderIndex, ReminderState};
use eskerra_reminderd::scheduler::SCHEDULER_GRACE_MS;
use eskerra_reminderd::{
    Action, ActionOutcome, Daemon, DaemonStateKind, NotificationRequest, Notifier, Outcome,
    RemoveResult, Remover,
};

/// `now` well before every 2026 token under test → reminders stay armed
/// (`Scheduled`) until a test advances the clock explicitly.
const NOW: i64 = 1_700_000_000_000; // 2023-11-14

// --- test doubles -----------------------------------------------------------

/// No-op watcher: the daemon's scan/schedule logic is driven directly by the
/// tests, so we only need `start`/`stop` to be callable.
struct NoopWatch;
impl eskerra_reminderd::WatchControl for NoopWatch {
    fn start_watching(&self, _root: &Path) -> Result<(), String> {
        Ok(())
    }
    fn stop(&self) {}
}

/// Records every notification the daemon decided to send, so tests assert
/// firing without a live D-Bus / GNOME.
#[derive(Clone, Default)]
struct RecordingNotifier {
    sent: Arc<Mutex<Vec<NotificationRequest>>>,
}
impl Notifier for RecordingNotifier {
    fn send(&self, req: &NotificationRequest) -> Result<u32, String> {
        let mut sent = self.sent.lock().unwrap();
        sent.push(req.clone());
        Ok(sent.len() as u32)
    }
}

struct Harness {
    _tmp: tempfile::TempDir,
    config_path: std::path::PathBuf,
    data_dir: std::path::PathBuf,
    vault: std::path::PathBuf,
    notifier: RecordingNotifier,
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
            notifier: RecordingNotifier::default(),
        }
    }

    fn daemon(&self) -> Daemon {
        Daemon::new(
            self.config_path.clone(),
            self.data_dir.clone(),
            Box::new(NoopWatch),
            Box::new(self.notifier.clone()),
        )
    }

    fn write_config(&self, hash: &str, time: &str, lead: u32) {
        let json = format!(
            r#"{{"schemaVersion":1,"vaultRoot":{:?},"vaultHash":"{hash}","dateOnlyDefaultTime":"{time}","leadMinutes":{lead}}}"#,
            self.vault.to_string_lossy()
        );
        std::fs::write(&self.config_path, json).unwrap();
    }

    fn write_note(&self, rel: &str, body: &str) {
        let path = self.vault.join(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, body).unwrap();
    }

    fn read_note(&self, rel: &str) -> String {
        std::fs::read_to_string(self.vault.join(rel)).unwrap()
    }

    fn note_path(&self, rel: &str) -> String {
        self.vault.join(rel).to_string_lossy().into_owned()
    }

    /// Reminder ids the notifier was asked to send, in order.
    fn fired_ids(&self) -> Vec<String> {
        self.notifier
            .sent
            .lock()
            .unwrap()
            .iter()
            .map(|r| r.reminder_id.clone())
            .collect()
    }

    /// The persisted (on-disk) index for `hash` — proves the daemon wrote it,
    /// not just mutated memory.
    fn on_disk_index(&self, hash: &str) -> ReminderIndex {
        let path =
            eskerra_reminderd::paths::index_path_in(&self.data_dir, hash);
        ReminderIndex::from_json(&std::fs::read_to_string(path).unwrap()).unwrap()
    }
}

/// Run the production remove flow against the active vault: resolve the target,
/// strike under the per-note lock, then record the outcome in the index.
fn remove(d: &mut Daemon, id: &str, now: i64) -> RemoveResult {
    let target = d.remove_target(id).expect("reminder present");
    let result = Remover::new().remove(
        &target.note_abs_path,
        &target.lock_key,
        &target.stored,
        |_| {},
    );
    d.apply_remove_result(id, result, now);
    result
}

// --- full lifecycle ---------------------------------------------------------

#[test]
fn full_lifecycle_scan_fire_snooze_remove_strikes_and_drops_from_index() {
    let h = Harness::new();
    h.write_note("Inbox/a.md", "remind @2026-06-06_0900 here");
    h.write_config("vh1", "09:00", 5);

    let mut d = h.daemon();
    assert!(matches!(d.reload_config(NOW), Outcome::VaultSwitched { reminder_count: 1 }));
    assert_eq!(d.state(), DaemonStateKind::Active);

    let r = &d.active_index().unwrap().reminders[0];
    let (id, fire_at, due) = (r.id.clone(), r.fire_at_ms, r.due_at_ms);

    // Armed, nothing fired yet, the loop knows when to wake.
    assert_eq!(r.state, ReminderState::Scheduled);
    assert_eq!(d.next_wakeup_ms(), Some(fire_at));
    assert!(h.fired_ids().is_empty());

    // The lead fires once at fire_at.
    assert_eq!(d.on_tick(fire_at), 1);
    assert_eq!(d.active_index().unwrap().reminders[0].state, ReminderState::Notified);
    assert_eq!(h.fired_ids(), vec![id.clone()]);

    // Snooze-1 before dueAt-1min reschedules; it later fires once more.
    let outcome = d.on_action(&id, 1, Action::Snooze { minutes: 1 }, due - 2 * 60_000);
    assert_eq!(outcome, ActionOutcome::Rescheduled { fire_at_ms: due - 60_000 });
    assert_eq!(d.next_wakeup_ms(), Some(due - 60_000));
    assert_eq!(d.on_tick(due - 60_000), 1);
    assert_eq!(h.fired_ids(), vec![id.clone(), id.clone()]);

    // Remove → strike on disk, drop from index, nothing left armed.
    assert_eq!(remove(&mut d, &id, due), RemoveResult::Removed);
    assert_eq!(h.read_note("Inbox/a.md"), "remind @~~2026-06-06_0900~~ here");
    assert!(d.active_index().unwrap().reminders.is_empty());
    assert_eq!(d.next_wakeup_ms(), None);
    assert!(h.on_disk_index("vh1").reminders.is_empty());
}

#[test]
fn daemon_strike_is_a_minimal_byte_diff_in_a_multiline_note() {
    // The daemon rewriting an open note must be indistinguishable from any other
    // external on-disk edit: only the token bytes change, every other byte is
    // preserved so the app's reconcile sees a minimal diff.
    let h = Harness::new();
    let body = "# Heading\n\nfirst line\nmeet @2026-06-06_0900 with team\nlast line\n";
    h.write_note("Notes/plan.md", body);
    h.write_config("vh1", "09:00", 5);

    let mut d = h.daemon();
    d.reload_config(NOW);
    let id = d.active_index().unwrap().reminders[0].id.clone();

    assert_eq!(remove(&mut d, &id, NOW + 1), RemoveResult::Removed);

    let expected = body.replace("@2026-06-06_0900", "@~~2026-06-06_0900~~");
    assert_eq!(h.read_note("Notes/plan.md"), expected);
}

// --- missed / grace + overdue discovery -------------------------------------

#[test]
fn discovery_within_lead_window_fires_once_overdue_is_in_app_only() {
    let h = Harness::new();
    h.write_note("Inbox/a.md", "@2026-06-06_0900");
    h.write_config("vh1", "09:00", 5);

    // First learn the times with a far-past `now`.
    let mut probe = h.daemon();
    probe.reload_config(NOW);
    let r = &probe.active_index().unwrap().reminders[0];
    let (fire_at, due) = (r.fire_at_ms, r.due_at_ms);

    // Discovery with fireAt <= now < dueAt → fire the lead immediately, once.
    let h2 = Harness::new();
    h2.write_note("Inbox/a.md", "@2026-06-06_0900");
    h2.write_config("vh1", "09:00", 5);
    let mut d = h2.daemon();
    d.reload_config(fire_at + 1000);
    assert_eq!(h2.fired_ids().len(), 1, "in-window discovery fires the lead once");
    assert_eq!(d.active_index().unwrap().reminders[0].state, ReminderState::Notified);

    // Discovery with now >= dueAt → overdue, in-app only, no popup.
    let h3 = Harness::new();
    h3.write_note("Inbox/a.md", "@2026-06-06_0900");
    h3.write_config("vh1", "09:00", 5);
    let mut d3 = h3.daemon();
    d3.reload_config(due + 60_000);
    assert!(h3.fired_ids().is_empty(), "overdue discovery is silent");
    assert_eq!(d3.active_index().unwrap().reminders[0].state, ReminderState::Due);
}

// --- suspend / resume catch-up ----------------------------------------------

#[test]
fn resume_within_grace_fires_once_beyond_grace_is_overdue_no_popup() {
    let h = Harness::new();
    h.write_note("Inbox/a.md", "@2026-06-06_0900");
    h.write_config("vh1", "09:00", 5);
    let mut d = h.daemon();
    d.reload_config(NOW); // armed before "suspend"
    let r = &d.active_index().unwrap().reminders[0];
    let (id, fire_at) = (r.id.clone(), r.fire_at_ms);

    // The fire elapsed during a short suspend; the wake edge fires it once.
    assert_eq!(d.on_resume(fire_at + 1000), 1);
    assert_eq!(h.fired_ids(), vec![id]);
    // A second resume does not double-fire the same fireAt.
    assert_eq!(d.on_resume(fire_at + 2000), 0);
    assert_eq!(h.fired_ids().len(), 1);

    // A reminder whose fire elapsed beyond the grace window during a long
    // suspend becomes overdue with no stale popup.
    let h2 = Harness::new();
    h2.write_note("Inbox/a.md", "@2026-06-06_0900");
    h2.write_config("vh1", "09:00", 5);
    let mut d2 = h2.daemon();
    d2.reload_config(NOW);
    let due = d2.active_index().unwrap().reminders[0].due_at_ms;
    assert_eq!(d2.on_resume(due + SCHEDULER_GRACE_MS + 60_000), 0);
    assert!(h2.fired_ids().is_empty());
    assert_eq!(d2.active_index().unwrap().reminders[0].state, ReminderState::Due);
}

// --- merge / state migration across a live rescan ---------------------------

#[test]
fn snooze_migrates_by_unique_context_anchor_after_identical_token_inserted_above() {
    // Two byte-identical tokens with distinct surrounding context → distinct
    // contextAnchors. Snooze the second one, then insert a *third* identical
    // token above both so occurrence ordinals shift and the affected ids change.
    let h = Harness::new();
    h.write_note(
        "Inbox/a.md",
        "alpha @2026-06-06_0900 first\nbeta @2026-06-06_0900 second\n",
    );
    h.write_config("vh1", "09:00", 5);
    let mut d = h.daemon();
    d.reload_config(NOW);

    let reminders = &d.active_index().unwrap().reminders;
    assert_eq!(reminders.len(), 2);
    let due = reminders[0].due_at_ms;
    let default_fire = reminders[0].fire_at_ms; // due - 5min
    // The "beta" reminder is occurrence ordinal 1 (document order).
    let beta_id = reminders
        .iter()
        .find(|r| r.occurrence_ordinal == 1)
        .unwrap()
        .id
        .clone();

    // Realistic flow: the lead fires (both become `Notified` with a guard),
    // then the user snoozes beta from its still-visible notification. Snoozing
    // a never-fired reminder is indistinguishable from a plain baseline and is
    // intentionally reset by the merge, so the fire is what makes the snooze an
    // override worth carrying.
    d.on_tick(default_fire);
    let snooze_now = due - 4 * 60_000;
    let outcome = d.on_action(&beta_id, 1, Action::Snooze { minutes: 3 }, snooze_now);
    assert_eq!(outcome, ActionOutcome::Rescheduled { fire_at_ms: due - 3 * 60_000 });

    // Insert an identical token ABOVE both lines → ordinals: gamma=0, alpha=1,
    // beta=2. The old ordinal-1 id now refers to the *alpha* line.
    h.write_note(
        "Inbox/a.md",
        "gamma @2026-06-06_0900 inserted\nalpha @2026-06-06_0900 first\nbeta @2026-06-06_0900 second\n",
    );
    let changed = vec![h.note_path("Inbox/a.md")];
    d.on_watch_batch(false, &changed, snooze_now);

    let after = &d.active_index().unwrap().reminders;
    assert_eq!(after.len(), 3);
    let fire_by_ordinal = |ord: u32| {
        after
            .iter()
            .find(|r| r.occurrence_ordinal == ord)
            .unwrap()
            .fire_at_ms
    };
    // The snooze migrated to beta's NEW line (ordinal 2) by unique contextAnchor.
    assert_eq!(fire_by_ordinal(2), due - 3 * 60_000, "snooze followed beta's content");
    // The inserted line (ordinal 0) and the alpha line (ordinal 1 — which now
    // holds the old beta id) must NOT carry the snooze: no wrong-line carry.
    assert_eq!(fire_by_ordinal(0), default_fire, "inserted line has no snooze");
    assert_eq!(fire_by_ordinal(1), default_fire, "alpha did not inherit old ordinal-1 id's state");
}

// --- vault switch -----------------------------------------------------------

#[test]
fn vault_switch_keeps_separate_indexes_and_does_not_cross_fire() {
    let h = Harness::new();
    h.write_note("a.md", "@2026-06-06_0900");
    h.write_config("vh1", "09:00", 5);
    let mut d = h.daemon();
    d.reload_config(NOW);
    let vh1_id = d.active_index().unwrap().reminders[0].id.clone();
    let fire_at = d.active_index().unwrap().reminders[0].fire_at_ms;

    // Switch to a different vault hash (same temp dir, but the index is keyed by
    // hash, so each vault gets its own index file).
    h.write_config("vh2", "09:00", 5);
    assert!(matches!(d.reload_config(NOW), Outcome::VaultSwitched { .. }));
    assert_eq!(d.active_index().unwrap().vault_hash, "vh2");

    // Firing while vh2 is active records vh2's reminder, never vh1's.
    let fired = d.on_tick(fire_at);
    assert_eq!(fired, 1);
    let vh2_id = d.active_index().unwrap().reminders[0].id.clone();
    assert_eq!(h.fired_ids(), vec![vh2_id]);

    // Switching back restores vh1's own index (its reminder still armed,
    // un-fired) — each vault hash persisted independently.
    h.write_config("vh1", "09:00", 5);
    d.reload_config(NOW);
    assert_eq!(d.active_index().unwrap().vault_hash, "vh1");
    assert_eq!(d.active_index().unwrap().reminders[0].id, vh1_id);
    assert_eq!(d.active_index().unwrap().reminders[0].state, ReminderState::Scheduled);
}

// --- settings-only re-derive ------------------------------------------------

#[test]
fn settings_only_default_time_change_rederives_same_id_and_resets_notified() {
    let h = Harness::new();
    h.write_note("a.md", "@2026-06-06"); // date-only → default time applies
    h.write_config("vh1", "09:00", 5);
    let mut d = h.daemon();
    d.reload_config(NOW);
    let before = &d.active_index().unwrap().reminders[0];
    let (id, due_0900) = (before.id.clone(), before.due_at_ms);

    // Fire it (so lastNotifiedMs/Notified are set against the 09:00 time).
    d.on_tick(before.fire_at_ms);
    assert_eq!(d.active_index().unwrap().reminders[0].state, ReminderState::Notified);

    // Settings-only change: same vault, new default time 08:00.
    h.write_config("vh1", "08:00", 5);
    assert!(matches!(
        d.reload_config(NOW),
        Outcome::SettingsRederived { rederived_count: 1 }
    ));

    let after = &d.active_index().unwrap().reminders[0];
    assert_eq!(after.id, id, "re-derive keeps the same identity");
    assert_eq!(after.due_at_ms, due_0900 - 60 * 60_000, "dueAt moved 09:00 → 08:00");
    // The stale notified state for the OLD time must not suppress the new fire.
    assert_eq!(after.state, ReminderState::Scheduled);
    assert_eq!(after.last_notified_ms, None);
    assert_eq!(d.next_wakeup_ms(), Some(after.fire_at_ms));
}

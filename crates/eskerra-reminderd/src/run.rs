//! Process wiring: build the [`Daemon`], arm the vault watcher, the config-file
//! watcher, the D-Bus notifier + its action listener, and the login1
//! suspend/resume listener, then run the single-threaded event loop. All
//! threads funnel into one mpsc channel so the `Daemon` (which owns no threads)
//! is driven from one place.
//!
//! The loop uses `recv_timeout` driven by [`Daemon::next_wakeup_ms`] so it
//! sleeps until the next armed fire (capped by a periodic safety/reconciliation
//! tick), then runs a scheduler tick. Suspend/resume is handled via
//! `org.freedesktop.login1`'s `PrepareForSleep` signal, with the periodic tick
//! as the fallback when login1 is unavailable.

use std::path::Path;
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::Arc;
use std::time::Duration;

use chrono::Utc;
use eskerra_vault_watch::{VaultWatchEngine, WatchBatch};
use notify::{Config as NotifyConfig, Event, RecommendedWatcher, RecursiveMode, Watcher};

use crate::daemon::{Daemon, RemoveTarget};
use crate::notify::{Notifier, NullNotifier};
use crate::paths::{config_dir, config_path, reminders_data_dir};
use crate::scheduler::{Action, ActionOutcome};
use crate::watch_control::EngineWatchControl;
use crate::writeback::{RemoveResult, Remover};

/// Periodic safety / wall-clock reconciliation tick. Bounds how long the loop
/// ever sleeps even with a far-future (or no) armed fire, so a missed wake,
/// clock jump, or unavailable `login1` still self-heals within this interval.
/// Also doubles as the unavailable-vault backoff re-check.
const SAFETY_TICK: Duration = Duration::from_secs(30);

pub(crate) enum DaemonEvent {
    ConfigChanged,
    Vault {
        coarse: bool,
        paths: Vec<String>,
    },
    /// An OS-notification action fired (snooze / remove / open). Carries the
    /// platform notification id so an at-time `FiredNow` can replace it in place.
    Action {
        reminder_id: String,
        notification_id: u32,
        action: Action,
    },
    /// `PrepareForSleep(false)` wake edge — resume catch-up.
    Resume,
    /// A write-back worker needs the data to strike reminder `id`, read from the
    /// run-loop-owned index. `None` reply → no such reminder (already gone).
    RemoveLookup {
        id: String,
        reply: Sender<Option<RemoveTarget>>,
    },
    /// A write-back worker finished; record the outcome in the index and `ack`
    /// so the worker releases its per-note lock only after the index update
    /// (write-back rule 0).
    RemoveApply {
        id: String,
        result: RemoveResult,
        reply: Sender<()>,
    },
}

fn now_ms() -> i64 {
    Utc::now().timestamp_millis()
}

/// Run the daemon forever. Returns only on an unrecoverable setup error
/// (missing HOME, etc.) — systemd restarts us per the unit's `Restart=on-failure`.
pub fn run() -> Result<(), String> {
    let config_path = config_path()
        .ok_or_else(|| "cannot resolve config path (no HOME/XDG_CONFIG_HOME)".to_string())?;
    let data_dir = reminders_data_dir()
        .ok_or_else(|| "cannot resolve data dir (no HOME/XDG_DATA_HOME)".to_string())?;

    let (tx, rx) = mpsc::channel::<DaemonEvent>();

    // Vault watcher → DaemonEvent::Vault.
    let vault_tx = tx.clone();
    let engine = Arc::new(VaultWatchEngine::new(Arc::new(move |batch: WatchBatch| {
        let _ = vault_tx.send(DaemonEvent::Vault {
            coarse: batch.coarse,
            paths: batch.paths,
        });
    })));
    let watch = Box::new(EngineWatchControl::new(Arc::clone(&engine)));

    // OS-notification notifier (+ its action listener) and suspend/resume.
    let notifier = build_notifier(tx.clone());
    spawn_suspend_listener(tx.clone());

    // The single strikethrough writer, shared between the OS-notification
    // `remove` action path and the `RemoveReminder` D-Bus service so both honor
    // the same per-note write lock (single-writer, serialized per note).
    let remover = Arc::new(Remover::new());
    // D-Bus `dev.eskerra.Reminders1.RemoveReminder` server. Best-effort: if the
    // session bus / name is unavailable it logs and the app pane will surface a
    // transport-level `remove-unavailable` (ADR §8) — never a local write.
    let _remove_service = crate::service::spawn_remove_service(Arc::clone(&remover), tx.clone());

    let mut daemon = Daemon::new(config_path.clone(), data_dir, watch, notifier);

    // Initial config load from disk (restart-before-app-ran reconstructs purely
    // from disk; absent config → idle).
    let outcome = daemon.reload_config(now_ms());
    eprintln!("[reminderd] startup: {outcome:?}");

    // Config-file watcher (watches the config *directory* so atomic temp+rename
    // replacements are seen).
    let _config_watcher = spawn_config_watcher(&config_path, tx.clone());

    loop {
        let plan = plan_timeout(daemon.next_wakeup_ms(), now_ms());
        match rx.recv_timeout(plan.duration) {
            Ok(DaemonEvent::ConfigChanged) => {
                let outcome = daemon.reload_config(now_ms());
                eprintln!("[reminderd] config reload: {outcome:?}");
            }
            Ok(DaemonEvent::Vault { coarse, paths }) => {
                let outcome = daemon.on_watch_batch(coarse, &paths, now_ms());
                eprintln!("[reminderd] watch batch: {outcome:?}");
            }
            Ok(DaemonEvent::Action {
                reminder_id,
                notification_id,
                action,
            }) => {
                let outcome = daemon.on_action(&reminder_id, notification_id, action, now_ms());
                eprintln!("[reminderd] action {action:?} on {reminder_id}: {outcome:?}");
                handle_action_followup(reminder_id, &outcome, &remover, &tx);
            }
            Ok(DaemonEvent::Resume) => {
                let fired = daemon.on_resume(now_ms());
                eprintln!("[reminderd] resume catch-up: fired {fired}");
            }
            Ok(DaemonEvent::RemoveLookup { id, reply }) => {
                // Read-only index lookup for an off-loop write-back worker.
                let _ = reply.send(daemon.remove_target(&id));
            }
            Ok(DaemonEvent::RemoveApply { id, result, reply }) => {
                daemon.apply_remove_result(&id, result, now_ms());
                let _ = reply.send(());
            }
            Err(RecvTimeoutError::Timeout) => {
                let now = now_ms();
                // Either the next armed fire is due, or the safety tick elapsed.
                let fired = daemon.on_tick(now);
                if fired > 0 {
                    eprintln!("[reminderd] scheduler tick: fired {fired}");
                }
                if plan.kind == TimeoutKind::SafetyTick {
                    // Slow self-heal for missed config watcher events, config
                    // watcher startup failure, unavailable vaults, and failed
                    // vault-watch rearming. Only on a genuine safety tick — not
                    // merely because a scheduled wake was clamped to the cap.
                    // Unchanged config returns NoChange.
                    let outcome = daemon.reload_config(now);
                    eprintln!("[reminderd] retry tick: {outcome:?}");
                }
            }
            Err(RecvTimeoutError::Disconnected) => break, // all senders gone
        }
    }
    Ok(())
}

/// Why the run loop woke from `recv_timeout`, so it can tell a real periodic
/// reconciliation from a normal (possibly clamped) scheduled-fire sleep.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TimeoutKind {
    /// Nothing armed — the loop slept the full [`SAFETY_TICK`] as a periodic
    /// safety / wall-clock reconciliation tick. The loop reloads config after it.
    SafetyTick,
    /// The loop slept until an armed fire. The sleep is capped at [`SAFETY_TICK`],
    /// but that clamp does **not** make the wake a reconciliation tick, so config
    /// is not reloaded merely because a far-future fire was clamped to the cap.
    ScheduledWake,
}

/// How long to block in `recv_timeout`, and why.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct LoopTimeout {
    duration: Duration,
    kind: TimeoutKind,
}

/// Plan the next `recv_timeout`: sleep until the next armed fire (capped by the
/// periodic [`SAFETY_TICK`]); with nothing armed, sleep the safety tick. The
/// `kind` lets the loop reconcile config only on a genuine safety tick — not
/// when a scheduled wake merely got clamped to the 30s cap.
fn plan_timeout(next_wakeup_ms: Option<i64>, now_ms: i64) -> LoopTimeout {
    let safety_ms = SAFETY_TICK.as_millis() as i64;
    match next_wakeup_ms {
        None => LoopTimeout {
            duration: Duration::from_millis(safety_ms as u64),
            kind: TimeoutKind::SafetyTick,
        },
        Some(at) => {
            let ms = (at - now_ms).clamp(0, safety_ms);
            LoopTimeout {
                duration: Duration::from_millis(ms as u64),
                kind: TimeoutKind::ScheduledWake,
            }
        }
    }
}

/// Route an action's follow-up effect. `RemoveRequested` (Phase 4) runs the
/// strikethrough write-back **off the run loop** so the loop never holds a
/// per-note lock and removes to different notes run in parallel; `OpenRequested`
/// (Phase 5) spawns `eskerra --open-reminder <noteUri> <reminderId>` so the app
/// opens the note and places the caret after the live token.
fn handle_action_followup(
    reminder_id: String,
    outcome: &ActionOutcome,
    remover: &Arc<Remover>,
    tx: &Sender<DaemonEvent>,
) {
    match outcome {
        ActionOutcome::RemoveRequested => {
            let remover = Arc::clone(remover);
            let tx = tx.clone();
            std::thread::spawn(move || {
                let result = perform_remove(&reminder_id, &remover, &tx);
                eprintln!("[reminderd] remove (notification) {reminder_id}: {result:?}");
            });
        }
        ActionOutcome::OpenRequested { note_uri, ui_caret_hint } => {
            let mut cmd = std::process::Command::new("eskerra");
            cmd.arg("--open-reminder").arg(note_uri).arg(&reminder_id);
            if let Some(hint) = ui_caret_hint {
                cmd.arg("--ui-caret-hint").arg(hint.to_string());
            }
            match cmd.spawn() {
                Ok(_) => eprintln!("[reminderd] spawned eskerra --open-reminder for {reminder_id}"),
                Err(e) => eprintln!("[reminderd] failed to spawn eskerra for {reminder_id}: {e}"),
            }
        }
        _ => {}
    }
}

/// Run one `RemoveReminder` write-back off the run loop, shared by the
/// OS-notification `remove` action and the D-Bus `RemoveReminder` method. Asks
/// the loop for the target (index read), strikes the token under the shared
/// per-note lock, and records the outcome back in the loop-owned index (under
/// the lock, via the `record` closure — write-back rule 0). Returns the locked
/// result (`Removed` | `Stale`); a lost run loop yields `Stale` (we never write
/// blind).
pub(crate) fn perform_remove(
    id: &str,
    remover: &Remover,
    tx: &Sender<DaemonEvent>,
) -> RemoveResult {
    // 1. Resolve the target against the loop-owned index.
    let (reply_tx, reply_rx) = mpsc::channel();
    if tx
        .send(DaemonEvent::RemoveLookup {
            id: id.to_string(),
            reply: reply_tx,
        })
        .is_err()
    {
        return RemoveResult::Stale; // run loop gone → never write blind
    }
    let target = match reply_rx.recv() {
        Ok(Some(target)) => target,
        Ok(None) => return RemoveResult::Removed, // no index entry → already gone
        Err(_) => return RemoveResult::Stale,
    };

    // 2. Strike under the per-note lock; record the outcome in the index while
    //    the lock is still held.
    let apply_tx = tx.clone();
    remover.remove(
        &target.note_abs_path,
        &target.lock_key,
        &target.stored,
        move |result| {
            let (ack_tx, ack_rx) = mpsc::channel();
            if apply_tx
                .send(DaemonEvent::RemoveApply {
                    id: id.to_string(),
                    result,
                    reply: ack_tx,
                })
                .is_ok()
            {
                let _ = ack_rx.recv();
            }
        },
    )
}

/// Build the D-Bus notifier, falling back to a no-op (click-only) notifier when
/// the session bus / notification service is unavailable (ADR 003 §6).
#[cfg(target_os = "linux")]
fn build_notifier(tx: Sender<DaemonEvent>) -> Box<dyn Notifier> {
    let on_action = Box::new(move |event: crate::notify::ActionEvent| {
        let _ = tx.send(DaemonEvent::Action {
            reminder_id: event.reminder_id,
            notification_id: event.notification_id,
            action: event.action,
        });
    });
    match crate::notify::ZbusNotifier::new(on_action) {
        Ok(n) => Box::new(n),
        Err(err) => {
            eprintln!("[reminderd] notifications unavailable ({err}); falling back to click-only");
            Box::new(NullNotifier)
        }
    }
}

#[cfg(not(target_os = "linux"))]
fn build_notifier(_tx: Sender<DaemonEvent>) -> Box<dyn Notifier> {
    Box::new(NullNotifier)
}

/// Subscribe to `org.freedesktop.login1`'s `PrepareForSleep(b)` on the system
/// bus; on the `false` (waking) edge, send [`DaemonEvent::Resume`] so the daemon
/// runs resume catch-up. Best-effort: if login1 is unavailable the loop's
/// periodic [`SAFETY_TICK`] still reconciles missed fires.
#[cfg(target_os = "linux")]
fn spawn_suspend_listener(tx: Sender<DaemonEvent>) {
    use zbus::blocking::{Connection, Proxy};
    std::thread::spawn(move || {
        let conn = match Connection::system() {
            Ok(c) => c,
            Err(err) => {
                eprintln!(
                    "[reminderd] login1 unavailable ({err}); relying on periodic reconciliation"
                );
                return;
            }
        };
        let proxy = match Proxy::new(
            &conn,
            "org.freedesktop.login1",
            "/org/freedesktop/login1",
            "org.freedesktop.login1.Manager",
        ) {
            Ok(p) => p,
            Err(err) => {
                eprintln!("[reminderd] login1 proxy failed ({err})");
                return;
            }
        };
        let signals = match proxy.receive_signal("PrepareForSleep") {
            Ok(s) => s,
            Err(err) => {
                eprintln!("[reminderd] login1 PrepareForSleep subscribe failed ({err})");
                return;
            }
        };
        for msg in signals {
            // PrepareForSleep(BOOLEAN start): true = about to sleep, false = woke.
            if let Ok((start,)) = msg.body().deserialize::<(bool,)>() {
                if !start && tx.send(DaemonEvent::Resume).is_err() {
                    return; // receiver gone; daemon shutting down
                }
            }
        }
    });
}

#[cfg(not(target_os = "linux"))]
fn spawn_suspend_listener(_tx: Sender<DaemonEvent>) {}

/// Watch the config directory for changes to `reminderd.json`. Returns the
/// watcher handle (dropping it stops watching). Best-effort: if the directory
/// cannot be watched (e.g. does not exist yet), logs and returns `None`; the
/// safety tick still re-reads config periodically as a fallback.
fn spawn_config_watcher(config_path: &Path, tx: Sender<DaemonEvent>) -> Option<RecommendedWatcher> {
    let dir = config_dir()?;
    // Create the config dir so we can watch it before the app first writes.
    let _ = std::fs::create_dir_all(&dir);

    let file_name = config_path.file_name().map(|n| n.to_os_string());
    let mut watcher = match RecommendedWatcher::new(
        move |res: Result<Event, notify::Error>| {
            if let Ok(ev) = res {
                let relevant = match &file_name {
                    Some(name) => ev
                        .paths
                        .iter()
                        .any(|p| p.file_name() == Some(name.as_os_str())),
                    None => true,
                };
                if relevant {
                    let _ = tx.send(DaemonEvent::ConfigChanged);
                }
            }
        },
        NotifyConfig::default(),
    ) {
        Ok(w) => w,
        Err(err) => {
            eprintln!("[reminderd] config watcher unavailable: {err}");
            return None;
        }
    };
    if let Err(err) = watcher.watch(&dir, RecursiveMode::NonRecursive) {
        eprintln!("[reminderd] config watch start failed: {err}");
        return None;
    }
    Some(watcher)
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: i64 = 1_700_000_000_000;

    #[test]
    fn no_armed_reminder_is_a_safety_tick_that_reloads_config() {
        let plan = plan_timeout(None, NOW);
        assert_eq!(plan.kind, TimeoutKind::SafetyTick);
        assert_eq!(plan.duration, SAFETY_TICK);
    }

    #[test]
    fn armed_within_cap_is_a_scheduled_wake_no_reload() {
        // Fire 10s away (< 30s cap): sleep exactly 10s, wake to fire, no reload.
        let plan = plan_timeout(Some(NOW + 10_000), NOW);
        assert_eq!(plan.kind, TimeoutKind::ScheduledWake);
        assert_eq!(plan.duration, Duration::from_millis(10_000));
    }

    #[test]
    fn armed_beyond_cap_is_clamped_but_still_a_scheduled_wake() {
        // Fire 5 min away: sleep is clamped to the 30s cap, but the wake is a
        // scheduled wake — not a reconciliation tick — so config is not reloaded
        // merely because of the clamp.
        let plan = plan_timeout(Some(NOW + 5 * 60_000), NOW);
        assert_eq!(plan.kind, TimeoutKind::ScheduledWake);
        assert_eq!(
            plan.duration, SAFETY_TICK,
            "sleep is capped at the safety tick"
        );
    }

    #[test]
    fn overdue_armed_reminder_wakes_immediately_as_a_scheduled_wake() {
        // Past its fire time but not yet fired → wake now (0ms), still scheduled.
        let plan = plan_timeout(Some(NOW - 1_000), NOW);
        assert_eq!(plan.kind, TimeoutKind::ScheduledWake);
        assert_eq!(plan.duration, Duration::ZERO);
    }
}

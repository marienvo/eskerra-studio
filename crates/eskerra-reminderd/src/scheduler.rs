//! Pure scheduling + action logic — no threads, no D-Bus, no clock of its own
//! (the caller injects `now`). This is the testable heart of Phase 3: it
//! decides **which** reminders fire and **how** state transitions, while the
//! I/O (sending notifications, persisting the index, arming a timer) lives in
//! [`crate::daemon`] / [`crate::notify`] / [`crate::run`].
//!
//! It implements the LOCKED *Missed / grace semantics* and *Snooze action
//! handling* sections of `specs/plans/desktop-reminders-daemon-phased.md`
//! (Phase 3) and ADR 003 §6. The three evaluation contexts are kept distinct:
//!
//! - **Discovery** ([`discover`]) — classification only: scan / restart / vault
//!   switch / minute-tick. Fires the lead notification immediately for a
//!   reminder already inside its `[fireAt, dueAt)` window, marks a reminder past
//!   `dueAt` `Due` **in-app only** (no stale OS popup), and leaves future
//!   reminders armed (`Scheduled`). It never executes the post-`dueAt` grace
//!   fire.
//! - **Scheduled-fire execution** ([`run_timers`]) — a timer event for an
//!   already-armed (`Scheduled`) reminder whose `fireAt` arrived. Fires once,
//!   tolerating up to `grace` past `dueAt` (timer jitter); beyond that the fire
//!   is missed and downgraded to `Due` with no popup.
//! - **Resume catch-up** — the wake edge re-evaluates already-armed reminders
//!   with the *same* rule as [`run_timers`] (a deferred scheduled fire), so a
//!   brief suspend never silently downgrades an armed reminder; the run layer
//!   simply calls [`run_timers`] then [`discover`] on resume.
//!
//! Every fire is guarded against double-firing by `last_notified_ms`: a fire for
//! a given `fireAt` is recorded as `last_notified_ms == Some(fireAt)` and never
//! repeats for that same `fireAt` across re-arm / reconcile / resume.

use eskerra_reminder_core::{Reminder, ReminderState};

/// Tolerance for scheduled-fire execution past `dueAt`, absorbing timer wakeup
/// jitter and very brief suspends (plan: "a small bound, e.g. a few seconds").
/// A scheduled fire still pops when `now ≤ dueAt + SCHEDULER_GRACE_MS`; beyond
/// it the event is a missed fire (in-app `Due`, no stale popup).
pub const SCHEDULER_GRACE_MS: i64 = 5_000;

const MS_PER_MINUTE: i64 = 60_000;

/// Why a notification is being fired — drives the OS notification body copy
/// ("lead" reminder vs. the at-time / overdue fire).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FireKind {
    /// The configured pre-`dueAt` lead notification.
    Lead,
    /// A fire at (or, within grace, just after) `dueAt` — the snooze-0 /
    /// at-time case.
    AtTime,
}

/// A decision that the caller should send an OS notification for `reminder_id`.
/// The pure functions have already applied the matching state transition
/// (`state` / `last_notified_ms`) to the reminder before returning this, so the
/// guard holds even if the send later fails.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FireRequest {
    pub reminder_id: String,
    pub kind: FireKind,
}

/// A user action arriving from an OS notification (or the app pane, for
/// `Remove`). Snooze minutes are `3` / `1` / `0` per the locked action set.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    /// "Remind at T-3 / T-1 / at due time" → `minutes` of `3` / `1` / `0`.
    Snooze { minutes: u32 },
    /// Remove → strikethrough write-back (Phase 4). A Phase 3 stub here.
    Remove,
    /// Default click → open the note in the app (Phase 5). A Phase 3 stub here.
    Open,
}

/// Result of applying an [`Action`], surfaced for logging/observability/tests.
/// Any index persistence + (for `FiredNow`) notification send is the caller's
/// job; this only reports what the pure logic decided and already applied.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ActionOutcome {
    /// A future snooze: `fireAt` moved to `fire_at_ms` and the reminder is armed
    /// (`Scheduled`). The caller persists + re-arms; the fire happens later via
    /// [`run_timers`].
    Rescheduled { fire_at_ms: i64 },
    /// snooze-0 chosen at exactly `dueAt`: fire once now (the caller sends it).
    FiredNow,
    /// An expired relative snooze (`targetFireAt ≤ now`) or snooze-0 past
    /// `dueAt`: a no-op — no fire, no loop, no backwards move. The OS
    /// notification simply closes.
    ExpiredNoOp,
    /// `Remove` — caller routes to the Phase 4 writer.
    RemoveRequested,
    /// Default click — caller routes to the Phase 5 open path.
    OpenRequested,
    /// No reminder with that id in the active index (e.g. a stale action after a
    /// vault switch / removal) — ignored.
    Unknown,
}

/// True when `r` has already fired for its current `fireAt` (the double-fire
/// guard). A snooze moves `fireAt` to a new value, so a prior guard for the old
/// fire does not suppress the re-armed fire.
fn already_fired(r: &Reminder) -> bool {
    r.last_notified_ms == Some(r.fire_at_ms)
}

/// Discovery / classification pass (scan, restart, vault switch, minute-tick).
/// See module docs: fires the immediate lead window, marks overdue reminders
/// `Due` (no popup), leaves future reminders untouched (armed). Returns the
/// lead notifications to send. Idempotent: re-running it never re-fires (guarded
/// by `last_notified_ms`) and never downgrades an already-`Notified` reminder.
pub fn discover(reminders: &mut [Reminder], now: i64) -> Vec<FireRequest> {
    let mut fires = Vec::new();
    for r in reminders.iter_mut() {
        if r.state == ReminderState::Stale {
            continue;
        }
        if now < r.fire_at_ms {
            // Future → armed. Leave the state as-is so a carried `Notified`
            // (e.g. across a restart while still before the new fire) survives.
            continue;
        }
        if already_fired(r) {
            continue;
        }
        if now < r.due_at_ms {
            // fireAt ≤ now < dueAt → the daemon was off through the lead
            // interval but it is still before due → fire the lead once.
            r.state = ReminderState::Notified;
            r.last_notified_ms = Some(r.fire_at_ms);
            fires.push(FireRequest { reminder_id: r.id.clone(), kind: FireKind::Lead });
        } else {
            // now ≥ dueAt, first discovered overdue → in-app only, no popup.
            r.state = ReminderState::Due;
        }
    }
    fires
}

/// Scheduled-fire execution (and resume catch-up): fire armed (`Scheduled`)
/// reminders whose `fireAt` has arrived, tolerating up to `grace` past `dueAt`.
/// Beyond the grace window the fire is missed → `Due`, no popup. Only acts on
/// `Scheduled` reminders, so a reminder already marked `Due` by [`discover`]
/// (overdue at first sight) is never resurrected into a stale popup here.
pub fn run_timers(reminders: &mut [Reminder], now: i64, grace: i64) -> Vec<FireRequest> {
    let mut fires = Vec::new();
    for r in reminders.iter_mut() {
        if r.state != ReminderState::Scheduled {
            continue;
        }
        if already_fired(r) || now < r.fire_at_ms {
            continue;
        }
        if now <= r.due_at_ms + grace {
            r.state = ReminderState::Notified;
            r.last_notified_ms = Some(r.fire_at_ms);
            let kind = if r.fire_at_ms >= r.due_at_ms {
                FireKind::AtTime
            } else {
                FireKind::Lead
            };
            fires.push(FireRequest { reminder_id: r.id.clone(), kind });
        } else {
            r.state = ReminderState::Due;
        }
    }
    fires
}

/// The earliest future instant the scheduler must wake to act on, or `None` if
/// nothing is armed. The caller sleeps until then (capped by its own periodic
/// safety tick). Only armed (`Scheduled`, not-yet-fired) reminders contribute;
/// an already-overdue armed reminder returns `now` so the caller runs a timer
/// pass immediately.
pub fn next_wakeup_ms(reminders: &[Reminder], now: i64) -> Option<i64> {
    let mut next: Option<i64> = None;
    for r in reminders {
        if r.state != ReminderState::Scheduled || already_fired(r) {
            continue;
        }
        let at = r.fire_at_ms.max(now);
        next = Some(next.map_or(at, |n| n.min(at)));
    }
    next
}

/// Apply a user [`Action`] to the reminder with `reminder_id`. Returns the
/// [`ActionOutcome`]; the reminder's fields are already mutated where the rules
/// require it. The caller persists the index, and for [`ActionOutcome::FiredNow`]
/// sends the at-time notification.
pub fn apply_action(
    reminders: &mut [Reminder],
    reminder_id: &str,
    action: Action,
    now: i64,
) -> ActionOutcome {
    let Some(r) = reminders.iter_mut().find(|r| r.id == reminder_id) else {
        return ActionOutcome::Unknown;
    };
    match action {
        Action::Remove => ActionOutcome::RemoveRequested,
        Action::Open => ActionOutcome::OpenRequested,
        Action::Snooze { minutes } => apply_snooze(r, minutes, now),
    }
}

/// Snooze rules (plan §*Snooze action handling (including expired snooze)*).
/// The two relative snoozes (3 / 1) and the at-time snooze (0) have distinct
/// behavior at the `now == dueAt` boundary, so snooze-0 is handled separately.
fn apply_snooze(r: &mut Reminder, minutes: u32, now: i64) -> ActionOutcome {
    // Never act on a stale reminder (it must stay visible + non-firing).
    if r.state == ReminderState::Stale {
        return ActionOutcome::ExpiredNoOp;
    }

    if minutes == 0 {
        // snooze-0: target is exactly `dueAt`.
        use std::cmp::Ordering::*;
        match now.cmp(&r.due_at_ms) {
            // Before due → schedule the at-time fire (fires later at dueAt).
            Less => {
                reschedule(r, r.due_at_ms);
                ActionOutcome::Rescheduled { fire_at_ms: r.due_at_ms }
            }
            // Exactly at due → fire once now (NOT a no-op), guarded so a second
            // snooze-0 at the same instant cannot double-fire.
            Equal => {
                r.fire_at_ms = r.due_at_ms;
                if already_fired(r) {
                    ActionOutcome::ExpiredNoOp
                } else {
                    r.last_notified_ms = Some(r.due_at_ms);
                    r.state = ReminderState::Notified;
                    ActionOutcome::FiredNow
                }
            }
            // Past due → genuinely missed: no stale popup, keep `Due` in-app.
            Greater => {
                r.state = ReminderState::Due;
                ActionOutcome::ExpiredNoOp
            }
        }
    } else {
        // snooze-3 / snooze-1: target is `dueAt − N min`.
        let target = r.due_at_ms - i64::from(minutes) * MS_PER_MINUTE;
        if target > now {
            reschedule(r, target);
            ActionOutcome::Rescheduled { fire_at_ms: target }
        } else {
            // Expired relative snooze: no fire, no loop, no backwards move;
            // the reminder keeps its current state (only the OS popup closes).
            ActionOutcome::ExpiredNoOp
        }
    }
}

/// Arm a (re-)scheduled fire at `fire_at`, preserving the prior-fire guard so a
/// re-arm is not falsely suppressed. The guard is cleared only when it would
/// otherwise equal the new `fire_at` (re-snoozing back onto an already-fired
/// instant), so the freshly armed fire is allowed to fire.
fn reschedule(r: &mut Reminder, fire_at: i64) {
    r.fire_at_ms = fire_at;
    r.state = ReminderState::Scheduled;
    if r.last_notified_ms == Some(fire_at) {
        r.last_notified_ms = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use eskerra_reminder_core::{fresh_reminder_from_scan, scan, DefaultTime};

    const LEAD_MINUTES: u32 = 5;

    /// Build a single reminder from a token, then override its absolute times so
    /// tests can position `now` precisely relative to `fireAt` / `dueAt` without
    /// caring about the calendar. `due_at_ms` is set to `due`, `fire_at_ms` to
    /// `due - LEAD`.
    fn reminder_at(due: i64) -> Reminder {
        let out = scan(b"task @2026-06-06_0900 here").expect("utf8");
        let token = out.tokens.into_iter().next().unwrap();
        let mut r = fresh_reminder_from_scan(
            "notes/n.md",
            "file:///n.md",
            &token,
            &out.scan_fingerprint,
            DefaultTime::DEFAULT_NINE_AM,
            LEAD_MINUTES,
        )
        .unwrap();
        r.due_at_ms = due;
        r.fire_at_ms = due - i64::from(LEAD_MINUTES) * MS_PER_MINUTE;
        r.state = ReminderState::Scheduled;
        r.last_notified_ms = None;
        r
    }

    const DUE: i64 = 1_000_000_000;
    const LEAD_MS: i64 = LEAD_MINUTES as i64 * MS_PER_MINUTE;
    const FIRE: i64 = DUE - LEAD_MS;

    // --- discovery ---------------------------------------------------------

    #[test]
    fn discovery_future_reminder_stays_armed_no_fire() {
        let mut rs = vec![reminder_at(DUE)];
        let fires = discover(&mut rs, FIRE - 1);
        assert!(fires.is_empty());
        assert_eq!(rs[0].state, ReminderState::Scheduled);
        assert_eq!(rs[0].last_notified_ms, None);
    }

    #[test]
    fn discovery_inside_lead_window_fires_once() {
        let mut rs = vec![reminder_at(DUE)];
        let fires = discover(&mut rs, FIRE + 1);
        assert_eq!(fires.len(), 1);
        assert_eq!(fires[0].kind, FireKind::Lead);
        assert_eq!(rs[0].state, ReminderState::Notified);
        assert_eq!(rs[0].last_notified_ms, Some(FIRE));
        // Re-running discovery does not re-fire (guarded).
        assert!(discover(&mut rs, FIRE + 2).is_empty());
    }

    #[test]
    fn discovery_overdue_marks_due_without_popup() {
        let mut rs = vec![reminder_at(DUE)];
        let fires = discover(&mut rs, DUE + 60_000);
        assert!(fires.is_empty(), "overdue discovery must not pop a stale notification");
        assert_eq!(rs[0].state, ReminderState::Due);
        assert_eq!(rs[0].last_notified_ms, None);
    }

    #[test]
    fn discovery_skips_stale() {
        let mut rs = vec![reminder_at(DUE)];
        rs[0].state = ReminderState::Stale;
        let fires = discover(&mut rs, DUE + 60_000);
        assert!(fires.is_empty());
        assert_eq!(rs[0].state, ReminderState::Stale);
    }

    // --- scheduled-fire execution -----------------------------------------

    #[test]
    fn timer_fires_armed_reminder_at_fire_time() {
        let mut rs = vec![reminder_at(DUE)];
        let fires = run_timers(&mut rs, FIRE, SCHEDULER_GRACE_MS);
        assert_eq!(fires.len(), 1);
        assert_eq!(fires[0].kind, FireKind::Lead);
        assert_eq!(rs[0].state, ReminderState::Notified);
        assert_eq!(rs[0].last_notified_ms, Some(FIRE));
    }

    #[test]
    fn timer_within_grace_past_due_still_fires() {
        let mut rs = vec![reminder_at(DUE)];
        // Snooze-0 style: fire_at == due. A few seconds late but within grace.
        rs[0].fire_at_ms = DUE;
        let fires = run_timers(&mut rs, DUE + SCHEDULER_GRACE_MS, SCHEDULER_GRACE_MS);
        assert_eq!(fires.len(), 1);
        assert_eq!(fires[0].kind, FireKind::AtTime);
    }

    #[test]
    fn timer_beyond_grace_is_missed_no_popup() {
        let mut rs = vec![reminder_at(DUE)];
        let fires = run_timers(&mut rs, DUE + SCHEDULER_GRACE_MS + 1, SCHEDULER_GRACE_MS);
        assert!(fires.is_empty());
        assert_eq!(rs[0].state, ReminderState::Due);
    }

    #[test]
    fn timer_ignores_non_scheduled() {
        let mut rs = vec![reminder_at(DUE)];
        rs[0].state = ReminderState::Due;
        assert!(run_timers(&mut rs, FIRE, SCHEDULER_GRACE_MS).is_empty());
    }

    // --- next wakeup -------------------------------------------------------

    #[test]
    fn next_wakeup_is_fire_time_for_future_and_now_for_overdue() {
        let mut rs = vec![reminder_at(DUE)];
        assert_eq!(next_wakeup_ms(&rs, FIRE - 100), Some(FIRE));
        // Already past fire but not fired → wake immediately.
        assert_eq!(next_wakeup_ms(&rs, FIRE + 100), Some(FIRE + 100));
        // Once fired, it no longer contributes.
        rs[0].last_notified_ms = Some(FIRE);
        rs[0].state = ReminderState::Notified;
        assert_eq!(next_wakeup_ms(&rs, FIRE + 100), None);
    }

    // --- snooze: future relative schedules --------------------------------

    #[test]
    fn snooze_3_future_persists_and_arms_one_fire() {
        let mut rs = vec![reminder_at(DUE)];
        // Notified at baseline lead, user snoozes before dueAt-3min.
        rs[0].state = ReminderState::Notified;
        rs[0].last_notified_ms = Some(FIRE);
        let now = DUE - 4 * MS_PER_MINUTE; // before dueAt-3min
        let out = apply_action(&mut rs, &rid(), Action::Snooze { minutes: 3 }, now);
        assert_eq!(out, ActionOutcome::Rescheduled { fire_at_ms: DUE - 3 * MS_PER_MINUTE });
        assert_eq!(rs[0].state, ReminderState::Scheduled);
        assert_eq!(rs[0].fire_at_ms, DUE - 3 * MS_PER_MINUTE);
        // Exactly one armed fire scheduled.
        assert_eq!(next_wakeup_ms(&rs, now), Some(DUE - 3 * MS_PER_MINUTE));
        // That fire later executes once.
        let fires = run_timers(&mut rs, DUE - 3 * MS_PER_MINUTE, SCHEDULER_GRACE_MS);
        assert_eq!(fires.len(), 1);
    }

    #[test]
    fn snooze_1_future_persists_and_arms() {
        let mut rs = vec![reminder_at(DUE)];
        let now = DUE - 5 * MS_PER_MINUTE;
        let out = apply_action(&mut rs, &rid(), Action::Snooze { minutes: 1 }, now);
        assert_eq!(out, ActionOutcome::Rescheduled { fire_at_ms: DUE - MS_PER_MINUTE });
        assert_eq!(rs[0].fire_at_ms, DUE - MS_PER_MINUTE);
    }

    // --- snooze: expired relative no-ops ----------------------------------

    #[test]
    fn snooze_3_expired_is_noop() {
        let mut rs = vec![reminder_at(DUE)];
        rs[0].state = ReminderState::Notified;
        rs[0].last_notified_ms = Some(FIRE);
        let before = rs[0].clone();
        let now = DUE - 2 * MS_PER_MINUTE; // already past dueAt-3min
        let out = apply_action(&mut rs, &rid(), Action::Snooze { minutes: 3 }, now);
        assert_eq!(out, ActionOutcome::ExpiredNoOp);
        // No fire, no backwards move, state unchanged.
        assert_eq!(rs[0], before);
        assert!(run_timers(&mut rs, now, SCHEDULER_GRACE_MS).is_empty());
    }

    #[test]
    fn snooze_1_expired_is_noop() {
        let mut rs = vec![reminder_at(DUE)];
        rs[0].state = ReminderState::Notified;
        rs[0].last_notified_ms = Some(FIRE);
        let before = rs[0].clone();
        let now = DUE - 30_000; // past dueAt-1min (30s before due)
        let out = apply_action(&mut rs, &rid(), Action::Snooze { minutes: 1 }, now);
        assert_eq!(out, ActionOutcome::ExpiredNoOp);
        assert_eq!(rs[0], before);
    }

    // --- snooze-0 boundary ------------------------------------------------

    #[test]
    fn snooze_0_before_due_schedules_at_time() {
        let mut rs = vec![reminder_at(DUE)];
        rs[0].state = ReminderState::Notified;
        rs[0].last_notified_ms = Some(FIRE);
        let now = DUE - MS_PER_MINUTE;
        let out = apply_action(&mut rs, &rid(), Action::Snooze { minutes: 0 }, now);
        assert_eq!(out, ActionOutcome::Rescheduled { fire_at_ms: DUE });
        assert_eq!(rs[0].fire_at_ms, DUE);
        assert_eq!(rs[0].state, ReminderState::Scheduled);
        // Fires once exactly at dueAt via the at-time scheduled-fire path.
        let fires = run_timers(&mut rs, DUE, SCHEDULER_GRACE_MS);
        assert_eq!(fires.len(), 1);
        assert_eq!(fires[0].kind, FireKind::AtTime);
    }

    #[test]
    fn snooze_0_at_exactly_due_fires_once_not_noop() {
        let mut rs = vec![reminder_at(DUE)];
        rs[0].state = ReminderState::Notified;
        rs[0].last_notified_ms = Some(FIRE); // fired the lead earlier
        let out = apply_action(&mut rs, &rid(), Action::Snooze { minutes: 0 }, DUE);
        assert_eq!(out, ActionOutcome::FiredNow);
        assert_eq!(rs[0].last_notified_ms, Some(DUE));
        assert_eq!(rs[0].state, ReminderState::Notified);
        // A second snooze-0 at the same instant does not double-fire.
        let again = apply_action(&mut rs, &rid(), Action::Snooze { minutes: 0 }, DUE);
        assert_eq!(again, ActionOutcome::ExpiredNoOp);
    }

    #[test]
    fn snooze_0_after_due_is_expired_noop() {
        let mut rs = vec![reminder_at(DUE)];
        rs[0].state = ReminderState::Notified;
        rs[0].last_notified_ms = Some(FIRE);
        let now = DUE + MS_PER_MINUTE;
        let out = apply_action(&mut rs, &rid(), Action::Snooze { minutes: 0 }, now);
        assert_eq!(out, ActionOutcome::ExpiredNoOp);
        assert_eq!(rs[0].state, ReminderState::Due, "due in-app only, no popup");
        // No fire results from re-evaluating after the expired snooze-0.
        assert!(run_timers(&mut rs, now, SCHEDULER_GRACE_MS).is_empty());
    }

    // --- no immediate-notification loop -----------------------------------

    #[test]
    fn repeated_expired_snooze_never_produces_a_second_notification() {
        let mut rs = vec![reminder_at(DUE)];
        rs[0].state = ReminderState::Notified;
        rs[0].last_notified_ms = Some(FIRE);
        let id = rid();
        // Repeatedly choose an expired relative snooze and an expired snooze-0.
        // All instants are past `dueAt`, so both the relative snooze (target
        // `dueAt − 1min`) and snooze-0 (`> dueAt`) are genuinely expired.
        for now in [DUE + 1, DUE + 10_000, DUE + 60_000] {
            let out = apply_action(&mut rs, &id, Action::Snooze { minutes: 1 }, now);
            assert!(matches!(out, ActionOutcome::ExpiredNoOp));
            let out0 = apply_action(&mut rs, &id, Action::Snooze { minutes: 0 }, now);
            assert!(matches!(out0, ActionOutcome::ExpiredNoOp));
            // Re-evaluation never queues a fresh fire.
            assert!(run_timers(&mut rs, now, SCHEDULER_GRACE_MS).is_empty());
            assert!(discover(&mut rs, now).is_empty());
        }
    }

    // --- remove / open stubs ----------------------------------------------

    #[test]
    fn remove_and_open_are_routed_outcomes() {
        let mut rs = vec![reminder_at(DUE)];
        let id = rid();
        assert_eq!(apply_action(&mut rs, &id, Action::Remove, DUE), ActionOutcome::RemoveRequested);
        assert_eq!(apply_action(&mut rs, &id, Action::Open, DUE), ActionOutcome::OpenRequested);
    }

    #[test]
    fn unknown_id_is_ignored() {
        let mut rs = vec![reminder_at(DUE)];
        let out = apply_action(&mut rs, "no-such-id", Action::Snooze { minutes: 3 }, DUE);
        assert_eq!(out, ActionOutcome::Unknown);
    }

    #[test]
    fn snooze_never_acts_on_stale() {
        let mut rs = vec![reminder_at(DUE)];
        rs[0].state = ReminderState::Stale;
        let before = rs[0].clone();
        let out = apply_action(&mut rs, &rid(), Action::Snooze { minutes: 3 }, DUE - 10 * MS_PER_MINUTE);
        assert_eq!(out, ActionOutcome::ExpiredNoOp);
        assert_eq!(rs[0], before);
    }

    /// The stable id `reminder_at` always produces (identity ignores times), so
    /// tests can name the target without borrowing the `&mut` reminder slice.
    fn rid() -> String {
        reminder_at(0).id.clone()
    }
}

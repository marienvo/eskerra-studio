//! Settings-only config change: re-derive `dueAtMs`/`fireAtMs` for **date-only**
//! `@YYYY-MM-DD` tokens when the date-only default time (or lead) changes,
//! **without** a vault switch (no session bump, no index teardown). Rules are
//! LOCKED in the plan's *Settings-only config change* section and ADR §5.
//!
//! Key invariants this enforces:
//! - **Identity is preserved.** `id` is path + normalized token text + ordinal —
//!   none depend on the default time — so the same date-only reminder keeps its
//!   `id` and merges cleanly; only its times/state change.
//! - **The new times are a schedule change.** The mutable notification state is
//!   reset (`state → scheduled`, `lastNotifiedMs → None`) so a prior `notified`
//!   for the *old* time can never suppress the new fire.
//! - **Explicit timed `@…_HHMM` tokens are untouched** — their `dueAt` comes from
//!   the token itself, so no spurious re-fire.

use eskerra_reminder_core::{
    parse_date_token, resolve_due_at_ms, DefaultTime, Reminder, ReminderState,
};

/// Re-derive every date-only reminder in `index_reminders` in place against the
/// new default time + lead. Returns the number of reminders re-derived (for
/// observability). Timed tokens are left exactly as-is.
pub fn rederive_date_only(
    reminders: &mut [Reminder],
    new_default_time: DefaultTime,
    lead_minutes: u32,
) -> usize {
    let mut changed = 0;
    for reminder in reminders.iter_mut() {
        let Some(value) = parse_date_token(&reminder.normalized_token_text) else {
            continue;
        };
        // Date-only tokens are exactly those with no explicit time component.
        if value.time.is_some() {
            continue;
        }
        let Some(due_at_ms) = resolve_due_at_ms(value, new_default_time) else {
            continue;
        };
        let fire_at_ms = due_at_ms - i64::from(lead_minutes) * 60_000;

        reminder.due_at_ms = due_at_ms;
        reminder.fire_at_ms = fire_at_ms;
        // Treat the new times as a schedule change: reset notification state so
        // an old `notified`/`lastNotifiedMs` cannot suppress the new fire.
        reminder.state = ReminderState::Scheduled;
        reminder.last_notified_ms = None;
        changed += 1;
    }
    changed
}

#[cfg(test)]
mod tests {
    use super::*;
    use eskerra_reminder_core::{fresh_reminder_from_scan, scan};

    fn reminder_from(bytes: &[u8], default_time: DefaultTime, lead: u32) -> Reminder {
        let out = scan(bytes).unwrap();
        let token = out.tokens.into_iter().next().unwrap();
        fresh_reminder_from_scan("notes/n.md", "file:///n.md", &token, &out.scan_fingerprint, default_time, lead)
            .unwrap()
    }

    #[test]
    fn rederives_date_only_keeps_id_resets_state_and_times() {
        let mut date_only = reminder_from(b"@2026-06-06", DefaultTime::new(9, 0).unwrap(), 5);
        // Simulate having fired at the old 09:00.
        date_only.state = ReminderState::Notified;
        date_only.last_notified_ms = Some(date_only.fire_at_ms);
        let id_before = date_only.id.clone();
        let due_before = date_only.due_at_ms;

        let mut list = vec![date_only];
        let changed = rederive_date_only(&mut list, DefaultTime::new(8, 0).unwrap(), 5);

        assert_eq!(changed, 1);
        let r = &list[0];
        assert_eq!(r.id, id_before, "identity must not change on a settings-only re-derive");
        assert_eq!(due_before - r.due_at_ms, 60 * 60 * 1000, "08:00 is one hour earlier than 09:00");
        assert_eq!(r.due_at_ms - r.fire_at_ms, 5 * 60_000);
        assert_eq!(r.state, ReminderState::Scheduled, "stale notified state must be reset");
        assert_eq!(r.last_notified_ms, None);
    }

    #[test]
    fn leaves_timed_tokens_untouched() {
        let timed = reminder_from(b"@2026-06-06_2330", DefaultTime::new(9, 0).unwrap(), 5);
        let before = timed.clone();

        let mut list = vec![timed];
        let changed = rederive_date_only(&mut list, DefaultTime::new(8, 0).unwrap(), 5);

        assert_eq!(changed, 0, "timed tokens are not date-only");
        assert_eq!(list[0], before, "timed reminder unchanged across default-time change");
    }
}

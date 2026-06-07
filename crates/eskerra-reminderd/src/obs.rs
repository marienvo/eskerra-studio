//! Structured observability for `eskerra-reminderd` (Phase 7).
//!
//! The daemon is a deliberately slim, headless process that excludes the
//! Tauri/Sentry dependency graph (ADR 003 §2), so it cannot push to Sentry the
//! way the app does. Instead it writes **one structured line per event** to
//! stderr — captured by systemd journald — mirroring the app's Sentry
//! discipline: a **stable event name** (the alerting/grep key) plus **non-PII**
//! `key=value` tags (vault identity is always the hash, never a path). A
//! journald → Sentry/Loki shipper can alert on these names; the field contract
//! is the runbook `specs/observability/desktop-reminderd.md`.
//!
//! Keep this dependency-free and side-effect-light: [`format_event`] is a pure
//! formatter (unit-tested), and [`emit`] is the thin stderr sink so production
//! wiring and tests share the exact same line format.

/// Stable event names. These are the alerting/grep keys — never rename one
/// without updating `specs/observability/desktop-reminderd.md` and any alert
/// rules built on it.
pub mod event {
    /// A full or incremental vault scan finished (carries `duration_ms`,
    /// `reminder_count`, `full`, `coarse`).
    pub const SCAN_COMPLETED: &str = "eskerra.reminderd.scan_completed";
    /// A single OS notification send attempt resolved (`result=ok|error`).
    pub const NOTIFICATION_SEND: &str = "eskerra.reminderd.notification_send";
    /// A D-Bus subsystem the daemon depends on is unavailable
    /// (`subsystem=notifications|login1`), so a degraded fallback is in effect.
    pub const DBUS_UNAVAILABLE: &str = "eskerra.reminderd.dbus_unavailable";
    /// A `RemoveReminder` write-back resolved on the daemon side
    /// (`result=removed|stale`). The transport-failure / `remove-unavailable`
    /// rate is an **app-side** signal (the daemon never sees that call).
    pub const REMOVE_RESULT: &str = "eskerra.reminderd.remove_result";
    /// A watch batch arrived **coarse** (the precise backend dropped events),
    /// forcing a full rescan — the daemon mirror of the app's
    /// `vault_watch_coarse_invalidation` degradation signal.
    pub const WATCH_COARSE_INVALIDATION: &str = "eskerra.reminderd.watch_coarse_invalidation";
}

/// Sanitize a tag value so a stray space/newline can never break the
/// single-line-per-event contract log shippers rely on. Whitespace collapses to
/// `_`; everything else is preserved (values are already non-PII identifiers,
/// counts, or fixed enum strings).
fn sanitize(value: &str) -> String {
    value
        .chars()
        .map(|c| if c.is_whitespace() { '_' } else { c })
        .collect()
}

/// Format one structured observability line: `obs_event=<name> k=v k=v …`.
/// Pure and allocation-only so tests assert the exact wire format the runbook
/// documents.
pub fn format_event(event: &str, tags: &[(&str, &str)]) -> String {
    let mut line = format!("obs_event={event}");
    for (key, value) in tags {
        line.push(' ');
        line.push_str(key);
        line.push('=');
        line.push_str(&sanitize(value));
    }
    line
}

/// Emit one structured observability event to stderr (journald). The single
/// production sink, so every call site shares [`format_event`]'s wire format.
pub fn emit(event: &str, tags: &[(&str, &str)]) {
    eprintln!("{}", format_event(event, tags));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn format_event_emits_stable_name_then_tags() {
        let line = format_event(
            event::SCAN_COMPLETED,
            &[("vault_hash", "abc123"), ("reminder_count", "4"), ("full", "true")],
        );
        assert_eq!(
            line,
            "obs_event=eskerra.reminderd.scan_completed vault_hash=abc123 reminder_count=4 full=true"
        );
    }

    #[test]
    fn format_event_with_no_tags_is_just_the_name() {
        assert_eq!(
            format_event(event::DBUS_UNAVAILABLE, &[]),
            "obs_event=eskerra.reminderd.dbus_unavailable"
        );
    }

    #[test]
    fn tag_values_are_sanitized_to_keep_one_line_per_event() {
        // A value carrying whitespace (e.g. an error string) must not split the
        // line or inject a fake tag boundary.
        let line = format_event(
            event::DBUS_UNAVAILABLE,
            &[("subsystem", "notifications"), ("error", "name has\nnewline")],
        );
        assert_eq!(
            line,
            "obs_event=eskerra.reminderd.dbus_unavailable subsystem=notifications error=name_has_newline"
        );
        assert_eq!(line.lines().count(), 1);
    }
}

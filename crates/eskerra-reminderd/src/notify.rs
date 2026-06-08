//! OS notification I/O: the [`Notifier`] abstraction the daemon fires through,
//! plus the real [`ZbusNotifier`] backed by native `org.freedesktop.Notifications`
//! over D-Bus (`zbus` blocking API) with action buttons + callbacks, and a
//! [`NullNotifier`] fallback used when the session bus / notification service is
//! unavailable (ADR 003 §6: "fall back to click-only … and log").
//!
//! The trait keeps [`crate::daemon`] testable without a live GNOME: tests inject
//! a recording fake and assert which reminders were notified.
//!
//! `zbus`'s API is version-sensitive; this targets `zbus` 5.x (verified against
//! the 5.15 blocking `Proxy` docs: `Proxy::new`, `Proxy::call`,
//! `Proxy::receive_signal` → blocking `SignalIterator`, `Message::body()` →
//! `Body::deserialize::<T>()`).

use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;

use chrono::{Local, TimeZone};
use eskerra_reminder_core::Reminder;

use crate::scheduler::{Action, FireKind};

/// Action key strings exchanged over the `org.freedesktop.Notifications`
/// protocol (the flat `actions` array is `[key, label, key, label, …]`). These
/// keys are the wire contract between the notification we send and the
/// `ActionInvoked` signal we receive, so they are defined once here.
pub const ACTION_SNOOZE_3: &str = "snooze-3";
pub const ACTION_SNOOZE_1: &str = "snooze-1";
pub const ACTION_SNOOZE_0: &str = "snooze-0";
pub const ACTION_REMOVE: &str = "remove";
/// The freedesktop "default" action — invoked by a plain click on the body.
pub const ACTION_DEFAULT: &str = "default";
/// Themeable Freedesktop sound name GNOME should play when a reminder
/// notification pops up. Notification servers may ignore this hint.
pub const REMINDER_SOUND_NAME: &str = "alarm-clock-elapsed";

/// Map an `ActionInvoked` key back to a scheduler [`Action`]. Unknown keys
/// (forward-compat) yield `None` and are ignored by the caller.
pub fn parse_action_key(key: &str) -> Option<Action> {
    match key {
        ACTION_SNOOZE_3 => Some(Action::Snooze { minutes: 3 }),
        ACTION_SNOOZE_1 => Some(Action::Snooze { minutes: 1 }),
        ACTION_SNOOZE_0 => Some(Action::Snooze { minutes: 0 }),
        ACTION_REMOVE => Some(Action::Remove),
        ACTION_DEFAULT => Some(Action::Open),
        _ => None,
    }
}

/// A resolved request to show one OS notification for a reminder.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NotificationRequest {
    /// The reminder this notification represents — echoed back through the
    /// action map so an `ActionInvoked` can be routed to the right reminder.
    pub reminder_id: String,
    pub summary: String,
    pub body: String,
    /// Platform notification id to replace, or `0` for a fresh notification.
    /// Set when an action (e.g. snooze-0 at exactly due → `FiredNow`) must
    /// atomically replace the triggering notification rather than spawn a
    /// duplicate live notification for the same reminder.
    pub replaces_id: u32,
    /// Optional Freedesktop `sound-name` hint. This is best-effort: the
    /// notification server, user sound settings, mute state, or Do Not Disturb
    /// may suppress it.
    pub sound_name: Option<String>,
}

impl NotificationRequest {
    /// Build the notification copy for a reminder fire. `summary` is the note
    /// title (file stem), `body` is the reminder line + `(HH:MM)` in local
    /// time. Both Lead and AtTime fires use the same body shape. When
    /// `display_line` is empty (the line was only the token), the time moves
    /// onto the title instead so there is no bare `(HH:MM)` second line.
    /// Defaults to a fresh notification (`replaces_id = 0`); use
    /// [`Self::replacing`] to supersede an existing one.
    pub fn for_reminder(reminder: &Reminder, _kind: FireKind, vault_root: &Path) -> Self {
        let title = note_title_for(&reminder.vault_relative_path, vault_root);
        let hhmm = hhmm_local(reminder.due_at_ms);
        if reminder.display_line.is_empty() {
            Self {
                reminder_id: reminder.id.clone(),
                summary: format!("{title} ({hhmm})"),
                body: String::new(),
                replaces_id: 0,
                sound_name: Some(REMINDER_SOUND_NAME.to_string()),
            }
        } else {
            Self {
                reminder_id: reminder.id.clone(),
                summary: title,
                body: format!("{} ({})", reminder.display_line, hhmm),
                replaces_id: 0,
                sound_name: Some(REMINDER_SOUND_NAME.to_string()),
            }
        }
    }

    /// Mark this request as replacing the notification with id `replaces_id`
    /// (the platform replaces it in place when non-zero).
    pub fn replacing(mut self, replaces_id: u32) -> Self {
        self.replaces_id = replaces_id;
        self
    }

    /// The outgoing action set + labels for a reminder notification, in display
    /// order, as `(key, label)` pairs. GNOME Shell caps visible buttons at 3,
    /// so snooze-3 is dropped from the outgoing set to ensure Remove is always
    /// visible. `parse_action_key` still accepts `snooze-3` for
    /// backward-compat with lingering old popups.
    pub fn actions() -> [(&'static str, &'static str); 3] {
        [
            (ACTION_SNOOZE_1, "Remind 1 min before"),
            (ACTION_SNOOZE_0, "Remind at due time"),
            (ACTION_REMOVE, "Remove"),
        ]
    }
}

/// Render `due_at_ms` (epoch milliseconds) as local `HH:MM` (24-hour).
fn hhmm_local(due_at_ms: i64) -> String {
    Local
        .timestamp_millis_opt(due_at_ms)
        .single()
        .map(|dt| dt.format("%H:%M").to_string())
        .unwrap_or_else(|| "??:??".to_string())
}

/// Note title = the file stem of the vault-relative path (drop directories and
/// the `.md` extension), falling back to the full path if there is no stem.
fn note_title(vault_relative_path: &str) -> String {
    let last = vault_relative_path
        .rsplit('/')
        .next()
        .unwrap_or(vault_relative_path);
    last.strip_suffix(".md").unwrap_or(last).to_string()
}

/// Notification title: the hub's folder name when the reminder lives in a Today
/// Hub note (`Today.md`) or cell (a `YYYY-MM-DD.md` row beside it), otherwise
/// the note stem. Mirrors the desktop `todayHubRowTitleForNoteUri`.
fn note_title_for(vault_relative_path: &str, vault_root: &Path) -> String {
    today_hub_title(vault_relative_path, vault_root)
        .unwrap_or_else(|| note_title(vault_relative_path))
}

/// `true` for a `YYYY-MM-DD` stem (shape only; the sibling `Today.md` is the real gate).
fn is_today_hub_row_stem(stem: &str) -> bool {
    let b = stem.as_bytes();
    b.len() == 10
        && b[4] == b'-'
        && b[7] == b'-'
        && b[..4].iter().all(u8::is_ascii_digit)
        && b[5..7].iter().all(u8::is_ascii_digit)
        && b[8..].iter().all(u8::is_ascii_digit)
}

/// Hub folder name for a `Today.md` or sibling `YYYY-MM-DD.md` row, else `None`.
fn today_hub_title(vault_relative_path: &str, vault_root: &Path) -> Option<String> {
    let file = vault_relative_path
        .rsplit('/')
        .next()
        .unwrap_or(vault_relative_path);
    let dir = vault_relative_path
        .strip_suffix(file)?
        .trim_end_matches('/');
    if dir.is_empty() {
        return None;
    }
    if file == "Today.md" {
        return vault_root
            .join(vault_relative_path)
            .is_file()
            .then(|| hub_folder_title(dir));
    }
    let stem = file.strip_suffix(".md")?;
    if !is_today_hub_row_stem(stem) {
        return None;
    }
    if !vault_root.join(dir).join("Today.md").is_file() {
        return None;
    }
    Some(hub_folder_title(dir))
}

fn hub_folder_title(dir: &str) -> String {
    dir.rsplit('/').next().unwrap_or(dir).to_string()
}

/// Abstraction over the OS notification service so the daemon's firing logic is
/// unit-testable without a live D-Bus / GNOME. `Send` because the daemon holds
/// it across the run loop's threads.
pub trait Notifier: Send {
    /// Show a notification. Returns the platform notification id on success (for
    /// later correlation), or an error string for observability/logging. A
    /// failure must never panic or abort the daemon.
    fn send(&self, req: &NotificationRequest) -> Result<u32, String>;
}

/// No-op notifier: records nothing, sends nothing. Used as the fallback when the
/// session bus or notification service cannot be reached, so the rest of the
/// daemon (index production, scheduling state, IPC) keeps working "click-only".
pub struct NullNotifier;

impl Notifier for NullNotifier {
    fn send(&self, req: &NotificationRequest) -> Result<u32, String> {
        eprintln!(
            "[reminderd] (no notifier) would notify: {} — {}",
            req.summary, req.body
        );
        Ok(0)
    }
}

/// An OS-notification action that has been routed back to its reminder. Carries
/// the notification id alongside the reminder id and decoded [`Action`] so the
/// daemon can, for an at-time `FiredNow`, replace the triggering notification in
/// place instead of opening a duplicate.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ActionEvent {
    pub reminder_id: String,
    /// The platform notification id the action came from.
    pub notification_id: u32,
    pub action: Action,
}

/// Callback invoked (off the run loop) when a notification action fires. The run
/// layer forwards it into the daemon's single-threaded event loop. Only `Send`
/// is required (it is moved into and called from the single signal-listener
/// thread), so a closure capturing an `mpsc::Sender` — which is `Send` but not
/// `Sync` — fits without extra synchronization.
pub type ActionCallback = Box<dyn Fn(ActionEvent) + Send>;

/// The id→reminder map plus the routing of incoming notification signals. A
/// **single** listener feeds both `ActionInvoked` and `NotificationClosed` here
/// in arrival order, so an `ActionInvoked` that a server emits immediately
/// before `NotificationClosed` is always routed *before* the close removes the
/// mapping. This eliminates the action/close cleanup race that previously made
/// snooze/remove/default-click intermittently become no-ops.
///
/// Kept free of any D-Bus types so the routing logic is unit-testable without a
/// live session bus.
pub struct NotificationRegistry {
    /// notification id (from `Notify`) → reminder id.
    map: Mutex<HashMap<u32, String>>,
}

impl NotificationRegistry {
    pub fn new() -> Self {
        Self {
            map: Mutex::new(HashMap::new()),
        }
    }

    /// Record that `notification_id` (returned by `Notify`) belongs to
    /// `reminder_id`, so a later `ActionInvoked` can be routed back.
    pub fn register(&self, notification_id: u32, reminder_id: String) -> Result<(), String> {
        self.map
            .lock()
            .map_err(|e| format!("map lock poisoned: {e}"))?
            .insert(notification_id, reminder_id);
        Ok(())
    }

    /// Route an `ActionInvoked(id, key)` into an [`ActionEvent`]. Returns `None`
    /// when the id is unknown (already closed / from another app) or the key is
    /// unrecognized (forward-compat) — both are ignored by the caller.
    pub fn route_action(&self, notification_id: u32, key: &str) -> Option<ActionEvent> {
        let reminder_id = self.lookup(notification_id)?;
        let action = parse_action_key(key)?;
        Some(ActionEvent {
            reminder_id,
            notification_id,
            action,
        })
    }

    /// Handle a `NotificationClosed(id)` by dropping the mapping. Because the
    /// single listener processes signals in order, any near-simultaneous
    /// `ActionInvoked` for this id has already been routed by the time we get
    /// here.
    pub fn on_closed(&self, notification_id: u32) {
        match self.map.lock() {
            Ok(mut map) => {
                map.remove(&notification_id);
            }
            // A poisoned lock means a listener panicked; log so the leak is
            // observable, but never panic the daemon.
            Err(e) => eprintln!("[reminderd] notification map lock poisoned on close: {e}"),
        }
    }

    fn lookup(&self, notification_id: u32) -> Option<String> {
        match self.map.lock() {
            Ok(map) => map.get(&notification_id).cloned(),
            Err(e) => {
                eprintln!("[reminderd] notification map lock poisoned on lookup: {e}");
                None
            }
        }
    }
}

impl Default for NotificationRegistry {
    fn default() -> Self {
        Self::new()
    }
}

// --- real D-Bus implementation -------------------------------------------

#[cfg(target_os = "linux")]
pub use zbus_impl::ZbusNotifier;

#[cfg(target_os = "linux")]
mod zbus_impl {
    use std::collections::HashMap;
    use std::sync::Arc;

    use zbus::blocking::{Connection, Proxy};
    use zbus::zvariant::Value;

    use super::{ActionCallback, NotificationRegistry, NotificationRequest, Notifier};

    const NOTIFY_DEST: &str = "org.freedesktop.Notifications";
    const NOTIFY_PATH: &str = "/org/freedesktop/Notifications";
    const NOTIFY_IFACE: &str = "org.freedesktop.Notifications";

    /// Real notifier over `org.freedesktop.Notifications`. Holds a blocking
    /// notification-service proxy and a [`NotificationRegistry`] so the single
    /// background signal listener can route `ActionInvoked` back to the
    /// originating reminder.
    pub struct ZbusNotifier {
        proxy: Proxy<'static>,
        registry: Arc<NotificationRegistry>,
    }

    impl ZbusNotifier {
        /// Connect to the session bus and spawn the single signal listener that
        /// handles both `ActionInvoked` and `NotificationClosed`. `on_action` is
        /// called for each recognized action on a notification we sent.
        pub fn new(on_action: ActionCallback) -> zbus::Result<Self> {
            let conn = Connection::session()?;
            let proxy = Proxy::new_owned(conn.clone(), NOTIFY_DEST, NOTIFY_PATH, NOTIFY_IFACE)?;
            let registry = Arc::new(NotificationRegistry::new());

            spawn_signal_listener(conn.clone(), Arc::clone(&registry), on_action);

            Ok(Self { proxy, registry })
        }
    }

    impl Notifier for ZbusNotifier {
        fn send(&self, req: &NotificationRequest) -> Result<u32, String> {
            // Flat action array: [key, label, key, label, …], plus the implicit
            // "default" action so a plain click opens the note (Phase 5).
            let mut actions: Vec<String> = Vec::new();
            actions.push(super::ACTION_DEFAULT.to_string());
            actions.push("Open note".to_string());
            for (key, label) in NotificationRequest::actions() {
                actions.push(key.to_string());
                actions.push(label.to_string());
            }

            // expire_timeout = 0 keeps the notification (and its action buttons)
            // resident until the user acts, as the feature needs.
            let hints = build_hints(req);
            let expire_timeout: i32 = 0;

            let id: u32 = self
                .proxy
                .call(
                    "Notify",
                    &(
                        "Eskerra",
                        req.replaces_id, // 0 = new notification; else replace in place
                        "",              // app_icon
                        req.summary.as_str(),
                        req.body.as_str(),
                        actions,
                        hints,
                        expire_timeout,
                    ),
                )
                .map_err(|e| format!("Notify: {e}"))?;

            self.registry.register(id, req.reminder_id.clone())?;
            Ok(id)
        }
    }

    pub(super) fn build_hints(req: &NotificationRequest) -> HashMap<String, Value<'static>> {
        let mut hints = HashMap::new();
        if let Some(sound_name) = req.sound_name.as_deref() {
            hints.insert(
                "sound-name".to_string(),
                Value::from(sound_name.to_string()),
            );
        }
        hints
    }

    /// One thread, both signals. Routing `ActionInvoked` and `NotificationClosed`
    /// through the *same* iterator keeps them serialized in the bus's delivery
    /// order, so a close that follows an action never removes the mapping before
    /// the action is routed. Startup/listener failures are logged (never
    /// panicked) so a dead listener — which would otherwise leak one map entry
    /// per sent notification — is observable in the journal.
    fn spawn_signal_listener(
        conn: Connection,
        registry: Arc<NotificationRegistry>,
        on_action: ActionCallback,
    ) {
        std::thread::spawn(move || {
            let proxy = match Proxy::new(&conn, NOTIFY_DEST, NOTIFY_PATH, NOTIFY_IFACE) {
                Ok(p) => p,
                Err(e) => {
                    eprintln!("[reminderd] signal listener proxy failed: {e}");
                    return;
                }
            };
            let signals = match proxy.receive_all_signals() {
                Ok(s) => s,
                Err(e) => {
                    eprintln!("[reminderd] receive notification signals failed: {e}");
                    return;
                }
            };
            for msg in signals {
                // `header()` borrows `msg`; copy the member name out before
                // deserializing the body so the borrow ends.
                let member = msg.header().member().map(|m| m.to_string());
                match member.as_deref() {
                    // ActionInvoked(UINT32 id, STRING action_key)
                    Some("ActionInvoked") => {
                        let Ok((id, key)) = msg.body().deserialize::<(u32, String)>() else {
                            continue;
                        };
                        if let Some(event) = registry.route_action(id, &key) {
                            on_action(event);
                        }
                    }
                    // NotificationClosed(UINT32 id, UINT32 reason)
                    Some("NotificationClosed") => {
                        if let Ok((id, _reason)) = msg.body().deserialize::<(u32, u32)>() {
                            registry.on_closed(id);
                        }
                    }
                    _ => {}
                }
            }
            // The iterator ending means the connection/stream closed; log so a
            // silently-dead listener (and the resulting map leak) is observable.
            eprintln!("[reminderd] notification signal listener stopped");
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{Local, TimeZone};
    use eskerra_reminder_core::{fresh_reminder_from_scan, scan, DefaultTime};

    /// A vault root with no Today Hub folders — title resolution falls back to the note stem.
    fn no_hub_root() -> &'static Path {
        Path::new("/eskerra-nonexistent-vault")
    }

    fn a_reminder() -> Reminder {
        let out = scan(b"meet @2026-06-06_0900 soon").unwrap();
        let token = out.tokens.into_iter().next().unwrap();
        fresh_reminder_from_scan(
            "Inbox/Daily note.md",
            "file:///Inbox/Daily note.md",
            &token,
            &out.scan_fingerprint,
            DefaultTime::DEFAULT_NINE_AM,
            5,
        )
        .unwrap()
    }

    fn a_token_only_reminder() -> Reminder {
        let out = scan(b"@2026-06-06_0900").unwrap();
        let token = out.tokens.into_iter().next().unwrap();
        fresh_reminder_from_scan(
            "Inbox/Daily note.md",
            "file:///Inbox/Daily note.md",
            &token,
            &out.scan_fingerprint,
            DefaultTime::DEFAULT_NINE_AM,
            5,
        )
        .unwrap()
    }

    #[test]
    fn parses_known_action_keys() {
        assert_eq!(
            parse_action_key(ACTION_SNOOZE_3),
            Some(Action::Snooze { minutes: 3 })
        );
        assert_eq!(
            parse_action_key(ACTION_SNOOZE_1),
            Some(Action::Snooze { minutes: 1 })
        );
        assert_eq!(
            parse_action_key(ACTION_SNOOZE_0),
            Some(Action::Snooze { minutes: 0 })
        );
        assert_eq!(parse_action_key(ACTION_REMOVE), Some(Action::Remove));
        assert_eq!(parse_action_key(ACTION_DEFAULT), Some(Action::Open));
        assert_eq!(parse_action_key("bogus"), None);
    }

    #[test]
    fn note_title_drops_dirs_and_extension() {
        assert_eq!(note_title("Inbox/Daily note.md"), "Daily note");
        assert_eq!(note_title("top.md"), "top");
        assert_eq!(note_title("noext"), "noext");
    }

    #[test]
    fn note_title_for_uses_hub_folder_name_on_hub_rows() {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(root.path().join("Work")).unwrap();
        std::fs::write(root.path().join("Work/Today.md"), b"---\n---\n").unwrap();

        // The hub note itself → hub folder name.
        assert_eq!(note_title_for("Work/Today.md", root.path()), "Work");
        // Row beside a Today.md → hub folder name.
        assert_eq!(note_title_for("Work/2026-06-08.md", root.path()), "Work");
        // Date-named note with no sibling Today.md → bare stem.
        assert_eq!(
            note_title_for("Notes/2026-06-08.md", root.path()),
            "2026-06-08"
        );
        // Date-named note at the vault root (no hub folder) → bare stem.
        assert_eq!(note_title_for("2026-06-08.md", root.path()), "2026-06-08");
        // A missing/root Today.md or non-date note in a hub folder → its own stem, not the folder name.
        assert_eq!(note_title_for("Today.md", root.path()), "Today");
        assert_eq!(note_title_for("Work/Plan.md", root.path()), "Plan");
    }

    #[test]
    fn is_today_hub_row_stem_matches_date_shape_only() {
        assert!(is_today_hub_row_stem("2026-06-08"));
        assert!(!is_today_hub_row_stem("2026-6-8"));
        assert!(!is_today_hub_row_stem("2026-06-08x"));
        assert!(!is_today_hub_row_stem("Daily note"));
    }

    #[test]
    fn request_for_reminder_carries_id_and_title() {
        let r = a_reminder();
        let req = NotificationRequest::for_reminder(&r, FireKind::Lead, no_hub_root());
        assert_eq!(req.reminder_id, r.id);
        assert_eq!(req.summary, "Daily note");
        assert_eq!(req.sound_name.as_deref(), Some(REMINDER_SOUND_NAME));
        // Body is "meet soon (HH:MM)" — no raw token, no "Now:" / "Reminder " prefix.
        assert!(
            !req.body.contains("@2026-06-06_0900"),
            "token must not appear in body"
        );
        assert!(!req.body.contains("Now:"), "old prefix must be gone");
        assert!(!req.body.contains("Reminder "), "old prefix must be gone");
        assert!(
            req.body.starts_with("meet soon ("),
            "body must start with display_line"
        );
        assert!(req.body.ends_with(')'), "body must end with closing paren");
    }

    #[test]
    fn body_contains_display_line_and_local_hhmm() {
        let r = a_reminder();
        let expected_hhmm = Local
            .timestamp_millis_opt(r.due_at_ms)
            .single()
            .unwrap()
            .format("%H:%M")
            .to_string();
        let req = NotificationRequest::for_reminder(&r, FireKind::AtTime, no_hub_root());
        assert_eq!(req.summary, "Daily note");
        assert_eq!(req.body, format!("meet soon ({})", expected_hhmm));
    }

    #[test]
    fn empty_display_line_moves_time_to_title() {
        let r = a_token_only_reminder();
        assert!(
            r.display_line.is_empty(),
            "fixture must have empty display_line"
        );
        let expected_hhmm = Local
            .timestamp_millis_opt(r.due_at_ms)
            .single()
            .unwrap()
            .format("%H:%M")
            .to_string();
        let req = NotificationRequest::for_reminder(&r, FireKind::AtTime, no_hub_root());
        assert_eq!(req.summary, format!("Daily note ({})", expected_hhmm));
        assert_eq!(
            req.body, "",
            "body must be empty when display_line is empty"
        );
    }

    #[test]
    fn actions_has_three_entries_with_remove_and_no_snooze3() {
        let acts = NotificationRequest::actions();
        assert_eq!(acts.len(), 3, "exactly 3 outgoing actions (GNOME cap)");
        let keys: Vec<&str> = acts.iter().map(|(k, _)| *k).collect();
        assert!(keys.contains(&ACTION_REMOVE), "remove must be present");
        assert!(
            !keys.contains(&ACTION_SNOOZE_3),
            "snooze-3 must be absent from outgoing set"
        );
        assert!(keys.contains(&ACTION_SNOOZE_1));
        assert!(keys.contains(&ACTION_SNOOZE_0));
    }

    #[test]
    fn parse_action_key_still_accepts_snooze3_for_compat() {
        assert_eq!(
            parse_action_key(ACTION_SNOOZE_3),
            Some(Action::Snooze { minutes: 3 }),
            "old popups with snooze-3 button must still route"
        );
    }

    #[test]
    fn null_notifier_never_fails() {
        let n = NullNotifier;
        let r = a_reminder();
        assert!(n
            .send(&NotificationRequest::for_reminder(
                &r,
                FireKind::AtTime,
                no_hub_root()
            ))
            .is_ok());
    }

    #[test]
    fn replacing_sets_replaces_id() {
        let r = a_reminder();
        let req = NotificationRequest::for_reminder(&r, FireKind::AtTime, no_hub_root());
        assert_eq!(req.replaces_id, 0, "fresh notifications default to 0");
        let replacing = req.replacing(42);
        assert_eq!(replacing.replaces_id, 42);
        assert_eq!(replacing.sound_name.as_deref(), Some(REMINDER_SOUND_NAME));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn zbus_hints_include_reminder_sound_name() {
        let r = a_reminder();
        let req = NotificationRequest::for_reminder(&r, FireKind::AtTime, no_hub_root());
        let hints = super::zbus_impl::build_hints(&req);
        let sound_name = hints
            .get("sound-name")
            .and_then(|value| String::try_from(value).ok());
        assert_eq!(sound_name.as_deref(), Some(REMINDER_SOUND_NAME));
    }

    // --- registry routing / action-vs-close race --------------------------

    #[test]
    fn action_then_close_routes_then_drops_mapping() {
        // The single listener processes signals in arrival order. A server that
        // emits ActionInvoked immediately before NotificationClosed therefore
        // routes the action first — it is not lost to the close cleanup.
        let reg = NotificationRegistry::new();
        reg.register(7, "rem-1".to_string()).unwrap();

        let event = reg.route_action(7, ACTION_SNOOZE_3).expect("routes");
        assert_eq!(
            event,
            ActionEvent {
                reminder_id: "rem-1".to_string(),
                notification_id: 7,
                action: Action::Snooze { minutes: 3 },
            }
        );

        // The trailing close then cleans up the (now-consumed) mapping.
        reg.on_closed(7);
        assert!(
            reg.route_action(7, ACTION_SNOOZE_3).is_none(),
            "mapping is gone after close"
        );
    }

    #[test]
    fn close_before_action_makes_the_action_a_noop() {
        // If a close genuinely precedes the action (user dismissed without
        // acting), routing finds no mapping and the action is ignored.
        let reg = NotificationRegistry::new();
        reg.register(7, "rem-1".to_string()).unwrap();
        reg.on_closed(7);
        assert!(reg.route_action(7, ACTION_SNOOZE_0).is_none());
    }

    #[test]
    fn route_action_ignores_unknown_id_and_unknown_key() {
        let reg = NotificationRegistry::new();
        reg.register(7, "rem-1".to_string()).unwrap();
        assert!(
            reg.route_action(99, ACTION_SNOOZE_3).is_none(),
            "unknown id"
        );
        assert!(reg.route_action(7, "bogus").is_none(), "unknown key");
    }
}

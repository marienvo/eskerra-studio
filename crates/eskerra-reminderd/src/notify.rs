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
}

impl NotificationRequest {
    /// Build the notification copy for a reminder fire. `summary` is the note
    /// title (file stem), `body` describes the reminder and fire kind.
    pub fn for_reminder(reminder: &Reminder, kind: FireKind) -> Self {
        let title = note_title(&reminder.vault_relative_path);
        let body = match kind {
            FireKind::Lead => format!("Reminder {} — {}", reminder.normalized_token_text, title),
            FireKind::AtTime => format!("Now: {} — {}", reminder.normalized_token_text, title),
        };
        Self {
            reminder_id: reminder.id.clone(),
            summary: title,
            body,
        }
    }

    /// The standard action set + labels for a reminder notification, in display
    /// order, as `(key, label)` pairs.
    pub fn actions() -> [(&'static str, &'static str); 4] {
        [
            (ACTION_SNOOZE_3, "Remind at T-3 min"),
            (ACTION_SNOOZE_1, "Remind at T-1 min"),
            (ACTION_SNOOZE_0, "Remind at due time"),
            (ACTION_REMOVE, "Remove"),
        ]
    }
}

/// Note title = the file stem of the vault-relative path (drop directories and
/// the `.md` extension), falling back to the full path if there is no stem.
fn note_title(vault_relative_path: &str) -> String {
    let last = vault_relative_path.rsplit('/').next().unwrap_or(vault_relative_path);
    last.strip_suffix(".md").unwrap_or(last).to_string()
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
        eprintln!("[reminderd] (no notifier) would notify: {} — {}", req.summary, req.body);
        Ok(0)
    }
}

// --- real D-Bus implementation -------------------------------------------

#[cfg(target_os = "linux")]
pub use zbus_impl::ZbusNotifier;

#[cfg(target_os = "linux")]
mod zbus_impl {
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex};

    use zbus::blocking::{Connection, Proxy};

    use super::{parse_action_key, NotificationRequest, Notifier};
    use crate::scheduler::Action;

    const NOTIFY_DEST: &str = "org.freedesktop.Notifications";
    const NOTIFY_PATH: &str = "/org/freedesktop/Notifications";
    const NOTIFY_IFACE: &str = "org.freedesktop.Notifications";

    /// Callback invoked (off the run loop) when a notification action fires,
    /// carrying the reminder id and decoded [`Action`]. The run layer forwards
    /// it into the daemon's single-threaded event loop. Only `Send` is required
    /// (it is moved into and called from the single action-listener thread), so
    /// a closure capturing an `mpsc::Sender` — which is `Send` but not `Sync` —
    /// fits without extra synchronization.
    pub type ActionCallback = Box<dyn Fn(String, Action) + Send>;

    /// Real notifier over `org.freedesktop.Notifications`. Holds a blocking
    /// session-bus connection and an id→reminder map so the background signal
    /// listener can route `ActionInvoked` back to the originating reminder.
    pub struct ZbusNotifier {
        conn: Connection,
        /// notification id (from `Notify`) → reminder id.
        map: Arc<Mutex<HashMap<u32, String>>>,
    }

    impl ZbusNotifier {
        /// Connect to the session bus and spawn the `ActionInvoked` /
        /// `NotificationClosed` signal listeners. `on_action` is called for each
        /// recognized action on a notification we sent.
        pub fn new(on_action: ActionCallback) -> zbus::Result<Self> {
            let conn = Connection::session()?;
            let map: Arc<Mutex<HashMap<u32, String>>> = Arc::new(Mutex::new(HashMap::new()));

            spawn_action_listener(conn.clone(), Arc::clone(&map), on_action);
            spawn_closed_listener(conn.clone(), Arc::clone(&map));

            Ok(Self { conn, map })
        }
    }

    impl Notifier for ZbusNotifier {
        fn send(&self, req: &NotificationRequest) -> Result<u32, String> {
            let proxy = Proxy::new(&self.conn, NOTIFY_DEST, NOTIFY_PATH, NOTIFY_IFACE)
                .map_err(|e| format!("proxy: {e}"))?;

            // Flat action array: [key, label, key, label, …], plus the implicit
            // "default" action so a plain click opens the note (Phase 5).
            let mut actions: Vec<String> = Vec::new();
            actions.push(super::ACTION_DEFAULT.to_string());
            actions.push("Open note".to_string());
            for (key, label) in NotificationRequest::actions() {
                actions.push(key.to_string());
                actions.push(label.to_string());
            }

            // No hints today; expire_timeout = 0 keeps the notification (and its
            // action buttons) resident until the user acts, as the feature needs.
            let hints: HashMap<String, zbus::zvariant::Value> = HashMap::new();
            let expire_timeout: i32 = 0;

            let id: u32 = proxy
                .call(
                    "Notify",
                    &(
                        "Eskerra",
                        0u32, // replaces_id: 0 = new notification
                        "",   // app_icon
                        req.summary.as_str(),
                        req.body.as_str(),
                        actions,
                        hints,
                        expire_timeout,
                    ),
                )
                .map_err(|e| format!("Notify: {e}"))?;

            self.map.lock().unwrap().insert(id, req.reminder_id.clone());
            Ok(id)
        }
    }

    fn spawn_action_listener(
        conn: Connection,
        map: Arc<Mutex<HashMap<u32, String>>>,
        on_action: ActionCallback,
    ) {
        std::thread::spawn(move || {
            let proxy = match Proxy::new(&conn, NOTIFY_DEST, NOTIFY_PATH, NOTIFY_IFACE) {
                Ok(p) => p,
                Err(e) => {
                    eprintln!("[reminderd] action listener proxy failed: {e}");
                    return;
                }
            };
            let signals = match proxy.receive_signal("ActionInvoked") {
                Ok(s) => s,
                Err(e) => {
                    eprintln!("[reminderd] receive ActionInvoked failed: {e}");
                    return;
                }
            };
            for msg in signals {
                // ActionInvoked(UINT32 id, STRING action_key)
                let Ok((id, key)) = msg.body().deserialize::<(u32, String)>() else {
                    continue;
                };
                let reminder_id = map.lock().unwrap().get(&id).cloned();
                if let (Some(reminder_id), Some(action)) = (reminder_id, parse_action_key(&key)) {
                    on_action(reminder_id, action);
                }
            }
        });
    }

    fn spawn_closed_listener(conn: Connection, map: Arc<Mutex<HashMap<u32, String>>>) {
        std::thread::spawn(move || {
            let proxy = match Proxy::new(&conn, NOTIFY_DEST, NOTIFY_PATH, NOTIFY_IFACE) {
                Ok(p) => p,
                Err(_) => return,
            };
            let signals = match proxy.receive_signal("NotificationClosed") {
                Ok(s) => s,
                Err(_) => return,
            };
            for msg in signals {
                // NotificationClosed(UINT32 id, UINT32 reason)
                if let Ok((id, _reason)) = msg.body().deserialize::<(u32, u32)>() {
                    map.lock().unwrap().remove(&id);
                }
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use eskerra_reminder_core::{fresh_reminder_from_scan, scan, DefaultTime};

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

    #[test]
    fn parses_known_action_keys() {
        assert_eq!(parse_action_key(ACTION_SNOOZE_3), Some(Action::Snooze { minutes: 3 }));
        assert_eq!(parse_action_key(ACTION_SNOOZE_1), Some(Action::Snooze { minutes: 1 }));
        assert_eq!(parse_action_key(ACTION_SNOOZE_0), Some(Action::Snooze { minutes: 0 }));
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
    fn request_for_reminder_carries_id_and_title() {
        let r = a_reminder();
        let req = NotificationRequest::for_reminder(&r, FireKind::Lead);
        assert_eq!(req.reminder_id, r.id);
        assert_eq!(req.summary, "Daily note");
        assert!(req.body.contains("@2026-06-06_0900"));
    }

    #[test]
    fn null_notifier_never_fails() {
        let n = NullNotifier;
        let r = a_reminder();
        assert!(n.send(&NotificationRequest::for_reminder(&r, FireKind::AtTime)).is_ok());
    }
}

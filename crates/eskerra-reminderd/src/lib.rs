//! `eskerra-reminderd` — the headless reminder daemon (Phases 2–3: config +
//! watcher + index production, plus the scheduler and GNOME D-Bus notifications
//! with snooze/remove/click actions and suspend/resume handling).
//!
//! The pure-ish state machine lives in [`daemon::Daemon`] and owns no threads;
//! [`run::run`] wires the real vault watcher (`eskerra-vault-watch`), the
//! config-file watcher, the D-Bus notifier ([`notify`]) + login1 suspend
//! listener, and the scheduler tick into it. The firing/snooze/missed-grace
//! decisions are pure functions in [`scheduler`]. See
//! `specs/plans/desktop-reminders-daemon-phased.md` Phases 2–3 and ADR 003.

pub mod config;
pub mod daemon;
pub mod index_store;
pub mod notify;
pub mod paths;
pub mod rederive;
pub mod run;
pub mod scan;
pub mod scheduler;
pub mod watch_control;

pub use daemon::{Daemon, DaemonStateKind, Outcome, WatchControl};
pub use notify::{Notifier, NotificationRequest, NullNotifier};
pub use scheduler::{Action, ActionOutcome};

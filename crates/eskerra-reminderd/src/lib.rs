//! `eskerra-reminderd` — the headless reminder daemon (Phases 2–4: config +
//! watcher + index production, the scheduler and GNOME D-Bus notifications with
//! snooze/remove/click actions and suspend/resume handling, and the
//! strikethrough write-back + `dev.eskerra.Reminders1` `RemoveReminder` IPC).
//!
//! The pure-ish state machine lives in [`daemon::Daemon`] and owns no threads;
//! [`run::run`] wires the real vault watcher (`eskerra-vault-watch`), the
//! config-file watcher, the D-Bus notifier ([`notify`]) + login1 suspend
//! listener, the scheduler tick, and the [`service`] `RemoveReminder` server
//! into it. The firing/snooze/missed-grace decisions are pure functions in
//! [`scheduler`]; the strikethrough writer is the sole-writer [`writeback`]
//! module (per-note locked, fail-closed). See
//! `specs/plans/desktop-reminders-daemon-phased.md` Phases 2–4 and ADR 003.

pub mod config;
pub mod daemon;
pub mod index_store;
pub mod notify;
pub mod obs;
pub mod paths;
pub mod rederive;
pub mod run;
pub mod scan;
pub mod scheduler;
pub mod service;
pub mod watch_control;
pub mod writeback;

pub use daemon::{Daemon, DaemonStateKind, Outcome, RemoveTarget, WatchControl};
pub use notify::{NotificationRequest, Notifier, NullNotifier};
pub use scheduler::{Action, ActionOutcome};
pub use writeback::{RemoveResult, Remover};

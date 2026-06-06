//! `eskerra-reminderd` — the headless reminder daemon (Phase 2: config +
//! watcher + index production; no notifications yet).
//!
//! The pure-ish state machine lives in [`daemon::Daemon`] and owns no threads;
//! [`run::run`] wires the real vault watcher (`eskerra-vault-watch`), the
//! config-file watcher, and a backoff tick into it. See
//! `specs/plans/desktop-reminders-daemon-phased.md` Phase 2 and ADR 003.

pub mod config;
pub mod daemon;
pub mod index_store;
pub mod paths;
pub mod rederive;
pub mod run;
pub mod scan;
pub mod watch_control;

pub use daemon::{Daemon, DaemonStateKind, Outcome, WatchControl};

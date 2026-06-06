//! Pure reminder core: date-token grammar, scanner, index schema, identity and
//! merge rules — shared by the `app` crate and `eskerra-reminderd`.
//!
//! See `specs/plans/desktop-reminders-daemon-phased.md` and
//! `specs/adrs/003-adr-reminder-daemon.md` for the locked contracts this crate
//! implements. No filesystem watching, no D-Bus, no Tauri — pure functions
//! over provided bytes.

pub mod date_token;
pub mod index;
pub mod merge;
pub mod resolve;
pub mod scanner;

pub use date_token::{format_date_token, parse_date_token, DateTokenValue};
pub use index::{
    fresh_reminder_from_scan, reminder_id, resolve_due_at_ms, write_atomic, DefaultTime,
    IndexParseError, Reminder, ReminderIndex, ReminderState, UiCaretHint, SCHEMA_VERSION,
};
pub use merge::merge_reminders;
pub use resolve::{resolve_live_token, TokenResolution};
pub use scanner::{scan, ScanOutput, ScannedToken};

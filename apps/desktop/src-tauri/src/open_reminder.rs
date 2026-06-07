//! Phase 5 click-to-open: parse `--open-reminder` CLI args, resolve the live
//! token position via the shared `eskerra-reminder-core` crate, and expose two
//! Tauri commands consumed by `useOpenReminderNavigation`.

use std::path::PathBuf;
use std::sync::Mutex;

use eskerra_reminder_core::{resolve_live_token, scan, ReminderIndex, TokenResolution};
use serde::{Deserialize, Serialize};
use tauri::State;

// ── public payload types ───────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenReminderRequest {
    pub note_uri: String,
    pub reminder_id: String,
    pub ui_caret_hint: Option<u32>,
}

/// UTF-16 caret position after the live token end, directly usable as a
/// CodeMirror `anchor`. Advisory — only present on a `Resolved` outcome.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedReminderPosition {
    pub caret_utf16: u32,
}

// ── app state ──────────────────────────────────────────────────────────────

/// Holds a pending open-reminder request between the CLI arg / single-instance
/// callback and the first React render cycle that calls
/// `reminders_take_pending_open`.
#[derive(Default)]
pub struct PendingOpenReminder(pub Mutex<Option<OpenReminderRequest>>);

// ── CLI arg parsing ────────────────────────────────────────────────────────

/// Parse `argv` (the process argument list) for the pattern:
/// `--open-reminder <noteUri> <reminderId> [--ui-caret-hint <N>]`
///
/// Returns `None` if `--open-reminder` is absent or its required arguments
/// are missing.
pub fn parse_open_reminder_args(argv: &[String]) -> Option<OpenReminderRequest> {
    let mut iter = argv.iter().peekable();
    while let Some(arg) = iter.next() {
        if arg != "--open-reminder" {
            continue;
        }
        let note_uri = iter.next()?.clone();
        let reminder_id = iter.next()?.clone();
        let mut ui_caret_hint: Option<u32> = None;
        while let Some(a) = iter.next() {
            if a == "--ui-caret-hint" {
                if let Some(n) = iter.next() {
                    ui_caret_hint = n.parse().ok();
                }
            }
        }
        return Some(OpenReminderRequest { note_uri, reminder_id, ui_caret_hint });
    }
    None
}

// ── internal helpers ───────────────────────────────────────────────────────

fn reminders_data_dir() -> Option<PathBuf> {
    let base = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .filter(|p| !p.as_os_str().is_empty())
        .or_else(|| {
            std::env::var_os("HOME")
                .map(PathBuf::from)
                .filter(|p| !p.as_os_str().is_empty())
                .map(|home| home.join(".local/share"))
        })?;
    Some(base.join("eskerra").join("reminders"))
}

fn load_reminder(reminder_id: &str) -> Option<eskerra_reminder_core::Reminder> {
    let data_dir = reminders_data_dir()?;
    let entries = std::fs::read_dir(&data_dir).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(&path) else { continue };
        let Ok(index) = ReminderIndex::from_json(&text) else { continue };
        if let Some(r) = index.reminders.into_iter().find(|r| r.id == reminder_id) {
            return Some(r);
        }
    }
    None
}

fn percent_decode_bytes(s: &str) -> Vec<u8> {
    let bytes = s.as_bytes();
    let mut result = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(h1), Some(h2)) = (hex_val(bytes[i + 1]), hex_val(bytes[i + 2])) {
                result.push(h1 << 4 | h2);
                i += 3;
                continue;
            }
        }
        result.push(bytes[i]);
        i += 1;
    }
    result
}

fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

fn note_path_from_uri(note_uri: &str) -> Option<PathBuf> {
    let stripped = note_uri.strip_prefix("file://")?;
    let decoded = percent_decode_bytes(stripped);
    let s = String::from_utf8(decoded).ok()?;
    Some(PathBuf::from(s))
}

// ── Tauri commands ─────────────────────────────────────────────────────────

/// Cold-start path: drain the pending open request set during startup arg
/// parsing. Returns `None` if no `--open-reminder` arg was present.
#[tauri::command]
pub fn reminders_take_pending_open(
    state: State<'_, PendingOpenReminder>,
) -> Option<OpenReminderRequest> {
    state.0.lock().unwrap_or_else(|e| e.into_inner()).take()
}

/// Resolve the live token position for the given reminder. Reads the note from
/// disk, re-scans it, and applies the same contextAnchor + ordinal rules as the
/// Phase 4 write-back. Returns `None` on Gone/Ambiguous (caller falls back to
/// advisory `uiCaretHint` or top-of-note).
#[tauri::command]
pub fn reminders_resolve_position(
    note_uri: String,
    reminder_id: String,
) -> Option<ResolvedReminderPosition> {
    let stored = load_reminder(&reminder_id)?;
    let note_path = note_path_from_uri(&note_uri)?;
    let bytes = std::fs::read(&note_path).ok()?;
    let scan_output = scan(&bytes)?;
    match resolve_live_token(&stored, &scan_output) {
        TokenResolution::Resolved { token_index } => {
            let caret_utf16 = scan_output.tokens[token_index].ui_caret_hint_utf16;
            Some(ResolvedReminderPosition { caret_utf16 })
        }
        TokenResolution::Gone | TokenResolution::Ambiguous => None,
    }
}

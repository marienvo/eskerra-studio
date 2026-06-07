//! Phase 5 click-to-open: parse `--open-reminder` CLI args, resolve the live
//! token position via the shared `eskerra-reminder-core` crate, and expose two
//! Tauri commands consumed by `useOpenReminderNavigation`.

use std::path::{Path, PathBuf};
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

/// UTF-16 caret position after the live token end in the editor-normalized
/// document, directly usable as a CodeMirror `anchor`. Advisory — only present
/// on a `Resolved` outcome.
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
        return Some(OpenReminderRequest {
            note_uri,
            reminder_id,
            ui_caret_hint,
        });
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

fn load_reminder(reminder_id: &str, note_uri: &str) -> Option<eskerra_reminder_core::Reminder> {
    let data_dir = reminders_data_dir()?;
    load_reminder_from_data_dir(&data_dir, reminder_id, note_uri)
}

fn load_reminder_from_data_dir(
    data_dir: &Path,
    reminder_id: &str,
    note_uri: &str,
) -> Option<eskerra_reminder_core::Reminder> {
    let entries = std::fs::read_dir(&data_dir).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(&path) else {
            continue;
        };
        let Ok(index) = ReminderIndex::from_json(&text) else {
            continue;
        };
        if let Some(r) = index
            .reminders
            .into_iter()
            .find(|r| r.id == reminder_id && r.note_uri == note_uri)
        {
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

fn normalized_markdown_disk_read_utf16_len(raw: &str) -> u32 {
    let mut len = 0u32;
    let mut prev_was_crlf_or_lf = false;
    let mut chars = raw.chars().peekable();
    while let Some(ch) = chars.next() {
        match ch {
            '\r' if chars.peek() == Some(&'\n') => {
                chars.next();
                len += 1;
                prev_was_crlf_or_lf = true;
            }
            '\r' | '\n' => {
                len += 1;
                prev_was_crlf_or_lf = true;
            }
            _ => {
                len += ch.len_utf16() as u32;
                prev_was_crlf_or_lf = false;
            }
        }
    }
    if prev_was_crlf_or_lf {
        len.saturating_sub(1)
    } else {
        len
    }
}

fn normalize_raw_utf16_offset_for_editor(raw: &str, raw_offset: u32) -> u32 {
    let mut raw_units = 0u32;
    let mut normalized_units = 0u32;
    let mut chars = raw.chars().peekable();

    while let Some(ch) = chars.next() {
        if raw_units >= raw_offset {
            break;
        }

        if ch == '\r' && chars.peek() == Some(&'\n') {
            if raw_offset <= raw_units + 2 {
                normalized_units += 1;
                break;
            }
            chars.next();
            raw_units += 2;
            normalized_units += 1;
            continue;
        }

        let width = ch.len_utf16() as u32;
        if raw_offset < raw_units + width {
            normalized_units += raw_offset - raw_units;
            break;
        }
        raw_units += width;
        normalized_units += width;
    }

    normalized_units.min(normalized_markdown_disk_read_utf16_len(raw))
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
    let stored = load_reminder(&reminder_id, &note_uri)?;
    let note_path = note_path_from_uri(&note_uri)?;
    let bytes = std::fs::read(&note_path).ok()?;
    let scan_output = scan(&bytes)?;
    let raw = std::str::from_utf8(&bytes).ok()?;
    match resolve_live_token(&stored, &scan_output) {
        TokenResolution::Resolved { token_index } => {
            let caret_utf16 = normalize_raw_utf16_offset_for_editor(
                raw,
                scan_output.tokens[token_index].ui_caret_hint_utf16,
            );
            Some(ResolvedReminderPosition { caret_utf16 })
        }
        TokenResolution::Gone | TokenResolution::Ambiguous => None,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        load_reminder_from_data_dir, normalize_raw_utf16_offset_for_editor,
        normalized_markdown_disk_read_utf16_len, parse_open_reminder_args,
    };
    use eskerra_reminder_core::{scan, Reminder, ReminderIndex, ReminderState, UiCaretHint};

    fn args(items: &[&str]) -> Vec<String> {
        items.iter().map(|item| item.to_string()).collect()
    }

    fn reminder(id: &str, note_uri: &str) -> Reminder {
        Reminder {
            id: id.to_string(),
            note_uri: note_uri.to_string(),
            vault_relative_path: "Inbox/n.md".to_string(),
            normalized_token_text: "@2026-06-06".to_string(),
            occurrence_ordinal: 0,
            due_at_ms: 1,
            fire_at_ms: 1,
            state: ReminderState::Scheduled,
            last_notified_ms: None,
            token_byte_from: 0,
            token_byte_to: 11,
            ui_caret_hint: Some(UiCaretHint { utf16_offset: 11 }),
            context_anchor: "anchor".to_string(),
            duplicate_count: 1,
            scan_fingerprint: "fingerprint".to_string(),
        }
    }

    #[test]
    fn parse_open_reminder_args_returns_none_when_flag_is_absent() {
        let parsed = parse_open_reminder_args(&args(&["eskerra", "--not-open-reminder"]));

        assert!(parsed.is_none());
    }

    #[test]
    fn parse_open_reminder_args_returns_none_when_required_args_are_missing() {
        assert!(parse_open_reminder_args(&args(&["eskerra", "--open-reminder"])).is_none());
        assert!(
            parse_open_reminder_args(&args(&["eskerra", "--open-reminder", "file:///n.md"]))
                .is_none()
        );
    }

    #[test]
    fn parse_open_reminder_args_parses_required_args_without_caret_hint() {
        let parsed = parse_open_reminder_args(&args(&[
            "eskerra",
            "--open-reminder",
            "file:///Inbox/n.md",
            "reminder-1",
        ]))
        .expect("open-reminder args should parse");

        assert_eq!(parsed.note_uri, "file:///Inbox/n.md");
        assert_eq!(parsed.reminder_id, "reminder-1");
        assert_eq!(parsed.ui_caret_hint, None);
    }

    #[test]
    fn parse_open_reminder_args_parses_optional_caret_hint() {
        let parsed = parse_open_reminder_args(&args(&[
            "eskerra",
            "--open-reminder",
            "file:///Inbox/n.md",
            "reminder-1",
            "--ui-caret-hint",
            "42",
        ]))
        .expect("open-reminder args should parse");

        assert_eq!(parsed.note_uri, "file:///Inbox/n.md");
        assert_eq!(parsed.reminder_id, "reminder-1");
        assert_eq!(parsed.ui_caret_hint, Some(42));
    }

    #[test]
    fn parse_open_reminder_args_ignores_missing_or_invalid_optional_caret_hint() {
        let missing = parse_open_reminder_args(&args(&[
            "eskerra",
            "--open-reminder",
            "file:///Inbox/n.md",
            "reminder-1",
            "--ui-caret-hint",
        ]))
        .expect("required open-reminder args should still parse");
        let invalid = parse_open_reminder_args(&args(&[
            "eskerra",
            "--open-reminder",
            "file:///Inbox/n.md",
            "reminder-1",
            "--ui-caret-hint",
            "nope",
        ]))
        .expect("required open-reminder args should still parse");

        assert_eq!(missing.ui_caret_hint, None);
        assert_eq!(invalid.ui_caret_hint, None);
    }

    #[test]
    fn load_reminder_matches_the_clicked_note_uri_across_indexes() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let clicked = reminder("same-id", "file:///vault-b/Inbox/n.md");
        let other = reminder("same-id", "file:///vault-a/Inbox/n.md");
        let index_a = ReminderIndex::new("vault-a".to_string(), 1, vec![other]);
        let index_b = ReminderIndex::new("vault-b".to_string(), 1, vec![clicked.clone()]);
        std::fs::write(
            tmp.path().join("a.json"),
            index_a.to_json_pretty().expect("index json"),
        )
        .expect("write index a");
        std::fs::write(
            tmp.path().join("b.json"),
            index_b.to_json_pretty().expect("index json"),
        )
        .expect("write index b");

        let loaded =
            load_reminder_from_data_dir(tmp.path(), "same-id", "file:///vault-b/Inbox/n.md")
                .expect("clicked reminder should load");

        assert_eq!(loaded.note_uri, clicked.note_uri);
        assert_eq!(
            load_reminder_from_data_dir(tmp.path(), "same-id", "file:///missing/Inbox/n.md"),
            None
        );
    }

    #[test]
    fn normalized_caret_offsets_account_for_crlf_before_token() {
        let raw = "first\r\nsecond\r\n@2026-06-06";
        let scan_output = scan(raw.as_bytes()).expect("scan");
        let raw_caret = scan_output.tokens[0].ui_caret_hint_utf16;

        assert_eq!(raw_caret, 26);
        assert_eq!(normalize_raw_utf16_offset_for_editor(raw, raw_caret), 24);
    }

    #[test]
    fn normalized_caret_offsets_keep_lone_cr_width_and_clamp_trailing_newline() {
        assert_eq!(normalize_raw_utf16_offset_for_editor("a\rb", 3), 3);
        assert_eq!(normalized_markdown_disk_read_utf16_len("a\r\n"), 1);
        assert_eq!(normalize_raw_utf16_offset_for_editor("a\r\n", 3), 1);
    }
}

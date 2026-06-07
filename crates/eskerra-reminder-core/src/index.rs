//! Index model, (de)serialization, stable `id` derivation, `dueAt`
//! resolution, and the atomic write helper. Schema is LOCKED in
//! [ADR 003](../../../specs/adrs/003-adr-reminder-daemon.md) §3 — changing any
//! field requires updating the ADR in the same PR.

use std::io::Write as _;
use std::path::Path;

use chrono::{Duration, Local, NaiveDate, NaiveDateTime, NaiveTime, TimeZone};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::date_token::DateTokenValue;
use crate::scanner::ScannedToken;

pub const SCHEMA_VERSION: u32 = 1;

/// Mutable lifecycle state of a reminder. `removed` is intentionally absent —
/// a removed reminder is dropped from the index, never persisted (ADR §3).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ReminderState {
    Scheduled,
    Due,
    Notified,
    Stale,
}

/// Advisory, last-scan-only editor position: a UTF-16 code-unit document
/// offset (matching CodeMirror's position model). Never a write position and
/// never fed to the editor as authoritative — see `scanner` module docs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UiCaretHint {
    pub utf16_offset: u32,
}

/// One reminder entry. Field meanings and write-path rules are pinned in the
/// plan's *Index cache location* / *Reminder identity* sections and ADR §3/§4.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Reminder {
    /// Stable identity = `hash(vaultRelativePath \0 normalizedTokenText \0
    /// occurrenceOrdinal)`. Never derived from byte offsets. See
    /// [`reminder_id`].
    pub id: String,
    pub note_uri: String,
    /// Path relative to the vault root — survives relocation/sync, and is the
    /// thing identity is keyed on (renames mint a new `id`).
    pub vault_relative_path: String,
    /// Canonical `@YYYY-MM-DD` / `@YYYY-MM-DD_HHMM` text.
    pub normalized_token_text: String,
    /// 0-based index among identical tokens, document order. Tie-break only.
    pub occurrence_ordinal: u32,
    /// The reminder time itself (date-only tokens resolve via the
    /// configurable default time).
    pub due_at_ms: i64,
    /// T-5min lead, or a snooze override. Drives the scheduler.
    pub fire_at_ms: i64,
    pub state: ReminderState,
    /// Per-`fireAt` fire guard; prevents double-fire across re-arm/reconcile/
    /// resume.
    pub last_notified_ms: Option<i64>,
    /// UTF-8 byte index of the token's first byte. Last-scan only; the
    /// **only** span class allowed for write-back (re-derived by re-scan
    /// before every write — Phase 4).
    pub token_byte_from: u64,
    /// UTF-8 byte index one past the token's last byte.
    pub token_byte_to: u64,
    /// Advisory scroll guess only — see [`UiCaretHint`].
    pub ui_caret_hint: Option<UiCaretHint>,
    /// Hash of the containing line with the token masked out. Matching aid
    /// for duplicate-safe resolution, not identity.
    pub context_anchor: String,
    /// Count of byte-identical tokens observed at the last scan. A change
    /// between scan and write signals possible ordinal drift.
    pub duplicate_count: u32,
    /// Authoritative content hash (SHA-256 hex) of the file at the scan that
    /// produced this entry. The **only** proof of "provably unchanged";
    /// `len`/`mtime` are optional pre-checks, never proof.
    pub scan_fingerprint: String,
    /// The token's containing line cleaned for display: token text removed,
    /// leading list-marker / blockquote / heading prefix stripped, interior
    /// whitespace collapsed. Empty string when the line held only the token.
    /// Scan-derived, never identity. `serde(default)` so older index files
    /// without this field still parse (additive, no schema-version bump).
    #[serde(default)]
    pub display_line: String,
}

/// Top-level index document — one per vault (keyed by `vaultHash`), written
/// atomically by the daemon and treated as read-only by the app.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReminderIndex {
    pub schema_version: u32,
    pub vault_hash: String,
    pub vault_relative_root_marker: Option<String>,
    pub generated_at_ms: i64,
    pub reminders: Vec<Reminder>,
}

impl ReminderIndex {
    pub fn new(vault_hash: String, generated_at_ms: i64, reminders: Vec<Reminder>) -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            vault_hash,
            vault_relative_root_marker: None,
            generated_at_ms,
            reminders,
        }
    }

    pub fn to_json_pretty(&self) -> serde_json::Result<String> {
        serde_json::to_string_pretty(self)
    }

    /// Parses an index document, rejecting unknown major schema versions
    /// (fail-safe: the caller should treat this as "absent index" — see
    /// ADR §3 `schemaVersion` notes).
    pub fn from_json(text: &str) -> Result<Self, IndexParseError> {
        let index: ReminderIndex =
            serde_json::from_str(text).map_err(|e| IndexParseError::Malformed(e.to_string()))?;
        if index.schema_version != SCHEMA_VERSION {
            return Err(IndexParseError::UnsupportedSchemaVersion(index.schema_version));
        }
        Ok(index)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IndexParseError {
    Malformed(String),
    UnsupportedSchemaVersion(u32),
}

impl std::fmt::Display for IndexParseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            IndexParseError::Malformed(detail) => write!(f, "malformed reminder index: {detail}"),
            IndexParseError::UnsupportedSchemaVersion(version) => {
                write!(f, "unsupported reminder index schema version: {version}")
            }
        }
    }
}

impl std::error::Error for IndexParseError {}

/// Stable, offset-independent reminder identity:
/// `hash(vaultRelativePath \0 normalizedTokenText \0 occurrenceOrdinal)`.
/// SHA-256, lowercase hex. See the plan's *Reminder identity* section —
/// **never** derive identity from byte offsets.
pub fn reminder_id(
    vault_relative_path: &str,
    normalized_token_text: &str,
    occurrence_ordinal: u32,
) -> String {
    let mut hasher = Sha256::new();
    hasher.update(vault_relative_path.as_bytes());
    hasher.update(b"\0");
    hasher.update(normalized_token_text.as_bytes());
    hasher.update(b"\0");
    hasher.update(occurrence_ordinal.to_string().as_bytes());
    hex(&hasher.finalize())
}

fn hex(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

/// `"HH:MM"` local default time applied to date-only tokens. `(hour, minute)`,
/// each already range-checked against `0..=23` / `0..=59`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DefaultTime {
    pub hour: u8,
    pub minute: u8,
}

impl DefaultTime {
    pub const DEFAULT_NINE_AM: DefaultTime = DefaultTime { hour: 9, minute: 0 };

    pub fn new(hour: u8, minute: u8) -> Option<Self> {
        if hour <= 23 && minute <= 59 {
            Some(Self { hour, minute })
        } else {
            None
        }
    }
}

/// Resolves a token's `dueAtMs` (epoch milliseconds): explicit `@…_HHMM`
/// tokens use their own time; date-only `@YYYY-MM-DD` tokens use
/// `date_only_default_time` interpreted in the **local** timezone (per the
/// plan's *Vault-root discovery* / *Settings-only config change* sections —
/// the default time is local, configurable, and re-derivable without
/// changing identity).
///
/// DST edge cases: an ambiguous local time (fall-back overlap) resolves to
/// the earlier of the two instants; a nonexistent local time (spring-forward
/// gap) resolves to the first valid local instant after the gap. If no valid
/// local instant is found within the bounded search window, resolution fails
/// safe instead of reinterpreting the user's wall-clock token as UTC.
pub fn resolve_due_at_ms(
    value: DateTokenValue,
    date_only_default_time: DefaultTime,
) -> Option<i64> {
    let (hour, minute) = value
        .time
        .unwrap_or((date_only_default_time.hour, date_only_default_time.minute));
    let date = NaiveDate::from_ymd_opt(value.year as i32, value.month as u32, value.day as u32)?;
    let time = NaiveTime::from_hms_opt(hour as u32, minute as u32, 0)?;
    let naive = NaiveDateTime::new(date, time);
    resolve_local_datetime_ms(&naive)
}

const DST_GAP_RESOLUTION_WINDOW_MINUTES: i64 = 24 * 60;

fn resolve_local_datetime_ms(naive: &NaiveDateTime) -> Option<i64> {
    resolve_local_datetime_ms_by(*naive, |candidate| {
        match Local.from_local_datetime(&candidate) {
            chrono::LocalResult::Single(dt) => chrono::LocalResult::Single(dt.timestamp_millis()),
            chrono::LocalResult::Ambiguous(earliest, latest) => chrono::LocalResult::Ambiguous(
                earliest.timestamp_millis(),
                latest.timestamp_millis(),
            ),
            chrono::LocalResult::None => chrono::LocalResult::None,
        }
    })
}

fn resolve_local_datetime_ms_by(
    naive: NaiveDateTime,
    resolve: impl Fn(NaiveDateTime) -> chrono::LocalResult<i64>,
) -> Option<i64> {
    match resolve(naive) {
        chrono::LocalResult::Single(timestamp_ms) => Some(timestamp_ms),
        chrono::LocalResult::Ambiguous(earliest_ms, _latest_ms) => Some(earliest_ms),
        chrono::LocalResult::None => resolve_next_valid_local_datetime_ms(naive, resolve),
    }
}

fn resolve_next_valid_local_datetime_ms(
    naive: NaiveDateTime,
    resolve: impl Fn(NaiveDateTime) -> chrono::LocalResult<i64>,
) -> Option<i64> {
    for minutes_after_gap in 1..=DST_GAP_RESOLUTION_WINDOW_MINUTES {
        let candidate = naive.checked_add_signed(Duration::minutes(minutes_after_gap))?;
        match resolve(candidate) {
            chrono::LocalResult::Single(timestamp_ms) => return Some(timestamp_ms),
            chrono::LocalResult::Ambiguous(earliest_ms, _latest_ms) => return Some(earliest_ms),
            chrono::LocalResult::None => {}
        }
    }
    None
}

/// Builds a fresh, never-fired `Reminder` from a scanned token — the default
/// state for a reminder that has no carried-forward state from a prior index
/// (new token, or merge decided not to carry state). Scheduling/missed-grace
/// classification (Phase 3) decides the actual `state`/`fireAtMs` afterward;
/// this just establishes the scan-derived identity and byte-span fields plus
/// a `scheduled` baseline with `fireAtMs == dueAtMs - leadMinutes`.
pub fn fresh_reminder_from_scan(
    vault_relative_path: &str,
    note_uri: &str,
    token: &ScannedToken,
    scan_fingerprint: &str,
    date_only_default_time: DefaultTime,
    lead_minutes: u32,
) -> Option<Reminder> {
    let due_at_ms = resolve_due_at_ms(token.value, date_only_default_time)?;
    let fire_at_ms = due_at_ms - i64::from(lead_minutes) * 60_000;
    Some(Reminder {
        id: reminder_id(vault_relative_path, &token.normalized_token_text, token.occurrence_ordinal),
        note_uri: note_uri.to_string(),
        vault_relative_path: vault_relative_path.to_string(),
        normalized_token_text: token.normalized_token_text.clone(),
        occurrence_ordinal: token.occurrence_ordinal,
        due_at_ms,
        fire_at_ms,
        state: ReminderState::Scheduled,
        last_notified_ms: None,
        token_byte_from: token.token_byte_from as u64,
        token_byte_to: token.token_byte_to as u64,
        ui_caret_hint: Some(UiCaretHint { utf16_offset: token.ui_caret_hint_utf16 }),
        context_anchor: token.context_anchor.clone(),
        duplicate_count: token.duplicate_count,
        scan_fingerprint: scan_fingerprint.to_string(),
        display_line: token.display_line.clone(),
    })
}

/// Atomic write: a temp file in the same directory, then `rename` over the
/// destination, so a reader never observes a partial file. Used for both the
/// index and `reminderd.json` (per the plan's *Vault / config edge cases* and
/// *Write-back safety rules* rule 6).
///
/// `sync_data` is issued before the rename so the contents are durable on
/// disk, not merely flushed to the kernel page cache: after an unclean reboot
/// the renamed destination holds the written bytes rather than stale or zero
/// bytes. (The derived index is recoverable by re-scanning, but `reminderd.json`
/// config is not, so durability must match the rename-atomicity the caller
/// relies on. Note this does not fsync the parent directory — making the
/// rename itself crash-durable is a separate hardening left for the daemon.)
pub fn write_atomic(path: &Path, contents: &[u8]) -> std::io::Result<()> {
    let dir = path.parent().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, "destination path has no parent directory")
    })?;
    let mut tmp = tempfile::NamedTempFile::new_in(dir)?;
    tmp.write_all(contents)?;
    tmp.flush()?;
    tmp.as_file().sync_data()?;
    tmp.persist(path).map_err(|e| e.error)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scanner::scan;
    use chrono::LocalResult;

    fn scan_first(bytes: &[u8]) -> (ScannedToken, String) {
        let out = scan(bytes).expect("valid utf8");
        let token = out.tokens.into_iter().next().expect("one token");
        (token, out.scan_fingerprint)
    }

    #[test]
    fn id_is_stable_across_unrelated_text_changes() {
        let id_a = reminder_id("notes/today.md", "@2026-06-06_0900", 0);
        let id_b = reminder_id("notes/today.md", "@2026-06-06_0900", 0);
        assert_eq!(id_a, id_b);
    }

    #[test]
    fn id_changes_when_path_token_or_ordinal_changes() {
        let base = reminder_id("notes/today.md", "@2026-06-06_0900", 0);
        assert_ne!(base, reminder_id("notes/other.md", "@2026-06-06_0900", 0));
        assert_ne!(base, reminder_id("notes/today.md", "@2026-06-06_1000", 0));
        assert_ne!(base, reminder_id("notes/today.md", "@2026-06-06_0900", 1));
    }

    #[test]
    fn date_only_token_uses_configurable_default_time() {
        let (token, _fp) = scan_first(b"@2026-06-06");
        let nine = resolve_due_at_ms(token.value, DefaultTime::new(9, 0).unwrap()).unwrap();
        let eight = resolve_due_at_ms(token.value, DefaultTime::new(8, 0).unwrap()).unwrap();
        assert!(eight < nine);
        assert_eq!(nine - eight, 60 * 60 * 1000);
    }

    #[test]
    fn timed_token_ignores_default_time() {
        let (token, _fp) = scan_first(b"@2026-06-06_2330");
        let with_nine = resolve_due_at_ms(token.value, DefaultTime::new(9, 0).unwrap()).unwrap();
        let with_eight = resolve_due_at_ms(token.value, DefaultTime::new(8, 0).unwrap()).unwrap();
        assert_eq!(with_nine, with_eight);
    }

    #[test]
    fn nonexistent_local_time_resolves_to_first_post_gap_local_instant() {
        let naive_gap = NaiveDate::from_ymd_opt(2026, 3, 8)
            .unwrap()
            .and_hms_opt(2, 30, 0)
            .unwrap();
        let post_gap = NaiveDate::from_ymd_opt(2026, 3, 8)
            .unwrap()
            .and_hms_opt(3, 0, 0)
            .unwrap();

        let resolved = resolve_local_datetime_ms_by(naive_gap, |candidate| {
            if candidate >= naive_gap && candidate < post_gap {
                LocalResult::None
            } else {
                LocalResult::Single(candidate.and_utc().timestamp_millis())
            }
        });

        assert_eq!(resolved, Some(post_gap.and_utc().timestamp_millis()));
    }

    #[test]
    fn nonexistent_local_time_fails_safe_when_gap_never_resolves() {
        let naive_gap = NaiveDate::from_ymd_opt(2026, 3, 8)
            .unwrap()
            .and_hms_opt(2, 30, 0)
            .unwrap();

        let resolved = resolve_local_datetime_ms_by(naive_gap, |_candidate| LocalResult::None);

        assert_eq!(resolved, None);
    }

    #[test]
    fn ambiguous_local_time_resolves_to_earliest_instant() {
        let ambiguous = NaiveDate::from_ymd_opt(2026, 11, 1)
            .unwrap()
            .and_hms_opt(1, 30, 0)
            .unwrap();

        let resolved =
            resolve_local_datetime_ms_by(ambiguous, |_candidate| LocalResult::Ambiguous(10, 20));

        assert_eq!(resolved, Some(10));
    }

    #[test]
    fn fresh_reminder_carries_scan_derived_fields_and_default_schedule() {
        let (token, fingerprint) = scan_first(b"meet @2026-06-06_0900 soon");
        let reminder = fresh_reminder_from_scan(
            "notes/today.md",
            "note://notes/today.md",
            &token,
            &fingerprint,
            DefaultTime::DEFAULT_NINE_AM,
            5,
        )
        .unwrap();

        assert_eq!(reminder.id, reminder_id("notes/today.md", "@2026-06-06_0900", 0));
        assert_eq!(reminder.token_byte_from, token.token_byte_from as u64);
        assert_eq!(reminder.token_byte_to, token.token_byte_to as u64);
        assert_eq!(reminder.context_anchor, token.context_anchor);
        assert_eq!(reminder.scan_fingerprint, fingerprint);
        assert_eq!(reminder.state, ReminderState::Scheduled);
        assert_eq!(reminder.due_at_ms - reminder.fire_at_ms, 5 * 60_000);
        assert_eq!(reminder.last_notified_ms, None);
        // display_line: token removed from "meet @2026-06-06_0900 soon" → "meet soon"
        assert_eq!(reminder.display_line, "meet soon");
    }

    #[test]
    fn index_round_trips_through_json() {
        let (token, fingerprint) = scan_first(b"@2026-06-06_0900");
        let reminder = fresh_reminder_from_scan(
            "notes/today.md",
            "note://notes/today.md",
            &token,
            &fingerprint,
            DefaultTime::DEFAULT_NINE_AM,
            5,
        )
        .unwrap();
        let index = ReminderIndex::new("vault-hash-abc".to_string(), 1_000, vec![reminder.clone()]);

        let json = index.to_json_pretty().unwrap();
        assert!(json.contains("\"schemaVersion\": 1"));
        assert!(json.contains("\"normalizedTokenText\""));
        assert!(json.contains("\"displayLine\""), "displayLine must be serialized");

        let parsed = ReminderIndex::from_json(&json).unwrap();
        assert_eq!(parsed, index);
        assert_eq!(parsed.reminders[0], reminder);
    }

    #[test]
    fn index_without_display_line_parses_with_empty_default() {
        // An older index written before displayLine was added must still parse
        // successfully (schemaVersion stays 1; additive field only).
        let json = r#"{
            "schemaVersion": 1,
            "vaultHash": "abc",
            "vaultRelativeRootMarker": null,
            "generatedAtMs": 0,
            "reminders": [{
                "id": "rid",
                "noteUri": "file:///vault/a.md",
                "vaultRelativePath": "a.md",
                "normalizedTokenText": "@2026-06-06_0900",
                "occurrenceOrdinal": 0,
                "dueAtMs": 1000,
                "fireAtMs": 700,
                "state": "scheduled",
                "lastNotifiedMs": null,
                "tokenByteFrom": 0,
                "tokenByteTo": 16,
                "uiCaretHint": null,
                "contextAnchor": "anchor",
                "duplicateCount": 1,
                "scanFingerprint": "fp"
            }]
        }"#;
        let index = ReminderIndex::from_json(json).unwrap();
        assert_eq!(index.reminders[0].display_line, "", "serde(default) yields empty string");
    }

    #[test]
    fn from_json_rejects_unknown_schema_version() {
        let json = r#"{
            "schemaVersion": 2,
            "vaultHash": "x",
            "vaultRelativeRootMarker": null,
            "generatedAtMs": 0,
            "reminders": []
        }"#;
        assert_eq!(
            ReminderIndex::from_json(json),
            Err(IndexParseError::UnsupportedSchemaVersion(2))
        );
    }

    #[test]
    fn from_json_fails_safe_on_malformed_document() {
        assert!(matches!(
            ReminderIndex::from_json("not json"),
            Err(IndexParseError::Malformed(_))
        ));
    }

    #[test]
    fn write_atomic_replaces_destination_without_partial_reads() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("index.json");

        write_atomic(&path, b"{\"version\":1}").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{\"version\":1}");

        write_atomic(&path, b"{\"version\":2}").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{\"version\":2}");

        // No leftover temp files in the directory.
        let leftovers: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .filter(|name| name != "index.json")
            .collect();
        assert!(leftovers.is_empty(), "unexpected leftovers: {leftovers:?}");
    }
}

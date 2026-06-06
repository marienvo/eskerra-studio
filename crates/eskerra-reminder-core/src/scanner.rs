//! Pure scanner: given file bytes, find every live (non-struck-through)
//! date-token reminder candidate and report its **byte span**
//! (`tokenByteFrom`/`tokenByteTo`, UTF-8 byte indexes), parsed value,
//! occurrence ordinal, duplicate-safety anchor fields, and an advisory
//! `uiCaretHint`. See the plan's *Reminder identity* and *Phase 1* sections.
//!
//! Byte spans vs. UI positions must never be confused: `tokenByteFrom`/
//! `tokenByteTo` are the **only** spans the daemon may use for write-back
//! (Phase 4); `uiCaretHint` is a separately-derived, last-scan-only, advisory
//! editor position (a UTF-16 code-unit document offset, matching CodeMirror's
//! position model) that is never used for slicing.

use sha2::{Digest, Sha256};
use std::collections::HashMap;

use crate::date_token::{format_date_token, parse_date_token, DateTokenValue};

/// A single live token found by the scanner, in document order.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScannedToken {
    /// Canonical `@YYYY-MM-DD` / `@YYYY-MM-DD_HHMM` text — what the index
    /// stores as `normalizedTokenText` and what identity hashes over.
    pub normalized_token_text: String,
    pub value: DateTokenValue,
    /// UTF-8 byte index of the token's first byte (inclusive).
    pub token_byte_from: usize,
    /// UTF-8 byte index one past the token's last byte (exclusive).
    pub token_byte_to: usize,
    /// 0-based index of this token among tokens with the same
    /// `normalized_token_text`, in document order. Tie-break only — never
    /// trusted blindly (see *Reminder identity*).
    pub occurrence_ordinal: u32,
    /// Hash of the token's containing line with the token text masked out.
    /// Stable across snooze/state changes, distinct across duplicate tokens
    /// living in different surrounding text. Matching aid, not identity.
    pub context_anchor: String,
    /// Count of tokens sharing this `normalized_token_text` in the file, as
    /// observed at this scan. A change between scan and write signals
    /// possible ordinal drift.
    pub duplicate_count: u32,
    /// Advisory UI position: the UTF-16 code-unit document offset
    /// immediately after the token (where the caret should land per
    /// requirement 5). Last-scan-only; the app derives its own editor
    /// position from the byte span at click time — this is a scroll guess,
    /// **never** a write or caret source of truth.
    pub ui_caret_hint_utf16: u32,
}

/// Result of scanning one file's bytes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScanOutput {
    /// Authoritative content hash (SHA-256, lowercase hex) of the scanned
    /// bytes. The **only** proof that a file is "provably unchanged" since
    /// this scan; `len`/`mtime` are optional pre-checks only, never proof.
    pub scan_fingerprint: String,
    /// Live tokens in document order (struck-through tokens are excluded —
    /// see module docs: `@~~…~~` simply never matches the grammar).
    pub tokens: Vec<ScannedToken>,
}

/// Scan `bytes` for live date tokens. Returns `None` if `bytes` is not valid
/// UTF-8 — the grammar is ASCII matched inside valid UTF-8 markdown (per the
/// plan's Phase 1 byte-span guarantee), so a non-UTF-8 file has no tokens and
/// the daemon must fail safe rather than guess at byte boundaries.
pub fn scan(bytes: &[u8]) -> Option<ScanOutput> {
    let text = std::str::from_utf8(bytes).ok()?;
    let scan_fingerprint = sha256_hex(bytes);

    let lines = line_spans(text);
    let mut raw_matches: Vec<(usize, usize, DateTokenValue)> = Vec::new();

    let mut prev_char_is_boundary = true; // start of file counts as a boundary
    for (byte_pos, ch) in text.char_indices() {
        if ch == '@' && prev_char_is_boundary {
            if let Some((end, value)) = match_token_at(bytes, byte_pos) {
                raw_matches.push((byte_pos, end, value));
            }
        }
        prev_char_is_boundary = is_word_boundary_char(ch);
    }

    // duplicate_count per normalized text, computed up front so every
    // occurrence (including the first) reports the final count.
    let mut counts: HashMap<String, u32> = HashMap::new();
    let normalized: Vec<String> = raw_matches
        .iter()
        .map(|(_, _, value)| format_date_token(*value))
        .collect();
    for text in &normalized {
        *counts.entry(text.clone()).or_insert(0) += 1;
    }

    let mut ordinals: HashMap<String, u32> = HashMap::new();
    let mut tokens = Vec::with_capacity(raw_matches.len());
    let mut line_idx = 0usize;
    for (i, (from, to, value)) in raw_matches.into_iter().enumerate() {
        let normalized_token_text = normalized[i].clone();
        let occurrence_ordinal = {
            let counter = ordinals.entry(normalized_token_text.clone()).or_insert(0);
            let ordinal = *counter;
            *counter += 1;
            ordinal
        };
        let duplicate_count = counts[&normalized_token_text];

        while line_idx + 1 < lines.len() && lines[line_idx + 1].0 <= from {
            line_idx += 1;
        }
        let (line_from, line_to) = lines[line_idx];
        let context_anchor = context_anchor_hash(text, line_from, line_to, from, to);
        let ui_caret_hint_utf16 = utf16_len(&text[..to]) as u32;

        tokens.push(ScannedToken {
            normalized_token_text,
            value,
            token_byte_from: from,
            token_byte_to: to,
            occurrence_ordinal,
            context_anchor,
            duplicate_count,
            ui_caret_hint_utf16,
        });
    }

    Some(ScanOutput { scan_fingerprint, tokens })
}

/// Try to match a token starting at byte `start` (which must be `@`).
/// Mirrors the regex `@\d{4}-\d{2}-\d{2}(?:_\d{4})?` greedily — the
/// `_HHMM` suffix is preferred when present and well-shaped — followed by
/// the same calendar/time validation as `parse_date_token`. Tokens whose
/// shape matches but whose value is not a valid calendar date/time (e.g.
/// `@2026-13-99`) are not reminders and are skipped, mirroring
/// `dateTokenAtPosition`'s `if (value)` filter.
fn match_token_at(bytes: &[u8], start: usize) -> Option<(usize, DateTokenValue)> {
    debug_assert_eq!(bytes.get(start), Some(&b'@'));
    let body = &bytes[start + 1..];

    if body.len() >= 15 && is_ascii(&body[..15]) {
        // Safety: `body[..15]` is verified ASCII, so prefixing `@` yields
        // valid UTF-8 and `parse_date_token` can run on it directly.
        let candidate = format!("@{}", std::str::from_utf8(&body[..15]).unwrap());
        if let Some(value) = parse_date_token(&candidate) {
            return Some((start + 1 + 15, value));
        }
    }
    if body.len() >= 10 && is_ascii(&body[..10]) {
        let candidate = format!("@{}", std::str::from_utf8(&body[..10]).unwrap());
        if let Some(value) = parse_date_token(&candidate) {
            return Some((start + 1 + 10, value));
        }
    }
    None
}

fn is_ascii(bytes: &[u8]) -> bool {
    bytes.iter().all(u8::is_ascii)
}

/// Word-boundary characters per the JS `\s` class the original grammar uses
/// (Unicode whitespace plus U+FEFF, which JS's non-Unicode-flagged `\s`
/// treats as whitespace but Rust's `char::is_whitespace` does not).
fn is_word_boundary_char(ch: char) -> bool {
    ch.is_whitespace() || ch == '\u{FEFF}'
}

/// `(byte_from, byte_to_exclusive)` for every line, splitting on `\n` and
/// trimming a trailing `\r` from each line's span (so anchors/positions land
/// on the visible text, matching how CodeMirror reports `line.text`).
fn line_spans(text: &str) -> Vec<(usize, usize)> {
    let bytes = text.as_bytes();
    let mut spans = Vec::new();
    let mut start = 0usize;
    for (i, &b) in bytes.iter().enumerate() {
        if b == b'\n' {
            let mut end = i;
            if end > start && bytes[end - 1] == b'\r' {
                end -= 1;
            }
            spans.push((start, end));
            start = i + 1;
        }
    }
    spans.push((start, bytes.len()));
    spans
}

/// SHA-256 of `bytes` with the token span `[from, to)` (relative to the whole
/// document, but guaranteed to fall within `[line_from, line_to)`) replaced
/// by a fixed placeholder, so the anchor is stable across snooze/state
/// changes yet distinct between duplicates living in different surrounding
/// text. Hex-encoded.
fn context_anchor_hash(text: &str, line_from: usize, line_to: usize, from: usize, to: usize) -> String {
    let mut masked = String::with_capacity(line_to - line_from);
    masked.push_str(&text[line_from..from]);
    masked.push_str("\u{0}TOKEN\u{0}");
    masked.push_str(&text[to..line_to]);
    sha256_hex(masked.as_bytes())
}

fn utf16_len(s: &str) -> usize {
    s.encode_utf16().count()
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut hex = String::with_capacity(digest.len() * 2);
    for byte in digest {
        hex.push_str(&format!("{byte:02x}"));
    }
    hex
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::date_token::DateTokenValue;

    fn token_texts(out: &ScanOutput) -> Vec<&str> {
        out.tokens.iter().map(|t| t.normalized_token_text.as_str()).collect()
    }

    #[test]
    fn finds_tokens_at_line_start_and_after_whitespace() {
        let out = scan(b"@2026-06-06\nmeet @2026-06-06_1200 soon").unwrap();
        assert_eq!(token_texts(&out), vec!["@2026-06-06", "@2026-06-06_1200"]);
        assert_eq!(out.tokens[0].token_byte_from, 0);
        assert_eq!(out.tokens[0].token_byte_to, 11);
        assert_eq!(out.tokens[1].token_byte_from, 17);
        assert_eq!(out.tokens[1].token_byte_to, 33);
    }

    #[test]
    fn does_not_match_inside_email_like_text() {
        assert_eq!(token_texts(&scan(b"foo@bar.com").unwrap()), Vec::<&str>::new());
        assert_eq!(token_texts(&scan(b"user@2026-06-06").unwrap()), Vec::<&str>::new());
    }

    #[test]
    fn skips_shape_matches_with_invalid_calendar_values() {
        // `@2026-13-99` matches the *shape* but `parseDateToken` rejects it —
        // the reminder scanner only emits parseable tokens (mirrors
        // `dateTokenAtPosition`'s `if (value)` filter), unlike the editor's
        // raw highlight scan which surfaces shape matches for validation UI.
        assert_eq!(token_texts(&scan(b"@2026-13-99").unwrap()), Vec::<&str>::new());
    }

    #[test]
    fn struck_through_tokens_are_excluded() {
        let out = scan("Old: @~~2026-11-27_2300~~ done".as_bytes()).unwrap();
        assert!(out.tokens.is_empty());
    }

    #[test]
    fn assigns_document_order_occurrence_ordinals_per_normalized_text() {
        let out = scan(b"@2026-01-01\nsomething\n@2026-01-01\n@2026-02-02").unwrap();
        assert_eq!(out.tokens[0].occurrence_ordinal, 0);
        assert_eq!(out.tokens[0].duplicate_count, 2);
        assert_eq!(out.tokens[1].occurrence_ordinal, 1);
        assert_eq!(out.tokens[1].duplicate_count, 2);
        assert_eq!(out.tokens[2].occurrence_ordinal, 0);
        assert_eq!(out.tokens[2].duplicate_count, 1);
    }

    #[test]
    fn context_anchor_distinguishes_duplicates_in_different_lines() {
        let out = scan(b"alpha @2026-01-01 here\nbeta @2026-01-01 there").unwrap();
        assert_eq!(out.tokens.len(), 2);
        assert_ne!(out.tokens[0].context_anchor, out.tokens[1].context_anchor);
    }

    #[test]
    fn context_anchor_is_stable_when_text_elsewhere_changes() {
        let before = scan(b"line one\nmeet @2026-01-01 soon\nline three").unwrap();
        let after = scan(b"line ONE has changed\nmeet @2026-01-01 soon\nline three").unwrap();
        assert_eq!(before.tokens[0].context_anchor, after.tokens[0].context_anchor);
        assert_ne!(before.scan_fingerprint, after.scan_fingerprint);
    }

    #[test]
    fn non_ascii_before_token_yields_exact_byte_span() {
        // Multi-byte UTF-8 (emoji + accented text) on a prior line and on the
        // same line before the token. Slicing [from, to) must yield exactly
        // the token bytes with no panic on a non-boundary and no off-by-bytes;
        // the byte span must diverge from the character offset.
        let text = "🎉 héllo wörld\ncafé☕ @2026-11-27_0930 end";
        let out = scan(text.as_bytes()).unwrap();
        assert_eq!(out.tokens.len(), 1);
        let tok = &out.tokens[0];
        let sliced = &text.as_bytes()[tok.token_byte_from..tok.token_byte_to];
        assert_eq!(std::str::from_utf8(sliced).unwrap(), "@2026-11-27_0930");
        assert_eq!(tok.normalized_token_text, "@2026-11-27_0930");

        // Byte offset diverges from the char offset because of multi-byte
        // chars before the token on its line ('é' = 2 bytes, 'é' = 2 bytes,
        // '☕' = 3 bytes — "café☕ " is 8 bytes but 6 chars).
        let char_offset = text[..tok.token_byte_from].chars().count();
        assert_ne!(char_offset, tok.token_byte_from);

        // uiCaretHint is a UTF-16 offset, computed independently of the byte
        // span — never fed back as a slicing position.
        let expected_caret = text[..tok.token_byte_to].encode_utf16().count() as u32;
        assert_eq!(tok.ui_caret_hint_utf16, expected_caret);
    }

    #[test]
    fn scan_rejects_non_utf8_bytes() {
        assert!(scan(&[0x40, 0xFF, 0xFE]).is_none());
    }

    #[test]
    fn matches_multiple_tokens_on_one_line() {
        let out = scan(b"@2026-06-06 and @2026-12-28_2352").unwrap();
        assert_eq!(token_texts(&out), vec!["@2026-06-06", "@2026-12-28_2352"]);
    }

    #[test]
    fn scan_fingerprint_is_sha256_of_bytes() {
        let out = scan(b"hello").unwrap();
        let mut hasher = Sha256::new();
        hasher.update(b"hello");
        let expected = format!("{:x}", hasher.finalize());
        assert_eq!(out.scan_fingerprint, expected);
    }

    #[test]
    fn date_only_token_has_no_time_component() {
        let out = scan(b"@2026-06-06").unwrap();
        assert_eq!(out.tokens[0].value, DateTokenValue::date_only(2026, 6, 6));
    }
}

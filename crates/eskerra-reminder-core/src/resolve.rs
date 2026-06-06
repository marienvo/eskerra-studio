//! Duplicate-safe live-token resolution, shared by the daemon's write-back
//! (Phase 4) and the app's click-to-open (Phase 5). Given a stored index entry
//! and a fresh scan of the **current** file bytes, decide which live token (if
//! any) the entry refers to:
//!
//! 1. collect live candidates by `normalizedTokenText`;
//! 2. prefer a **unique** `contextAnchor` match (re-finds *this* occurrence by
//!    content even after ordinals shifted);
//! 3. fall back to `occurrenceOrdinal` **only** when the recomputed
//!    `scanFingerprint` proves the file byte-for-byte unchanged (len/mtime are
//!    never proof and never reach here);
//! 4. any residual ambiguity fails **closed** ([`TokenResolution::Ambiguous`]):
//!    the write path turns it into `stale`, the open path into a no-caret-jump
//!    open.
//!
//! This mirrors the duplicate-safety budget of [`crate::merge`] (state
//! migration) on the resolve/write side — never select by ordinal-derived `id`
//! alone. LOCKED rules: plan §Phase 4 *Write-back safety rules* 1–3 and ADR §4.

use crate::index::Reminder;
use crate::scanner::ScanOutput;

/// Outcome of resolving a stored reminder against a fresh scan.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TokenResolution {
    /// No live token matches the stored `normalizedTokenText` (already struck,
    /// edited to a different time, or deleted). Write-back → `removed` (no
    /// write); open → open the note with no caret jump.
    Gone,
    /// Exactly one live token resolved; the index into [`ScanOutput::tokens`].
    /// Callers read its freshly-scanned byte span (write) or `uiCaretHint`
    /// (open) from that token — never a stale stored offset.
    Resolved { token_index: usize },
    /// Multiple candidates that cannot be disambiguated safely (duplicate
    /// identical tokens whose anchor does not single one out and whose file
    /// changed since the scan). Write-back → `stale` (write nothing); open →
    /// open the note with no caret jump.
    Ambiguous,
}

/// Resolve `stored` against a fresh `scan` of the current on-disk bytes. Pure —
/// no I/O, no clock — so both the write path and the open path share one
/// definition and one set of tests.
pub fn resolve_live_token(stored: &Reminder, scan: &ScanOutput) -> TokenResolution {
    let candidates: Vec<usize> = scan
        .tokens
        .iter()
        .enumerate()
        .filter(|(_, t)| t.normalized_token_text == stored.normalized_token_text)
        .map(|(i, _)| i)
        .collect();

    // Zero-match: the token is already struck/edited/deleted — success-equivalent
    // for write-back (`removed`).
    if candidates.is_empty() {
        return TokenResolution::Gone;
    }

    // Prefer a unique containing-line anchor match: this re-finds the original
    // occurrence by content even after inserts/deletes shifted its ordinal.
    let anchor_matches: Vec<usize> = candidates
        .iter()
        .copied()
        .filter(|&i| scan.tokens[i].context_anchor == stored.context_anchor)
        .collect();
    if anchor_matches.len() == 1 {
        return TokenResolution::Resolved {
            token_index: anchor_matches[0],
        };
    }

    // The anchor does not single out one occurrence (identical surrounding text,
    // or the token's own line was edited). Trust the stored ordinal **only** when
    // the file is provably byte-for-byte unchanged: the recomputed content hash
    // equals the stored `scanFingerprint`. A matching len/mtime is never proof
    // and never reaches this function — `scan.scan_fingerprint` is always the
    // hash of the actual current bytes.
    if scan.scan_fingerprint == stored.scan_fingerprint {
        if let Some(&i) = candidates
            .iter()
            .find(|&&i| scan.tokens[i].occurrence_ordinal == stored.occurrence_ordinal)
        {
            return TokenResolution::Resolved { token_index: i };
        }
    }

    // Ambiguous → fail closed; never guess which duplicate to strike/open.
    TokenResolution::Ambiguous
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::index::{fresh_reminder_from_scan, DefaultTime};
    use crate::scanner::scan;

    fn stored_from(text: &str, ordinal: u32) -> Reminder {
        let out = scan(text.as_bytes()).expect("utf8");
        let token = out
            .tokens
            .iter()
            .find(|t| t.occurrence_ordinal == ordinal)
            .expect("token at ordinal");
        fresh_reminder_from_scan(
            "n.md",
            "file:///n.md",
            token,
            &out.scan_fingerprint,
            DefaultTime::DEFAULT_NINE_AM,
            5,
        )
        .expect("resolvable")
    }

    #[test]
    fn unique_token_resolves_to_its_span() {
        let body = "meet @2026-11-27_0930 soon";
        let stored = stored_from(body, 0);
        let out = scan(body.as_bytes()).unwrap();
        match resolve_live_token(&stored, &out) {
            TokenResolution::Resolved { token_index } => {
                assert_eq!(token_index, 0);
                let t = &out.tokens[token_index];
                assert_eq!(
                    &body.as_bytes()[t.token_byte_from..t.token_byte_to],
                    b"@2026-11-27_0930"
                );
            }
            other => panic!("expected Resolved, got {other:?}"),
        }
    }

    #[test]
    fn struck_or_deleted_token_is_gone() {
        let stored = stored_from("@2026-11-27_0930", 0);
        let struck = scan("Old: @~~2026-11-27_0930~~ done".as_bytes()).unwrap();
        assert_eq!(resolve_live_token(&stored, &struck), TokenResolution::Gone);
        let deleted = scan(b"nothing here now").unwrap();
        assert_eq!(resolve_live_token(&stored, &deleted), TokenResolution::Gone);
    }

    #[test]
    fn edited_to_a_different_time_is_gone() {
        let stored = stored_from("@2026-11-27_0930", 0);
        // The token's date/time changed → a different reminder; the old one is gone.
        let fresh = scan(b"@2026-11-27_1000").unwrap();
        assert_eq!(resolve_live_token(&stored, &fresh), TokenResolution::Gone);
    }

    #[test]
    fn duplicate_unique_anchor_resolves_after_ordinal_shift() {
        // Snooze/remove targets the "beta" occurrence (ordinal 1). An identical
        // token inserted above shifts every ordinal, but the containing-line
        // anchor still uniquely identifies it.
        let stored = stored_from("alpha @2026-01-01 x\nbeta @2026-01-01 y", 1);
        let fresh =
            scan(b"gamma @2026-01-01 z\nalpha @2026-01-01 x\nbeta @2026-01-01 y").unwrap();
        match resolve_live_token(&stored, &fresh) {
            TokenResolution::Resolved { token_index } => {
                let t = &fresh.tokens[token_index];
                assert_eq!(t.context_anchor, stored.context_anchor);
                assert_eq!(t.occurrence_ordinal, 2, "beta is now the third occurrence");
            }
            other => panic!("expected Resolved, got {other:?}"),
        }
    }

    #[test]
    fn identical_context_with_changed_fingerprint_is_ambiguous() {
        // Both duplicates live on byte-identical lines, so the anchor cannot
        // separate them, and an edit changed the file → ordinal not trusted.
        let stored = stored_from("- @2026-04-04 task\n- @2026-04-04 task", 0);
        let fresh = scan(b"- @2026-04-04 task\n- @2026-04-04 task\n- @2026-04-04 task").unwrap();
        assert_eq!(
            resolve_live_token(&stored, &fresh),
            TokenResolution::Ambiguous
        );
    }

    #[test]
    fn identical_context_unchanged_file_resolves_by_ordinal() {
        let text = "- @2026-05-05 task\n- @2026-05-05 task";
        let stored = stored_from(text, 1);
        let fresh = scan(text.as_bytes()).unwrap();
        // File byte-for-byte unchanged → ordinal authoritative → resolves to the
        // same-ordinal occurrence.
        match resolve_live_token(&stored, &fresh) {
            TokenResolution::Resolved { token_index } => {
                assert_eq!(fresh.tokens[token_index].occurrence_ordinal, 1);
            }
            other => panic!("expected Resolved, got {other:?}"),
        }
    }

    #[test]
    fn unique_token_with_edited_line_fails_closed() {
        // A single occurrence, but its own line was edited (anchor changed) and
        // the file changed (fingerprint differs). Fail closed rather than risk a
        // wrong strike — the watcher refreshes the index within ~1s, so this only
        // bites an edit-then-remove within the same sub-second window.
        let stored = stored_from("task @2026-06-06_0900 here", 0);
        let fresh = scan(b"task @2026-06-06_0900 here and now annotated").unwrap();
        assert_eq!(
            resolve_live_token(&stored, &fresh),
            TokenResolution::Ambiguous
        );
    }

    #[test]
    fn edit_elsewhere_in_file_still_resolves() {
        // Editing text on *other* lines changes the fingerprint but not the
        // token's containing-line anchor → still resolves (anchor match).
        let stored = stored_from("intro\nmeet @2026-07-07_0800 x\noutro", 0);
        let fresh = scan(b"INTRO changed a lot\nmeet @2026-07-07_0800 x\noutro too").unwrap();
        assert!(matches!(
            resolve_live_token(&stored, &fresh),
            TokenResolution::Resolved { .. }
        ));
        // (sanity) the fingerprint really did change.
        assert_ne!(fresh.scan_fingerprint, stored.scan_fingerprint);
    }
}

//! Duplicate-aware index merge / state migration: carries mutable reminder
//! state (`state`, snooze override `fireAtMs`, `lastNotifiedMs`) from a prior
//! index into a freshly scanned reminder set. Rules are LOCKED in the plan's
//! *Index merge / state migration* section and ADR §4 — this is the single
//! place that implements them; Phase 4's write-time resolver mirrors the
//! same duplicate-safety primitives (`contextAnchor`, `scanFingerprint`,
//! `occurrenceOrdinal`) but is a separate concern (merge carries state across
//! a rescan; write resolves a live span to strike).
//!
//! Safety budget: when duplicate identical tokens make identity uncertain,
//! prefer a clean re-derivation (drop the old state, keep the fresh
//! `scheduled` baseline) over attaching state to the wrong line. **No prior
//! entry's state is ever attached to more than one fresh candidate, and no
//! fresh candidate ever receives state from more than one prior entry.**

use std::collections::HashMap;

use crate::index::{Reminder, ReminderState};

/// Merges `prior`'s mutable state into `fresh`.
///
/// `fresh` must already be a complete, freshly scanned reminder set (e.g.
/// built via [`crate::fresh_reminder_from_scan`]) with the default
/// `Scheduled` baseline and no carried state. Returns a new vector — same
/// set, order, and scan-derived fields as `fresh` — where `state`/
/// `fire_at_ms`/`last_notified_ms` are overwritten with carried-forward
/// values wherever the merge rules deem it safe; otherwise the fresh
/// baseline stands (the reminder is treated as newly discovered).
///
/// Rules (see plan §*Index merge / state migration*):
/// 0. Classify each content key (`noteUri` + `normalizedTokenText`) as
///    duplicate (count > 1 on either side) or non-duplicate first.
/// 1. Non-duplicate content key + exact `id` match in `fresh` → blind carry
///    (the common case: a unique token, including edit-elsewhere).
/// 2. Duplicate content key → exact `id` match is **not** sufficient alone.
///    Migrate only when:
///    - exactly one live candidate (same content key) shares the prior
///      entry's `contextAnchor` (rule 4), or
///    - the recomputed `scanFingerprint` proves the file is byte-for-byte
///      unchanged, in which case `occurrenceOrdinal` is still authoritative
///      and selects the candidate (rule 5; `len`/`mtime` are never proof —
///      this function only ever sees the recomputed fingerprint, which the
///      caller must have computed from the actual bytes, not cached stat
///      metadata).
/// 6. Otherwise ambiguous → do not migrate; the affected candidates are
///    recomputed fresh (default state), never attached to a mismatched line.
pub fn merge_reminders(prior: &[Reminder], fresh: Vec<Reminder>) -> Vec<Reminder> {
    let prior_counts = content_key_counts(prior);
    let fresh_counts = content_key_counts(&fresh);
    let is_duplicate_key = |key: &(String, String)| -> bool {
        prior_counts.get(key).copied().unwrap_or(0) > 1 || fresh_counts.get(key).copied().unwrap_or(0) > 1
    };

    let mut by_id: HashMap<&str, usize> = HashMap::with_capacity(fresh.len());
    for (i, r) in fresh.iter().enumerate() {
        by_id.insert(r.id.as_str(), i);
    }

    let mut carried: Vec<Option<CarriedState>> = vec![None; fresh.len()];

    for prior_entry in prior {
        let key = content_key(prior_entry);
        if !is_duplicate_key(&key) {
            // Rule 1: exact-id carry, non-duplicate content keys only. If the
            // id is absent the token is gone (a unique occurrence's ordinal
            // can't drift), so there is nothing to carry to.
            if let Some(&idx) = by_id.get(prior_entry.id.as_str()) {
                attach_once(&mut carried, idx, prior_entry);
            }
            continue;
        }

        // Rules 2-6: duplicate content key.
        let candidates: Vec<usize> = fresh
            .iter()
            .enumerate()
            .filter(|(_, r)| content_key(r) == key)
            .map(|(i, _)| i)
            .collect();

        let anchor_matches: Vec<usize> = candidates
            .iter()
            .copied()
            .filter(|&i| fresh[i].context_anchor == prior_entry.context_anchor)
            .collect();

        if anchor_matches.len() == 1 {
            attach_once(&mut carried, anchor_matches[0], prior_entry);
            continue;
        }

        // Anchor does not uniquely separate the duplicates. Ordinal is
        // trusted only when the file is provably unchanged: the recomputed
        // content hash (carried on every fresh candidate, since it is a
        // per-file fingerprint) equals the prior entry's `scanFingerprint`.
        let file_unchanged = candidates
            .first()
            .map(|&i| fresh[i].scan_fingerprint == prior_entry.scan_fingerprint)
            .unwrap_or(false);
        if file_unchanged {
            if let Some(&idx) = candidates
                .iter()
                .find(|&&i| fresh[i].occurrence_ordinal == prior_entry.occurrence_ordinal)
            {
                attach_once(&mut carried, idx, prior_entry);
                continue;
            }
        }

        // Rule 6: ambiguous → fail safe. Do not migrate; affected candidates
        // keep their fresh `scheduled` baseline (recomputed as new).
    }

    fresh
        .into_iter()
        .zip(carried)
        .map(|(mut reminder, carry)| {
            if let Some(state) = carry {
                reminder.state = state.state;
                reminder.fire_at_ms = state.fire_at_ms;
                reminder.last_notified_ms = state.last_notified_ms;
            }
            reminder
        })
        .collect()
}

#[derive(Debug, Clone)]
struct CarriedState {
    state: ReminderState,
    fire_at_ms: i64,
    last_notified_ms: Option<i64>,
}

impl From<&Reminder> for CarriedState {
    fn from(reminder: &Reminder) -> Self {
        Self {
            state: reminder.state,
            fire_at_ms: reminder.fire_at_ms,
            last_notified_ms: reminder.last_notified_ms,
        }
    }
}

fn content_key(reminder: &Reminder) -> (String, String) {
    (reminder.note_uri.clone(), reminder.normalized_token_text.clone())
}

fn content_key_counts(reminders: &[Reminder]) -> HashMap<(String, String), u32> {
    let mut counts = HashMap::new();
    for reminder in reminders {
        *counts.entry(content_key(reminder)).or_insert(0) += 1;
    }
    counts
}

/// Attaches carried state to fresh slot `idx` unless something already claimed
/// it. This should be unreachable under the uniqueness guarantees above (each
/// prior entry resolves to at most one candidate, and a unique-anchor /
/// unique-ordinal match cannot be shared) — kept as a defensive last line so
/// that, even in a pathological identical-prior-entries edge case, state never
/// double-attaches or bounces between candidates; first-claim wins
/// deterministically (document order) rather than silently overwriting.
fn attach_once(carried: &mut [Option<CarriedState>], idx: usize, prior_entry: &Reminder) {
    if carried[idx].is_none() {
        carried[idx] = Some(CarriedState::from(prior_entry));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::index::{fresh_reminder_from_scan, DefaultTime, ReminderState, UiCaretHint};
    use crate::scanner::scan;

    const NOTE_URI: &str = "note://notes/today.md";
    const PATH: &str = "notes/today.md";

    fn fresh_set(text: &str) -> Vec<Reminder> {
        let out = scan(text.as_bytes()).expect("valid utf8");
        out.tokens
            .iter()
            .map(|token| {
                fresh_reminder_from_scan(
                    PATH,
                    NOTE_URI,
                    token,
                    &out.scan_fingerprint,
                    DefaultTime::DEFAULT_NINE_AM,
                    5,
                )
                .expect("resolvable due date")
            })
            .collect()
    }

    fn snoozed(mut reminder: Reminder, fire_at_ms: i64, last_notified_ms: i64) -> Reminder {
        reminder.state = ReminderState::Notified;
        reminder.fire_at_ms = fire_at_ms;
        reminder.last_notified_ms = Some(last_notified_ms);
        reminder
    }

    fn find<'a>(reminders: &'a [Reminder], normalized_token_text: &str, occurrence_ordinal: u32) -> &'a Reminder {
        reminders
            .iter()
            .find(|r| r.normalized_token_text == normalized_token_text && r.occurrence_ordinal == occurrence_ordinal)
            .expect("candidate present")
    }

    #[test]
    fn exact_id_carry_for_non_duplicate_edit_elsewhere() {
        let prior = fresh_set("intro\n@2026-06-06_0900 unique\noutro");
        let prior = vec![snoozed(prior[0].clone(), 1_000, 900)];

        let fresh = fresh_set("INTRO changed\n@2026-06-06_0900 unique\noutro changed too");
        let merged = merge_reminders(&prior, fresh);

        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].id, prior[0].id, "id is offset-independent across unrelated edits");
        assert_eq!(merged[0].state, ReminderState::Notified);
        assert_eq!(merged[0].fire_at_ms, 1_000);
        assert_eq!(merged[0].last_notified_ms, Some(900));
    }

    #[test]
    fn b_unique_anchor_migrates_snooze_after_ordinal_shift() {
        // Two identical tokens with distinct surrounding lines. Snooze the
        // second (ordinal 1), then insert an identical token above both so
        // every ordinal shifts and every id changes.
        let prior_set = fresh_set("alpha @2026-01-01 here\nbeta @2026-01-01 there");
        let target = find(&prior_set, "@2026-01-01", 1);
        assert_eq!(target.context_anchor, find(&prior_set, "@2026-01-01", 1).context_anchor);
        let prior = vec![snoozed(target.clone(), 5_000, 4_000)];

        let fresh = fresh_set("gamma @2026-01-01 inserted\nalpha @2026-01-01 here\nbeta @2026-01-01 there");
        let merged = merge_reminders(&prior, fresh);

        // The "beta ... there" line's reminder carries the snooze, even
        // though its ordinal/id changed (1 -> 2).
        let migrated = find(&merged, "@2026-01-01", 2);
        assert_eq!(migrated.context_anchor, prior[0].context_anchor);
        assert_eq!(migrated.state, ReminderState::Notified);
        assert_eq!(migrated.fire_at_ms, 5_000);
        assert_eq!(migrated.last_notified_ms, Some(4_000));
        assert_ne!(migrated.id, prior[0].id, "ordinal shifted, so identity changed");

        // Nothing landed on the newly inserted line or the unrelated "alpha" line.
        assert_eq!(find(&merged, "@2026-01-01", 0).state, ReminderState::Scheduled);
        assert_eq!(find(&merged, "@2026-01-01", 1).state, ReminderState::Scheduled);
    }

    #[test]
    fn b_prime_exact_id_carry_is_gated_for_duplicates_with_surviving_old_id() {
        // Ordinal-0 duplicate has a snooze. Insert an identical token above
        // it: the *old* ordinal-0 id now belongs to the newly inserted line
        // (a fresh scan mints that id for whatever sits at ordinal 0 now).
        // The blind exact-id carry must NOT fire for this duplicate content
        // key — the snooze must migrate only by unique contextAnchor to the
        // original line's new id, never landing on the inserted line.
        let prior_set = fresh_set("first @2026-03-03 line\nsecond @2026-03-03 line");
        let original = find(&prior_set, "@2026-03-03", 0).clone();
        let old_ordinal_zero_id = original.id.clone();
        let prior = vec![snoozed(original.clone(), 9_000, 8_000)];

        let fresh = fresh_set("inserted @2026-03-03 line\nfirst @2026-03-03 line\nsecond @2026-03-03 line");
        // Confirm the hazard: the old id now belongs to the inserted line.
        assert_eq!(find(&fresh, "@2026-03-03", 0).id, old_ordinal_zero_id);
        assert_ne!(find(&fresh, "@2026-03-03", 0).context_anchor, original.context_anchor);

        let merged = merge_reminders(&prior, fresh);

        let inserted = find(&merged, "@2026-03-03", 0);
        assert_eq!(inserted.id, old_ordinal_zero_id);
        assert_eq!(inserted.state, ReminderState::Scheduled, "no state lands on the newly inserted line");
        assert_eq!(inserted.last_notified_ms, None);

        let migrated = find(&merged, "@2026-03-03", 1);
        assert_eq!(migrated.context_anchor, original.context_anchor);
        assert_eq!(migrated.state, ReminderState::Notified);
        assert_eq!(migrated.fire_at_ms, 9_000);
        assert_eq!(migrated.last_notified_ms, Some(8_000));
    }

    #[test]
    fn c_identical_context_with_changed_fingerprint_recomputes_fresh() {
        // Both duplicates live on byte-identical lines, so contextAnchor
        // cannot separate them. An edit changes duplicateCount/fingerprint,
        // so the ordinal cannot be trusted either: nothing migrates.
        let prior_set = fresh_set("- @2026-04-04 task\n- @2026-04-04 task");
        assert_eq!(prior_set[0].context_anchor, prior_set[1].context_anchor);
        let prior = vec![
            snoozed(prior_set[0].clone(), 1_111, 1_000),
            snoozed(prior_set[1].clone(), 2_222, 2_000),
        ];

        // Different duplicate count after the edit (three identical lines now).
        let fresh = fresh_set("- @2026-04-04 task\n- @2026-04-04 task\n- @2026-04-04 task");
        assert_ne!(fresh[0].scan_fingerprint, prior[0].scan_fingerprint);

        let merged = merge_reminders(&prior, fresh);
        for reminder in &merged {
            assert_eq!(reminder.state, ReminderState::Scheduled, "fresh baseline, no migrated state");
            assert_eq!(reminder.last_notified_ms, None);
        }
    }

    #[test]
    fn d_ordinal_migration_only_when_fingerprint_proves_unchanged() {
        // Identical-context duplicates, file genuinely byte-for-byte
        // unchanged: the ordinal is authoritative and both snoozes migrate
        // to their same-ordinal counterparts (ids stay stable too, since
        // nothing changed).
        let text = "- @2026-05-05 task\n- @2026-05-05 task";
        let prior_set = fresh_set(text);
        let prior = vec![
            snoozed(prior_set[0].clone(), 1_111, 1_000),
            snoozed(prior_set[1].clone(), 2_222, 2_000),
        ];

        let fresh = fresh_set(text);
        assert_eq!(fresh[0].scan_fingerprint, prior[0].scan_fingerprint);

        let merged = merge_reminders(&prior, fresh);
        assert_eq!(find(&merged, "@2026-05-05", 0).fire_at_ms, 1_111);
        assert_eq!(find(&merged, "@2026-05-05", 0).last_notified_ms, Some(1_000));
        assert_eq!(find(&merged, "@2026-05-05", 1).fire_at_ms, 2_222);
        assert_eq!(find(&merged, "@2026-05-05", 1).last_notified_ms, Some(2_000));
    }

    #[test]
    fn e_len_and_mtime_are_not_proof_only_content_hash_gates_ordinal_trust() {
        // Both versions keep byte-identical duplicate lines (contextAnchor
        // stays ambiguous on *both* sides, so anchor-based migration can
        // never fire here), and the edit ("task" -> "work") preserves length:
        // `len` is unchanged (the caller would also see a preserved `mtime`
        // in a real Syncthing/external-editor scenario), but the content hash
        // diverges. This function only ever receives the *recomputed*
        // fingerprint, so it must distrust the ordinal and fail safe —
        // proving content hash, not len/mtime, gates trust. (Trusting
        // length/ordinal alone would wrongly migrate both snoozes onto the
        // edited lines.)
        let before = "- @2026-07-07 task\n- @2026-07-07 task";
        let after = "- @2026-07-07 work\n- @2026-07-07 work";
        assert_eq!(before.len(), after.len());

        let prior_set = fresh_set(before);
        assert_eq!(prior_set[0].context_anchor, prior_set[1].context_anchor);
        let prior = vec![
            snoozed(prior_set[0].clone(), 1_111, 1_000),
            snoozed(prior_set[1].clone(), 2_222, 2_000),
        ];

        let fresh = fresh_set(after);
        assert_eq!(fresh[0].context_anchor, fresh[1].context_anchor, "still ambiguous on the fresh side");
        assert_ne!(fresh[0].context_anchor, prior[0].context_anchor, "the anchor itself changed with the edit");
        assert_ne!(fresh[0].scan_fingerprint, prior[0].scan_fingerprint, "content hash diverges despite equal length");

        let merged = merge_reminders(&prior, fresh);
        for reminder in &merged {
            assert_eq!(reminder.state, ReminderState::Scheduled);
            assert_eq!(reminder.last_notified_ms, None, "ordinal not trusted from len-only equality");
        }
    }

    #[test]
    fn no_state_ever_lands_on_a_different_normalized_token_text() {
        let prior = fresh_set("@2026-08-08_0900 only");
        let prior = vec![snoozed(prior[0].clone(), 42, 41)];

        // Token text edited (a different time) — a brand new reminder, not a
        // migration target.
        let fresh = fresh_set("@2026-08-08_1000 only");
        let merged = merge_reminders(&prior, fresh);

        assert_eq!(merged.len(), 1);
        assert_ne!(merged[0].id, prior[0].id);
        assert_eq!(merged[0].state, ReminderState::Scheduled);
        assert_eq!(merged[0].last_notified_ms, None);
    }

    #[test]
    fn deleted_token_carries_nothing_forward() {
        let prior = fresh_set("@2026-09-09_0900 gone");
        let prior = vec![snoozed(prior[0].clone(), 42, 41)];

        let fresh = fresh_set("nothing here anymore");
        let merged = merge_reminders(&prior, fresh);
        assert!(merged.is_empty());
    }

    #[test]
    fn caret_hint_and_byte_spans_always_come_from_the_fresh_scan_not_prior() {
        let prior_set = fresh_set("@2026-10-10_0900 here");
        let mut stale_prior = prior_set[0].clone();
        stale_prior.token_byte_from = 999;
        stale_prior.token_byte_to = 1099;
        stale_prior.ui_caret_hint = Some(UiCaretHint { utf16_offset: 999 });
        let prior = vec![snoozed(stale_prior, 1, 1)];

        let fresh = fresh_set("prefixed text changes byte offsets\n@2026-10-10_0900 here");
        let expected_from = fresh[0].token_byte_from;
        let expected_to = fresh[0].token_byte_to;
        let expected_hint = fresh[0].ui_caret_hint;

        let merged = merge_reminders(&prior, fresh);
        assert_eq!(merged[0].token_byte_from, expected_from);
        assert_eq!(merged[0].token_byte_to, expected_to);
        assert_eq!(merged[0].ui_caret_hint, expected_hint);
    }
}

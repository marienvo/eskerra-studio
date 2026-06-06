//! Phase 4 strikethrough write-back: the daemon is the **sole** writer of the
//! `@token` → `@~~token~~` mutation. Governed by the LOCKED *Write-back safety
//! rules* (plan §Phase 4) and ADR §8 — fail closed everywhere:
//!
//! - **Per-note write lock** (rule 0): all writes to one note serialize through
//!   a keyed mutex held continuously across re-read → re-scan → resolve →
//!   byte-verify → temp write → atomic rename → index update (the index update
//!   runs in the caller's `record` closure, still under the lock). Removes to
//!   **different** notes never block each other; removes to the **same** note run
//!   sequentially, so the second re-reads the first's on-disk strikethrough and
//!   no logical update is lost.
//! - **Resolve by index lookup + `contextAnchor`** (rules 1–2) via
//!   [`eskerra_reminder_core::resolve_live_token`]; the ordinal is trusted only
//!   when the recomputed content hash matches the stored `scanFingerprint`.
//! - **Zero-match → `removed`** (success-equivalent, no write); **any
//!   ambiguity / byte mismatch / non-UTF-8 / IO error → `stale`** (no write)
//!   (rules 3–4, 7).
//! - **Byte-preserving minimal edit + atomic temp+rename** (rules 5–6): only the
//!   token's byte slice changes; every other byte — preceding/following
//!   multi-byte UTF-8, line endings, BOM, final-newline state — is preserved.
//!
//! The pure resolution lives in the shared core ([`resolve_live_token`]); this
//! module owns only the I/O + locking + byte edit, so the same resolver also
//! backs Phase 5 click-to-open.

use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};

use eskerra_reminder_core::{resolve_live_token, scan, write_atomic, Reminder, TokenResolution};

/// Result of a single `RemoveReminder` write-back — the locked IPC result space
/// (`removed` | `stale`). `remove-unavailable` is an **app-side** transport
/// failure state and is never produced here (ADR §8).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RemoveResult {
    /// The token resolved to exactly one live span and was struck, **or** it was
    /// already gone (struck/edited/deleted/missing file) — a zero-match
    /// success-equivalent. The reminder is dropped from the index.
    Removed,
    /// The daemon received the request but refused to write safely: ambiguous
    /// duplicate resolution, byte mismatch at the resolved span, non-UTF-8, or an
    /// IO error. **No** write was performed; the reminder is marked `stale`.
    Stale,
}

impl RemoveResult {
    /// Wire string for the `dev.eskerra.Reminders1.RemoveReminder` OUT arg.
    pub fn as_ipc_str(self) -> &'static str {
        match self {
            RemoveResult::Removed => "removed",
            RemoveResult::Stale => "stale",
        }
    }
}

/// Keyed per-note write locks (rule 0). Keyed by the canonical vault-relative
/// path so path aliases/encodings for the same file share one lock; removes to
/// different notes acquire different locks and never block each other.
#[derive(Default)]
struct NoteLocks {
    locks: Mutex<HashMap<String, Arc<Mutex<()>>>>,
}

impl NoteLocks {
    /// The lock guarding writes to `key`, created on first use. The returned
    /// `Arc<Mutex<()>>` is locked by the caller for the critical section; the
    /// brief outer `Mutex` only guards the map, never a file write.
    fn for_note(&self, key: &str) -> Arc<Mutex<()>> {
        let mut map = self.locks.lock().unwrap_or_else(|poison| poison.into_inner());
        Arc::clone(
            map.entry(key.to_string())
                .or_insert_with(|| Arc::new(Mutex::new(()))),
        )
    }
}

/// Test-only hook invoked right after the per-note lock is acquired and before
/// the file is read, receiving the lock key. Lets concurrency tests widen the
/// locked critical section (sleep) or coordinate (barrier) deterministically.
type LockHook = Arc<dyn Fn(&str) + Send + Sync>;

/// The sole strikethrough writer. Shared via `Arc` between the OS-notification
/// `remove` action path and the `RemoveReminder` D-Bus service so both honor the
/// **same** per-note lock — the single-writer invariant is exclusivity across
/// processes *and* serialization-per-note within the daemon.
pub struct Remover {
    locks: NoteLocks,
    on_locked: Option<LockHook>,
}

impl Default for Remover {
    fn default() -> Self {
        Self::new()
    }
}

impl Remover {
    pub fn new() -> Self {
        Self {
            locks: NoteLocks::default(),
            on_locked: None,
        }
    }

    /// Strike the token for `stored` in the note at `note_abs_path`, serialized
    /// by the per-note lock keyed on `lock_key` (the canonical vault-relative
    /// path). `record` runs **while the lock is still held** (rule 0: the index
    /// update is part of the locked critical section) with the decided result,
    /// just before the lock is released. Returns the same result.
    pub fn remove<F: FnOnce(RemoveResult)>(
        &self,
        note_abs_path: &Path,
        lock_key: &str,
        stored: &Reminder,
        record: F,
    ) -> RemoveResult {
        let note_lock = self.locks.for_note(lock_key);
        let _guard = note_lock.lock().unwrap_or_else(|poison| poison.into_inner());
        if let Some(hook) = &self.on_locked {
            hook(lock_key);
        }
        let result = resolve_and_strike(note_abs_path, stored);
        // Still under `_guard`: a concurrent same-note remove cannot interleave
        // its re-read between this write and this outcome being recorded.
        record(result);
        result
    }
}

/// Re-read → re-scan → resolve → byte-verify → strike → atomic write for one
/// note. Caller holds the per-note lock. Pure-of-locking; only touches this one
/// file.
fn resolve_and_strike(note_abs_path: &Path, stored: &Reminder) -> RemoveResult {
    let bytes = match std::fs::read(note_abs_path) {
        Ok(bytes) => bytes,
        // The note was deleted → the token (and reminder) is gone: a
        // success-equivalent zero-match, not an error.
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return RemoveResult::Removed,
        // Any other read error → cannot resolve safely → fail closed.
        Err(_) => return RemoveResult::Stale,
    };

    // Non-UTF-8 → the scanner yields nothing and byte boundaries can't be
    // trusted → fail closed rather than guess.
    let Some(out) = scan(&bytes) else {
        return RemoveResult::Stale;
    };

    let token_index = match resolve_live_token(stored, &out) {
        // Already struck/edited/deleted → removed, no write.
        TokenResolution::Gone => return RemoveResult::Removed,
        // Any residual ambiguity → fail closed, write nothing.
        TokenResolution::Ambiguous => return RemoveResult::Stale,
        TokenResolution::Resolved { token_index } => token_index,
    };

    let token = &out.tokens[token_index];
    let (from, to) = (token.token_byte_from, token.token_byte_to);

    // Rule 4: verify the bytes at the resolved span are exactly the expected
    // token, using the **byte span only** (never a char offset — in UTF-8 those
    // diverge whenever non-ASCII precedes the token). Defensive: a fresh scan
    // guarantees this, so a mismatch means drift/corruption → fail closed.
    let slice = &bytes[from..to];
    if slice != stored.normalized_token_text.as_bytes() {
        return RemoveResult::Stale;
    }
    // The grammar is ASCII, so the verified slice is valid UTF-8.
    let Ok(token_str) = std::str::from_utf8(slice) else {
        return RemoveResult::Stale;
    };

    let struck = struck_form(token_str);
    let new_bytes = splice(&bytes, from, to, struck.as_bytes());

    match write_atomic(note_abs_path, &new_bytes) {
        Ok(()) => RemoveResult::Removed,
        Err(_) => RemoveResult::Stale,
    }
}

/// `@2026-11-27_2300` → `@~~2026-11-27_2300~~`: insert `~~` after the leading
/// `@` and append `~~`, so the grammar no longer recognizes it (struck tokens
/// never match). `token` is the exact verified token slice (always starts `@`).
fn struck_form(token: &str) -> String {
    debug_assert!(token.starts_with('@'));
    format!("@~~{}~~", &token[1..])
}

/// Replace `bytes[from..to]` with `replacement`, preserving every other byte
/// exactly (rule 5: byte-preserving minimal edit — no reformatting / no
/// re-serialization of the document).
fn splice(bytes: &[u8], from: usize, to: usize, replacement: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(bytes.len() - (to - from) + replacement.len());
    out.extend_from_slice(&bytes[..from]);
    out.extend_from_slice(replacement);
    out.extend_from_slice(&bytes[to..]);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use eskerra_reminder_core::{fresh_reminder_from_scan, DefaultTime};
    use std::path::PathBuf;
    use std::sync::mpsc;
    use std::time::Duration;

    /// Build a stored index entry for the token at `ordinal` in `text`.
    fn stored_from(text: &str, ordinal: u32) -> Reminder {
        let out = scan(text.as_bytes()).expect("utf8");
        let token = out
            .tokens
            .iter()
            .find(|t| t.occurrence_ordinal == ordinal)
            .expect("token at ordinal");
        fresh_reminder_from_scan(
            "Inbox/n.md",
            "file:///Inbox/n.md",
            token,
            &out.scan_fingerprint,
            DefaultTime::DEFAULT_NINE_AM,
            5,
        )
        .expect("resolvable")
    }

    fn write(path: &Path, body: &str) {
        std::fs::write(path, body).unwrap();
    }

    fn with_lock_hook(hook: LockHook) -> Remover {
        Remover {
            locks: NoteLocks::default(),
            on_locked: Some(hook),
        }
    }

    #[test]
    fn strikes_only_the_token_bytes_with_non_ascii_intact() {
        // Multi-byte UTF-8 before the token (prior line + same line): the edit
        // must replace exactly the token's byte span and leave every other byte
        // untouched — proving byte spans, not char offsets, drive the write.
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("n.md");
        let body = "🎉 héllo wörld\ncafé☕ @2026-11-27_0930 end\ntail 🚀";
        write(&path, body);
        let stored = stored_from(body, 0);

        let result = Remover::new().remove(&path, "Inbox/n.md", &stored, |_| {});
        assert_eq!(result, RemoveResult::Removed);

        let after = std::fs::read_to_string(&path).unwrap();
        assert_eq!(
            after,
            "🎉 héllo wörld\ncafé☕ @~~2026-11-27_0930~~ end\ntail 🚀"
        );
    }

    #[test]
    fn already_struck_token_is_removed_without_writing() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("n.md");
        // On disk the token is already struck; the stored entry still points at
        // the live form. Zero-match → removed, no write.
        write(&path, "done: @~~2026-11-27_0930~~ ok");
        let before = std::fs::read(&path).unwrap();
        let stored = stored_from("done: @2026-11-27_0930 ok", 0);

        let result = Remover::new().remove(&path, "Inbox/n.md", &stored, |_| {});
        assert_eq!(result, RemoveResult::Removed);
        assert_eq!(std::fs::read(&path).unwrap(), before, "no write on zero-match");
    }

    #[test]
    fn missing_file_is_removed() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("gone.md");
        let stored = stored_from("@2026-11-27_0930", 0);
        let result = Remover::new().remove(&path, "Inbox/gone.md", &stored, |_| {});
        assert_eq!(result, RemoveResult::Removed);
    }

    #[test]
    fn non_utf8_file_is_stale_without_writing() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("n.md");
        std::fs::write(&path, [0x40u8, 0xFF, 0xFE]).unwrap();
        let before = std::fs::read(&path).unwrap();
        let stored = stored_from("@2026-11-27_0930", 0);

        let result = Remover::new().remove(&path, "Inbox/n.md", &stored, |_| {});
        assert_eq!(result, RemoveResult::Stale);
        assert_eq!(std::fs::read(&path).unwrap(), before);
    }

    #[test]
    fn ambiguous_duplicate_is_stale_without_writing() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("n.md");
        // Stored entry was scanned against a 2-duplicate file; the note now has
        // three identical-context duplicates → anchor can't separate them and the
        // fingerprint changed → fail closed.
        let stored = stored_from("- @2026-04-04 t\n- @2026-04-04 t", 0);
        write(&path, "- @2026-04-04 t\n- @2026-04-04 t\n- @2026-04-04 t");
        let before = std::fs::read(&path).unwrap();

        let result = Remover::new().remove(&path, "Inbox/n.md", &stored, |_| {});
        assert_eq!(result, RemoveResult::Stale);
        assert_eq!(std::fs::read(&path).unwrap(), before, "no write on ambiguity");
    }

    #[test]
    fn record_runs_with_the_decided_result() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("n.md");
        write(&path, "@2026-11-27_0930");
        let stored = stored_from("@2026-11-27_0930", 0);

        let recorded = std::cell::Cell::new(None);
        let result = Remover::new().remove(&path, "Inbox/n.md", &stored, |r| {
            recorded.set(Some(r));
        });
        assert_eq!(result, RemoveResult::Removed);
        assert_eq!(recorded.get(), Some(RemoveResult::Removed));
    }

    // --- mandatory concurrency tests (Write-back safety rule 0) --------------

    #[test]
    fn concurrent_same_note_two_tokens_no_lost_update() {
        // Two distinct, non-struck tokens in one note; remove BOTH concurrently.
        // The per-note lock must serialize them so the second re-reads the
        // first's on-disk strikethrough and neither remove clobbers the other.
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("n.md");
        let body = "a @2026-01-01_0900 x\nb @2026-02-02_1000 y";
        write(&path, body);

        // The two tokens have distinct text, so build each stored entry from its
        // own scanned token.
        let out = scan(body.as_bytes()).unwrap();
        let stored_for = |idx: usize| {
            fresh_reminder_from_scan(
                "Inbox/n.md",
                "file:///Inbox/n.md",
                &out.tokens[idx],
                &out.scan_fingerprint,
                DefaultTime::DEFAULT_NINE_AM,
                5,
            )
            .unwrap()
        };
        let r0 = stored_for(0);
        let r1 = stored_for(1);

        // Sleep inside the lock to widen the lost-update window: without
        // serialization both removes would read the original bytes and the later
        // rename would clobber the earlier strikethrough.
        let remover = Arc::new(with_lock_hook(Arc::new(|_key: &str| {
            std::thread::sleep(Duration::from_millis(40));
        })));

        let (p, rem, a) = (path.clone(), Arc::clone(&remover), r0);
        let t0 = std::thread::spawn(move || rem.remove(&p, "Inbox/n.md", &a, |_| {}));
        let (p, rem, b) = (path.clone(), Arc::clone(&remover), r1);
        let t1 = std::thread::spawn(move || rem.remove(&p, "Inbox/n.md", &b, |_| {}));

        assert_eq!(t0.join().unwrap(), RemoveResult::Removed);
        assert_eq!(t1.join().unwrap(), RemoveResult::Removed);

        // Both strikethroughs survive; every other byte unchanged.
        let after = std::fs::read_to_string(&path).unwrap();
        assert_eq!(after, "a @~~2026-01-01_0900~~ x\nb @~~2026-02-02_1000~~ y");
    }

    #[test]
    fn different_notes_run_in_parallel() {
        // Two notes; each remove, once it holds its (different) note lock,
        // announces and waits at a 2-party barrier. Both can only pass the
        // barrier if they hold their locks *simultaneously* — which a per-note
        // lock allows and a single global lock would not (the second could never
        // acquire it, so its "locked" announce never arrives and the
        // recv_timeout below fails instead of the test hanging forever).
        let dir = tempfile::tempdir().unwrap();
        let path_a = dir.path().join("a.md");
        let path_b = dir.path().join("b.md");
        write(&path_a, "@2026-01-01_0900 a");
        write(&path_b, "@2026-02-02_1000 b");
        let ra = stored_from("@2026-01-01_0900 a", 0);
        let rb = stored_from("@2026-02-02_1000 b", 0);

        let (locked_tx, locked_rx) = mpsc::channel::<String>();
        let barrier = Arc::new(std::sync::Barrier::new(2));
        let hook = {
            let locked_tx = locked_tx.clone();
            let barrier = Arc::clone(&barrier);
            Arc::new(move |key: &str| {
                locked_tx.send(key.to_string()).unwrap();
                barrier.wait();
            })
        };
        let remover = Arc::new(with_lock_hook(hook));

        let (p, rem, r): (PathBuf, _, _) = (path_a.clone(), Arc::clone(&remover), ra);
        let ta = std::thread::spawn(move || rem.remove(&p, "a.md", &r, |_| {}));
        let (p, rem, r): (PathBuf, _, _) = (path_b.clone(), Arc::clone(&remover), rb);
        let tb = std::thread::spawn(move || rem.remove(&p, "b.md", &r, |_| {}));

        let first = locked_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("first note acquired its lock");
        let second = locked_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("second note acquired its lock while the first was held — per-note locks must not serialize across notes");
        assert_ne!(first, second);

        assert_eq!(ta.join().unwrap(), RemoveResult::Removed);
        assert_eq!(tb.join().unwrap(), RemoveResult::Removed);
        assert_eq!(
            std::fs::read_to_string(&path_a).unwrap(),
            "@~~2026-01-01_0900~~ a"
        );
        assert_eq!(
            std::fs::read_to_string(&path_b).unwrap(),
            "@~~2026-02-02_1000~~ b"
        );
    }

    #[test]
    fn per_note_locks_are_independent_across_notes() {
        // Directly exercise the keyed lock: different notes never contend; the
        // same note does.
        let locks = NoteLocks::default();
        let a = locks.for_note("Inbox/a.md");
        let held_a = a.lock().unwrap();

        let b = locks.for_note("Inbox/b.md");
        assert!(
            b.try_lock().is_ok(),
            "a different note's lock must be free while a.md is held"
        );

        let a_again = locks.for_note("Inbox/a.md");
        assert!(
            a_again.try_lock().is_err(),
            "the same note's lock must be contended while held"
        );
        drop(held_a);
        assert!(locks.for_note("Inbox/a.md").try_lock().is_ok());
    }

    #[test]
    fn struck_form_inserts_strikethrough_markers() {
        assert_eq!(struck_form("@2026-11-27_2300"), "@~~2026-11-27_2300~~");
        assert_eq!(struck_form("@2026-06-06"), "@~~2026-06-06~~");
    }

    #[test]
    fn ipc_strings_match_the_locked_contract() {
        assert_eq!(RemoveResult::Removed.as_ipc_str(), "removed");
        assert_eq!(RemoveResult::Stale.as_ipc_str(), "stale");
    }
}

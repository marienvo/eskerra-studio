//! Vault markdown search: eligibility helpers shared with the Tantivy index, and `vault_search_start`
//! which queries the indexed note corpus (see `vault_search_index.rs`).
//!
//! Eligibility rules must stay in lockstep with `packages/eskerra-core/src/vaultVisibility.ts`
//! and `vaultLayout.ts` (see unit tests and `specs/design/desktop-shell-patterns.md`).

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::vault::VaultRootState;
use crate::vault_search_index::VaultSearchIndexState;

/// Same marker as `SYNC_CONFLICT_MARKER` in `vaultLayout.ts`.
const SYNC_CONFLICT_MARKER: &str = "sync-conflict";
const MARKDOWN_EXTENSION: &str = ".md";
pub(crate) const MAX_FILE_BYTES: u64 = 524_288;
pub(crate) const SNIPPET_MAX_CHARS: usize = 160;
/// Minimum query length (Unicode scalars) for fuzzy word-level body/snippet matching helpers.
pub(crate) const FUZZY_MIN_QUERY_CHARS: usize = 3;
/// Only the first N Unicode scalars of a line are scanned for fuzzy word tokens.
pub(crate) const FUZZY_MAX_LINE_CHARS: usize = 2000;

/// Tracks the in-flight search cancel flag so a new `vault_search_start` can preempt the previous run.
#[derive(Clone, Default)]
pub struct VaultSearchSessionState {
    cancel: Arc<Mutex<Option<Arc<AtomicBool>>>>,
}

pub(crate) fn arm_new_search_token(state: &VaultSearchSessionState) -> Arc<AtomicBool> {
    let mut g = state.cancel.lock().unwrap();
    if let Some(old) = g.take() {
        old.store(true, Ordering::Release);
    }
    let token = Arc::new(AtomicBool::new(false));
    *g = Some(token.clone());
    token
}

pub(crate) fn clear_token_if_current(state: &VaultSearchSessionState, token: &Arc<AtomicBool>) {
    let mut g = state.cancel.lock().unwrap();
    match g.as_ref() {
        Some(cur) if Arc::ptr_eq(cur, token) => {
            *g = None;
        }
        _ => {}
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VaultSearchProgressDto {
    pub scanned_files: u32,
    pub total_hits: u32,
    pub skipped_large_files: u32,
    /// `ready` | `building` | `failed` | `idle` | `unavailable`
    pub index_status: String,
    pub index_ready: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VaultSearchUpdatePayload {
    pub search_id: String,
    pub notes: Vec<crate::vault_search_index::VaultSearchNoteResultDto>,
    pub progress: VaultSearchProgressDto,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VaultSearchDonePayload {
    pub search_id: String,
    pub cancelled: bool,
    pub progress: VaultSearchProgressDto,
}

// Vault-tree exclusion rules now live in the shared `eskerra-vault-watch` crate
// so the watcher, the app's walkers, and the daemon share one definition
// (Phase 2). Re-exported here so this module's existing call sites and the
// other modules importing `crate::vault_search::is_vault_tree_*` are unchanged.
pub(crate) use eskerra_vault_watch::{
    is_vault_tree_hard_excluded_directory_name, is_vault_tree_ignored_entry_name,
};

fn is_sync_conflict_file_name(name: &str) -> bool {
    name.to_lowercase().contains(SYNC_CONFLICT_MARKER)
}

pub(crate) fn is_eligible_vault_markdown_file_name(name: &str) -> bool {
    if !name.ends_with(MARKDOWN_EXTENSION) {
        return false;
    }
    if is_sync_conflict_file_name(name) {
        return false;
    }
    if is_vault_tree_ignored_entry_name(name) {
        return false;
    }
    true
}

pub(crate) fn max_edit_distance_for_query(query_len: usize) -> u32 {
    match query_len {
        0..=2 => 0,
        3..=5 => 1,
        _ => 2,
    }
}

pub(crate) fn bounded_levenshtein(a: &str, b: &str, max_dist: u32) -> Option<u32> {
    let max = max_dist as usize;
    let a_ch: Vec<char> = a.chars().collect();
    let b_ch: Vec<char> = b.chars().collect();
    let n = a_ch.len();
    let m = b_ch.len();
    if n == 0 {
        return (m <= max).then_some(m as u32);
    }
    if m == 0 {
        return (n <= max).then_some(n as u32);
    }
    if n.abs_diff(m) > max {
        return None;
    }

    let mut prev: Vec<usize> = (0..=m).collect();
    let mut curr = vec![0usize; m + 1];
    for i in 1..=n {
        curr[0] = i;
        for j in 1..=m {
            let cost = if a_ch[i - 1] == b_ch[j - 1] { 0 } else { 1 };
            curr[j] = (prev[j] + 1).min(curr[j - 1] + 1).min(prev[j - 1] + cost);
        }
        std::mem::swap(&mut prev, &mut curr);
    }
    let d = prev[m];
    (d <= max).then_some(d as u32)
}

pub(crate) fn trim_non_alphanumeric_edges(s: &str) -> &str {
    s.trim_matches(|c: char| !c.is_alphanumeric())
}

/// Word-level fuzzy helper (tests; snippet logic lives in `vault_search_index`).
#[cfg(test)]
pub(crate) fn fuzzy_word_match(line_lower: &str, query_lower: &str) -> Option<u32> {
    let q_len = query_lower.chars().count();
    if q_len < FUZZY_MIN_QUERY_CHARS {
        return None;
    }
    let max_dist = max_edit_distance_for_query(q_len);
    let scanned: String = line_lower.chars().take(FUZZY_MAX_LINE_CHARS).collect();
    let mut best: Option<u32> = None;
    for raw in scanned.split_whitespace() {
        let token = trim_non_alphanumeric_edges(raw);
        if token.is_empty() {
            continue;
        }
        let wlen = token.chars().count();
        if wlen.abs_diff(q_len) > max_dist as usize {
            continue;
        }
        if let Some(d) = bounded_levenshtein(token, query_lower, max_dist) {
            best = Some(best.map_or(d, |b| b.min(d)));
        }
    }
    best
}

pub(crate) fn path_to_note_uri(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

#[tauri::command]
pub fn vault_search_start(
    app: AppHandle,
    vault_state: State<'_, VaultRootState>,
    session: State<'_, VaultSearchSessionState>,
    index_state: State<'_, VaultSearchIndexState>,
    search_id: String,
    query: String,
    _worker_count: Option<u32>,
) -> Result<(), String> {
    let _vault_ok = vault_state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or_else(|| "no vault session; pick a folder first".to_string())?;

    let query_trim = query.trim();
    if query_trim.is_empty() {
        let st = crate::vault_search_index::index_status_string(&index_state);
        let ready = crate::vault_search_index::index_is_ready(&index_state);
        let _ = app.emit(
            "vault-search:done",
            VaultSearchDonePayload {
                search_id,
                cancelled: false,
                progress: VaultSearchProgressDto {
                    scanned_files: 0,
                    total_hits: 0,
                    skipped_large_files: 0,
                    index_status: st,
                    index_ready: ready,
                },
            },
        );
        return Ok(());
    }

    let token = arm_new_search_token(&session);
    let q_owned = query_trim.to_string();
    let session_for_thread = (*session).clone();
    let idx = (*index_state).clone();
    let app2 = app.clone();
    let sid = search_id.clone();

    thread::spawn(move || {
        let notes = crate::vault_search_index::run_indexed_search(&idx, q_owned.as_str(), 200)
            .unwrap_or_default();
        let ready = crate::vault_search_index::index_is_ready(&idx);
        let st = crate::vault_search_index::index_status_string(&idx);
        let n = notes.len() as u32;
        let progress = VaultSearchProgressDto {
            scanned_files: n,
            total_hits: n,
            skipped_large_files: 0,
            index_status: st.clone(),
            index_ready: ready,
        };

        if !token.load(Ordering::Acquire) {
            let _ = app2.emit(
                "vault-search:update",
                VaultSearchUpdatePayload {
                    search_id: sid.clone(),
                    notes,
                    progress: progress.clone(),
                },
            );
        }

        let cancelled_end = token.load(Ordering::Acquire);
        let _ = app2.emit(
            "vault-search:done",
            VaultSearchDonePayload {
                search_id: sid,
                cancelled: cancelled_end,
                progress,
            },
        );
        clear_token_if_current(&session_for_thread, &token);
    });

    Ok(())
}

#[tauri::command]
pub fn vault_search_cancel(session: State<'_, VaultSearchSessionState>) -> Result<(), String> {
    let mut g = session.cancel.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(tok) = g.take() {
        tok.store(true, Ordering::Release);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    fn trim_snippet(line: &str) -> String {
        line.trim().chars().take(SNIPPET_MAX_CHARS).collect()
    }

    fn collect_eligible_paths(dir: &Path, out: &mut Vec<PathBuf>) -> std::io::Result<()> {
        for entry in fs::read_dir(dir)? {
            let entry = entry?;
            let name = entry.file_name();
            let name_str = name.to_string_lossy();
            if is_vault_tree_ignored_entry_name(&name_str) {
                continue;
            }
            let path = entry.path();
            let file_type = entry.file_type()?;
            if file_type.is_dir() {
                if is_vault_tree_hard_excluded_directory_name(&name_str) {
                    continue;
                }
                collect_eligible_paths(&path, out)?;
            } else if file_type.is_file() && is_eligible_vault_markdown_file_name(&name_str) {
                out.push(path);
            }
        }
        Ok(())
    }

    #[test]
    fn eligibility_matches_vault_visibility_rules() {
        assert!(is_eligible_vault_markdown_file_name("Note.md"));
        assert!(!is_eligible_vault_markdown_file_name("Note.txt"));
        assert!(!is_eligible_vault_markdown_file_name(".Note.md"));
        assert!(is_eligible_vault_markdown_file_name("_Note.md"));
        assert!(!is_eligible_vault_markdown_file_name(
            "Note sync-conflict-abc.md"
        ));
    }

    #[test]
    fn walk_skips_dot_hidden_and_assets_tree() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("ok.md"), "").unwrap();
        fs::write(tmp.path().join("_underscore.md"), "").unwrap();
        fs::write(tmp.path().join(".hide.md"), "").unwrap();
        fs::create_dir_all(tmp.path().join("Assets")).unwrap();
        fs::write(tmp.path().join("Assets/nope.md"), "").unwrap();
        let mut paths = Vec::new();
        collect_eligible_paths(tmp.path(), &mut paths).unwrap();
        assert_eq!(paths.len(), 2);
        assert!(paths.iter().any(|p| p.ends_with("ok.md")));
        assert!(paths.iter().any(|p| p.ends_with("_underscore.md")));
    }

    #[test]
    fn trim_snippet_max_length() {
        let long: String = (0..300).map(|_| 'β').collect();
        let out = trim_snippet(&format!("  {long}  "));
        assert_eq!(out.chars().count(), SNIPPET_MAX_CHARS);
    }

    #[test]
    fn fuzzy_word_match_rejects_short_query() {
        assert_eq!(fuzzy_word_match("hello world", "he"), None);
    }

    #[test]
    fn fuzzy_word_match_finds_typo_in_word() {
        assert!(fuzzy_word_match("the big project here", "projct").is_some());
    }

    #[test]
    fn fuzzy_word_match_rejects_no_close_token() {
        assert_eq!(fuzzy_word_match("a big cat", "abc"), None);
    }

    #[test]
    fn fuzzy_word_match_lisane_finds_lisanne() {
        assert!(fuzzy_word_match("standup with lisanne today", "lisane").is_some());
    }

    #[test]
    fn fuzzy_word_match_lisane_rejects_lijstje_prose_line() {
        let line =
            "[[lijstje tech tickets waar be ook aan kan werken]] (be maakt tickets later aan)";
        assert_eq!(fuzzy_word_match(&line.to_lowercase(), "lisane"), None);
    }

    #[test]
    fn fuzzy_word_match_strips_markdown_punctuation_around_word() {
        assert!(fuzzy_word_match("see **lisanne** today", "lisane").is_some());
    }

    #[test]
    fn bounded_levenshtein_respects_max() {
        assert_eq!(bounded_levenshtein("abc", "xyz", 1), None);
        assert_eq!(bounded_levenshtein("project", "projct", 2), Some(1));
    }
}

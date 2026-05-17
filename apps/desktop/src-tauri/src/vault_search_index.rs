//! Persistent Tantivy index for note-first vault search (one document per markdown note).
//! Eligibility rules must match [`crate::vault_search`] / `vaultVisibility.ts`.

use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::thread;

use serde::Serialize;
use tantivy::collector::TopDocs;
use tantivy::directory::MmapDirectory;
use tantivy::query::{BooleanQuery, BoostQuery, FuzzyTermQuery, Occur, Query, QueryParser};
use tantivy::schema::{IndexRecordOption, Schema, Term, TextFieldIndexing, TextOptions, Value};
use tantivy::{doc, Index, IndexReader, TantivyDocument};
use tauri::{AppHandle, Emitter, Manager};

use crate::vault::VaultRootState;
use crate::vault_search::{
    bounded_levenshtein, is_eligible_vault_markdown_file_name,
    is_vault_tree_hard_excluded_directory_name, is_vault_tree_ignored_entry_name,
    max_edit_distance_for_query, path_to_note_uri, trim_non_alphanumeric_edges,
    FUZZY_MAX_LINE_CHARS, FUZZY_MIN_QUERY_CHARS, MAX_FILE_BYTES, SNIPPET_MAX_CHARS,
};

const INDEX_WRITER_HEAP_MB: usize = 50;

/// Serialized index status for the UI.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum VaultSearchIndexStatusDto {
    Idle,
    Building,
    Ready,
    Failed,
}

#[derive(Clone)]
pub struct VaultSearchIndexState {
    inner: Arc<Mutex<VaultSearchIndexInner>>,
}

impl Default for VaultSearchIndexState {
    fn default() -> Self {
        Self {
            inner: Arc::new(Mutex::new(VaultSearchIndexInner {
                vault_root: None,
                index_dir: None,
                index: None,
                reader: None,
                status: VaultSearchIndexStatusDto::Idle,
                last_error: None,
            })),
        }
    }
}

struct VaultSearchIndexInner {
    vault_root: Option<PathBuf>,
    index_dir: Option<PathBuf>,
    index: Option<Index>,
    reader: Option<IndexReader>,
    status: VaultSearchIndexStatusDto,
    last_error: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VaultSearchNoteSnippetDto {
    #[serde(rename = "lineNumber")]
    pub line_number: u32,
    pub text: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum VaultSearchBestFieldDto {
    Title,
    Path,
    Body,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VaultSearchNoteResultDto {
    pub uri: String,
    pub relative_path: String,
    pub title: String,
    pub best_field: VaultSearchBestFieldDto,
    #[serde(rename = "matchCount")]
    pub match_count: u32,
    pub score: f32,
    pub snippets: Vec<VaultSearchNoteSnippetDto>,
}

fn vault_index_dir(app: &AppHandle, vault_root: &Path) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;
    let mut h = DefaultHasher::new();
    vault_root.to_string_lossy().hash(&mut h);
    let bucket = format!("{:016x}", h.finish());
    Ok(base.join("vault-search-index").join(bucket))
}

fn build_schema() -> (
    Schema,
    tantivy::schema::Field,
    tantivy::schema::Field,
    tantivy::schema::Field,
    tantivy::schema::Field,
    tantivy::schema::Field,
) {
    let mut b = Schema::builder();

    let uri_indexing = TextFieldIndexing::default()
        .set_tokenizer("raw")
        .set_index_option(IndexRecordOption::Basic);
    let uri_options = TextOptions::default()
        .set_indexing_options(uri_indexing)
        .set_stored();

    let text_indexing = TextFieldIndexing::default()
        .set_tokenizer("default")
        .set_index_option(IndexRecordOption::WithFreqsAndPositions);
    let text_options = TextOptions::default()
        .set_indexing_options(text_indexing)
        .set_stored();

    let f_uri = b.add_text_field("uri", uri_options);
    let f_title = b.add_text_field("title", text_options.clone());
    let f_filename = b.add_text_field("filename", text_options.clone());
    let f_rel_path = b.add_text_field("rel_path", text_options.clone());
    let f_body = b.add_text_field("body", text_options);

    (b.build(), f_uri, f_title, f_filename, f_rel_path, f_body)
}

fn walk_markdown_files(dir: &Path, out: &mut Vec<PathBuf>) -> io::Result<()> {
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
            walk_markdown_files(&path, out)?;
        } else if file_type.is_file() && is_eligible_vault_markdown_file_name(&name_str) {
            out.push(path);
        }
    }
    Ok(())
}

fn relative_path_str(vault_root: &Path, path: &Path) -> String {
    path.strip_prefix(vault_root)
        .unwrap_or(path)
        .to_string_lossy()
        .to_string()
}

fn trim_snippet_line(line: &str) -> String {
    line.trim().chars().take(SNIPPET_MAX_CHARS).collect()
}

fn fuzzy_dist_for_token_len(len: usize) -> u8 {
    match len {
        0..=2 => 0,
        3..=5 => 1,
        _ => 2,
    }
}

/// Stricter fuzzy distance for title / filename / `rel_path` in Tantivy (vs body), so weak matches
/// like `lisa` or `line` vs `lisane` do not score as strongly as `lisanne`.
fn fuzzy_dist_for_title_path_token(token_char_len: usize) -> u8 {
    let d = fuzzy_dist_for_token_len(token_char_len);
    if d == 0 {
        return 0;
    }
    if token_char_len >= 9 {
        d
    } else {
        1
    }
}

/// Max edit distance when classifying a note as title/path hit (stricter than body for short queries).
fn max_fuzzy_distance_title_path_classify(token_char_len: usize) -> u32 {
    if token_char_len >= 9 {
        max_edit_distance_for_query(token_char_len)
    } else {
        max_edit_distance_for_query(token_char_len).min(1)
    }
}

fn query_tokens(query: &str) -> Vec<String> {
    query
        .split_whitespace()
        .map(|s| s.to_lowercase())
        .filter(|s| !s.is_empty())
        .collect()
}

fn line_matches_query(line_lower: &str, tokens: &[String], full_query_lower: &str) -> bool {
    if !full_query_lower.is_empty() && line_lower.contains(full_query_lower) {
        return true;
    }
    for t in tokens {
        if t.len() < FUZZY_MIN_QUERY_CHARS {
            continue;
        }
        if line_lower.contains(t.as_str()) {
            return true;
        }
        let max_d = max_edit_distance_for_query(t.chars().count());
        let scanned: String = line_lower.chars().take(FUZZY_MAX_LINE_CHARS).collect();
        for raw in scanned.split_whitespace() {
            let w = trim_non_alphanumeric_edges(raw);
            if w.is_empty() {
                continue;
            }
            if w.chars().count().abs_diff(t.chars().count()) > max_d as usize {
                continue;
            }
            if bounded_levenshtein(w, t, max_d).is_some() {
                return true;
            }
        }
    }
    false
}

fn collect_snippets(
    body: &str,
    tokens: &[String],
    full_query_lower: &str,
) -> (Vec<VaultSearchNoteSnippetDto>, u32) {
    let mut snippets = Vec::new();
    let mut match_lines = 0u32;
    let mut line_number = 0u32;
    for line in body.lines() {
        line_number += 1;
        let line_lower = line.to_lowercase();
        if line_matches_query(&line_lower, tokens, full_query_lower) {
            match_lines += 1;
            if snippets.len() < 3 {
                snippets.push(VaultSearchNoteSnippetDto {
                    line_number,
                    text: trim_snippet_line(line),
                });
            }
        }
    }
    let mc = if match_lines > 0 { match_lines } else { 1 };
    (snippets, mc)
}

fn fuzzy_token_in_text_max(hay_lower: &str, token: &str, max_d: u32) -> bool {
    let tlen = token.chars().count();
    for raw in hay_lower.split_whitespace() {
        let w = trim_non_alphanumeric_edges(raw);
        if w.is_empty() {
            continue;
        }
        if w.chars().count().abs_diff(tlen) > max_d as usize {
            continue;
        }
        if bounded_levenshtein(w, token, max_d).is_some() {
            return true;
        }
    }
    false
}

fn classify_best_field(
    title_lower: &str,
    filename_lower: &str,
    rel_lower: &str,
    body_lower: &str,
    tokens: &[String],
    full_query_lower: &str,
) -> VaultSearchBestFieldDto {
    let title_hit = !full_query_lower.is_empty()
        && (title_lower.contains(full_query_lower)
            || tokens.iter().any(|t| {
                if t.len() < FUZZY_MIN_QUERY_CHARS {
                    return false;
                }
                let cap = max_fuzzy_distance_title_path_classify(t.chars().count());
                fuzzy_token_in_text_max(title_lower, t, cap)
            }));
    if title_hit {
        return VaultSearchBestFieldDto::Title;
    }
    let path_hit = filename_lower.contains(full_query_lower)
        || rel_lower.contains(full_query_lower)
        || tokens.iter().any(|t| {
            if t.len() < FUZZY_MIN_QUERY_CHARS {
                return false;
            }
            let cap = max_fuzzy_distance_title_path_classify(t.chars().count());
            fuzzy_token_in_text_max(filename_lower, t, cap)
                || fuzzy_token_in_text_max(rel_lower, t, cap)
        });
    if path_hit {
        return VaultSearchBestFieldDto::Path;
    }
    if body_lower.contains(full_query_lower)
        || tokens
            .iter()
            .any(|t| t.len() >= FUZZY_MIN_QUERY_CHARS && fuzzy_token_in_text(body_lower, t))
    {
        return VaultSearchBestFieldDto::Body;
    }
    VaultSearchBestFieldDto::Body
}

fn fuzzy_token_in_text(hay_lower: &str, token: &str) -> bool {
    let max_d = max_edit_distance_for_query(token.chars().count());
    for raw in hay_lower.split_whitespace() {
        let w = trim_non_alphanumeric_edges(raw);
        if w.is_empty() {
            continue;
        }
        if w.chars().count().abs_diff(token.chars().count()) > max_d as usize {
            continue;
        }
        if bounded_levenshtein(w, token, max_d).is_some() {
            return true;
        }
    }
    false
}

fn build_index_query(
    index: &Index,
    _schema: &Schema,
    f_title: tantivy::schema::Field,
    f_filename: tantivy::schema::Field,
    f_rel_path: tantivy::schema::Field,
    f_body: tantivy::schema::Field,
    query_trim: &str,
) -> Result<Box<dyn Query>, tantivy::TantivyError> {
    let fields = vec![f_title, f_filename, f_rel_path, f_body];
    let parser = QueryParser::for_index(index, fields);
    let main_q = parser.parse_query(query_trim)?;
    let mut clauses: Vec<(Occur, Box<dyn Query>)> = vec![(Occur::Should, main_q)];

    for token in query_tokens(query_trim) {
        if token.len() < FUZZY_MIN_QUERY_CHARS {
            continue;
        }
        let tlen = token.chars().count();
        let d_body = fuzzy_dist_for_token_len(tlen);
        let d_title_path = fuzzy_dist_for_title_path_token(tlen);
        if d_body == 0 && d_title_path == 0 {
            continue;
        }
        for (field, boost, d) in [
            (f_title, 5.0f32, d_title_path),
            (f_filename, 4.0f32, d_title_path),
            (f_rel_path, 3.5f32, d_title_path),
            (f_body, 1.2f32, d_body),
        ] {
            if d == 0 {
                continue;
            }
            let term = Term::from_field_text(field, &token);
            let fq: Box<dyn Query> = Box::new(FuzzyTermQuery::new(term, d, true));
            clauses.push((Occur::Should, Box::new(BoostQuery::new(fq, boost))));
        }
    }

    Ok(Box::new(BooleanQuery::from(clauses)))
}

/// Minimum Levenshtein distance from any query token to any whitespace word in `hay_lower`
/// (used for ranking). Uses standard per-query `max_edit_distance_for_query` caps.
fn min_edit_distance_to_query_tokens(hay_lower: &str, tokens: &[String]) -> Option<u32> {
    let mut best: Option<u32> = None;
    for t in tokens {
        if t.len() < FUZZY_MIN_QUERY_CHARS {
            continue;
        }
        let max_d = max_edit_distance_for_query(t.chars().count());
        let tlen = t.chars().count();
        for raw in hay_lower.split_whitespace() {
            let w = trim_non_alphanumeric_edges(raw);
            if w.is_empty() {
                continue;
            }
            if w.chars().count().abs_diff(tlen) > max_d as usize {
                continue;
            }
            if let Some(d) = bounded_levenshtein(w, t.as_str(), max_d) {
                best = Some(best.map_or(d, |b| b.min(d)));
            }
        }
    }
    best
}

fn min_edit_distance_to_query_tokens_prefix(
    hay_lower: &str,
    tokens: &[String],
    max_hay_chars: usize,
) -> Option<u32> {
    let prefix: String = hay_lower.chars().take(max_hay_chars).collect();
    min_edit_distance_to_query_tokens(&prefix, tokens)
}

fn rank_quality_boost(min_d: Option<u32>) -> f32 {
    match min_d {
        Some(0) => 5_000.0,
        Some(1) => 3_200.0,
        Some(2) => 1_400.0,
        Some(3) => 400.0,
        Some(_) => 100.0,
        None => 0.0,
    }
}

fn ranking_min_distance_for_field(
    best_field: VaultSearchBestFieldDto,
    title_lower: &str,
    filename_lower: &str,
    rel_lower: &str,
    body_lower: &str,
    tokens: &[String],
) -> Option<u32> {
    match best_field {
        VaultSearchBestFieldDto::Title => min_edit_distance_to_query_tokens(title_lower, tokens),
        VaultSearchBestFieldDto::Path => [
            min_edit_distance_to_query_tokens(filename_lower, tokens),
            min_edit_distance_to_query_tokens(rel_lower, tokens),
            min_edit_distance_to_query_tokens(title_lower, tokens),
        ]
        .into_iter()
        .flatten()
        .min(),
        VaultSearchBestFieldDto::Body => {
            min_edit_distance_to_query_tokens_prefix(body_lower, tokens, 12_000)
        }
    }
}

fn add_note_document(
    writer: &mut tantivy::IndexWriter,
    f_uri: tantivy::schema::Field,
    f_title: tantivy::schema::Field,
    f_filename: tantivy::schema::Field,
    f_rel_path: tantivy::schema::Field,
    f_body: tantivy::schema::Field,
    vault_root: &Path,
    path: &Path,
) -> tantivy::Result<()> {
    let uri = path_to_note_uri(path);
    let rel = relative_path_str(vault_root, path);
    let file_name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();

    let meta = fs::metadata(path).map_err(|e| tantivy::TantivyError::IoError(Arc::new(e)))?;
    let body = if !meta.is_file() {
        String::new()
    } else if meta.len() > MAX_FILE_BYTES {
        String::new()
    } else {
        fs::read_to_string(path).unwrap_or_default()
    };

    let _ = writer.add_document(doc!(
        f_uri => uri,
        f_title => stem,
        f_filename => file_name,
        f_rel_path => rel,
        f_body => body,
    ))?;
    Ok(())
}

fn delete_note(writer: &mut tantivy::IndexWriter, f_uri: tantivy::schema::Field, uri: &str) {
    let term = Term::from_field_text(f_uri, uri);
    let _ = writer.delete_term(term);
}

fn path_requires_index_write(vault_root: &Path, path: &Path) -> bool {
    if !path.starts_with(vault_root) {
        return false;
    }
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy())
        .unwrap_or_default();
    if path.is_file() {
        return is_eligible_vault_markdown_file_name(&name);
    }
    !path.exists() && name.ends_with(".md")
}

/// Full rebuild in a background thread. Emits `vault-search:index-status` for UI.
pub fn schedule_full_rebuild(
    app: AppHandle,
    vault_root: PathBuf,
    index_state: VaultSearchIndexState,
) {
    let index_dir = match vault_index_dir(&app, &vault_root) {
        Ok(p) => p,
        Err(e) => {
            let _ = app.emit(
                "vault-search:index-status",
                serde_json::json!({ "status": "failed", "message": e }),
            );
            return;
        }
    };

    {
        let mut g = index_state.inner.lock().unwrap();
        g.status = VaultSearchIndexStatusDto::Building;
        g.last_error = None;
        g.vault_root = Some(vault_root.clone());
        g.index_dir = Some(index_dir.clone());
        g.index = None;
        g.reader = None;
    }
    let _ = app.emit(
        "vault-search:index-status",
        serde_json::json!({ "status": "building" }),
    );

    let app2 = app.clone();
    let istate = index_state.clone();
    thread::spawn(move || {
        let (schema, f_uri, f_title, f_filename, f_rel_path, f_body) = build_schema();

        let _ = fs::remove_dir_all(&index_dir);
        if let Err(e) = fs::create_dir_all(&index_dir) {
            fail_build(&app2, &istate, format!("create index dir: {e}"));
            return;
        }

        let mmap_dir = match MmapDirectory::open(&index_dir) {
            Ok(d) => d,
            Err(e) => {
                fail_build(&app2, &istate, format!("mmap dir: {e}"));
                return;
            }
        };

        let index = match Index::open_or_create(mmap_dir, schema.clone()) {
            Ok(i) => i,
            Err(e) => {
                fail_build(&app2, &istate, format!("index create: {e}"));
                return;
            }
        };

        let mut writer = match index.writer(INDEX_WRITER_HEAP_MB * 1024 * 1024) {
            Ok(w) => w,
            Err(e) => {
                fail_build(&app2, &istate, format!("writer: {e}"));
                return;
            }
        };

        let mut paths = Vec::new();
        if let Err(e) = walk_markdown_files(&vault_root, &mut paths) {
            fail_build(&app2, &istate, format!("walk: {e}"));
            return;
        }

        let mut indexed = 0u32;
        let mut skipped = 0u32;
        for path in paths {
            if let Err(e) = add_note_document(
                &mut writer,
                f_uri,
                f_title,
                f_filename,
                f_rel_path,
                f_body,
                &vault_root,
                &path,
            ) {
                eprintln!("vault index add {}: {e}", path.display());
                skipped += 1;
                continue;
            }
            indexed += 1;
        }

        if let Err(e) = writer.commit() {
            fail_build(&app2, &istate, format!("commit: {e}"));
            return;
        }

        let reader = match index.reader() {
            Ok(r) => r,
            Err(e) => {
                fail_build(&app2, &istate, format!("reader: {e}"));
                return;
            }
        };

        {
            let mut g = istate.inner.lock().unwrap();
            g.index = Some(index);
            g.reader = Some(reader);
            g.status = VaultSearchIndexStatusDto::Ready;
        }
        let _ = app2.emit(
            "vault-search:index-status",
            serde_json::json!({
                "status": "ready",
                "indexedNotes": indexed,
                "skippedNotes": skipped,
            }),
        );
    });
}

fn fail_build(app: &AppHandle, istate: &VaultSearchIndexState, msg: String) {
    let mut g = istate.inner.lock().unwrap();
    g.status = VaultSearchIndexStatusDto::Failed;
    g.last_error = Some(msg.clone());
    g.index = None;
    g.reader = None;
    drop(g);
    let _ = app.emit(
        "vault-search:index-status",
        serde_json::json!({ "status": "failed", "message": msg }),
    );
}

/// Incremental update for changed paths (best-effort).
pub fn reindex_paths_best_effort(
    app: &AppHandle,
    vault_root: &Path,
    index_state: &VaultSearchIndexState,
    paths: &[String],
) {
    let actionable_paths: Vec<PathBuf> = paths
        .iter()
        .map(PathBuf::from)
        .filter(|path| path_requires_index_write(vault_root, path))
        .collect();
    if actionable_paths.is_empty() {
        return;
    }

    let inner = index_state.inner.lock().unwrap();
    if inner.status != VaultSearchIndexStatusDto::Ready {
        return;
    }
    let Some(index) = inner.index.as_ref().map(|i| i.clone()) else {
        return;
    };
    drop(inner);

    let schema = index.schema();
    let Ok(f_uri) = schema.get_field("uri") else {
        return;
    };
    let Ok(f_title) = schema.get_field("title") else {
        return;
    };
    let Ok(f_filename) = schema.get_field("filename") else {
        return;
    };
    let Ok(f_rel_path) = schema.get_field("rel_path") else {
        return;
    };
    let Ok(f_body) = schema.get_field("body") else {
        return;
    };

    let mut writer = match index.writer(INDEX_WRITER_HEAP_MB * 1024 * 1024) {
        Ok(w) => w,
        Err(_) => return,
    };

    for path in actionable_paths {
        if path.is_file() {
            let name = path
                .file_name()
                .map(|n| n.to_string_lossy())
                .unwrap_or_default();
            if is_eligible_vault_markdown_file_name(&name) {
                let uri = path_to_note_uri(&path);
                delete_note(&mut writer, f_uri, &uri);
                let _ = add_note_document(
                    &mut writer,
                    f_uri,
                    f_title,
                    f_filename,
                    f_rel_path,
                    f_body,
                    vault_root,
                    &path,
                );
            } else if name.ends_with(".md") {
                let uri = path_to_note_uri(&path);
                delete_note(&mut writer, f_uri, &uri);
            }
        } else if !path.exists() {
            let uri = path_to_note_uri(&path);
            delete_note(&mut writer, f_uri, &uri);
        }
    }

    if writer.commit().is_err() {
        return;
    }

    let inner = index_state.inner.lock().unwrap();
    if let Some(ref r) = inner.reader {
        let _ = r.reload();
    }
    drop(inner);
    let _ = app.emit(
        "vault-search:index-status",
        serde_json::json!({ "status": "ready", "incremental": true }),
    );
}

pub fn index_is_ready(state: &VaultSearchIndexState) -> bool {
    state
        .inner
        .lock()
        .map(|g| g.status == VaultSearchIndexStatusDto::Ready && g.reader.is_some())
        .unwrap_or(false)
}

pub fn index_status_string(state: &VaultSearchIndexState) -> String {
    state
        .inner
        .lock()
        .map(|g| match g.status {
            VaultSearchIndexStatusDto::Ready => "ready".to_string(),
            VaultSearchIndexStatusDto::Building => "building".to_string(),
            VaultSearchIndexStatusDto::Failed => "failed".to_string(),
            VaultSearchIndexStatusDto::Idle => "idle".to_string(),
        })
        .unwrap_or_else(|_| "unavailable".to_string())
}

pub fn run_indexed_search(
    state: &VaultSearchIndexState,
    query_trim: &str,
    limit: usize,
) -> Result<Vec<VaultSearchNoteResultDto>, String> {
    let inner = state.inner.lock().map_err(|e| e.to_string())?;
    if inner.status != VaultSearchIndexStatusDto::Ready {
        return Ok(vec![]);
    }
    let Some(reader) = inner.reader.as_ref() else {
        return Ok(vec![]);
    };
    let Some(index) = inner.index.as_ref() else {
        return Ok(vec![]);
    };

    let schema = index.schema();
    let f_uri = schema.get_field("uri").map_err(|e| e.to_string())?;
    let f_title = schema.get_field("title").map_err(|e| e.to_string())?;
    let f_filename = schema.get_field("filename").map_err(|e| e.to_string())?;
    let f_rel_path = schema.get_field("rel_path").map_err(|e| e.to_string())?;
    let f_body = schema.get_field("body").map_err(|e| e.to_string())?;

    let q = build_index_query(
        index, &schema, f_title, f_filename, f_rel_path, f_body, query_trim,
    )
    .map_err(|e| e.to_string())?;

    let searcher = reader.searcher();
    let top_docs = searcher
        .search(&q, &TopDocs::with_limit(limit).order_by_score())
        .map_err(|e| e.to_string())?;

    let tokens = query_tokens(query_trim);
    let full_lower = query_trim.to_lowercase();
    let mut out = Vec::new();

    for (tantivy_score, doc_addr) in top_docs {
        let doc: TantivyDocument = searcher.doc(doc_addr).map_err(|e| e.to_string())?;
        let uri = doc
            .get_first(f_uri)
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let title = doc
            .get_first(f_title)
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let filename = doc
            .get_first(f_filename)
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let rel_path = doc
            .get_first(f_rel_path)
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let body = doc
            .get_first(f_body)
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        let title_lower = title.to_lowercase();
        let filename_lower = filename.to_lowercase();
        let rel_lower = rel_path.to_lowercase();
        let body_lower = body.to_lowercase();

        let best_field = classify_best_field(
            &title_lower,
            &filename_lower,
            &rel_lower,
            &body_lower,
            &tokens,
            &full_lower,
        );
        let (snippets, mut match_count) = collect_snippets(&body, &tokens, &full_lower);
        if best_field != VaultSearchBestFieldDto::Body && match_count <= 1 && snippets.is_empty() {
            match_count = match_count.max(1);
        }

        let tier_boost = match best_field {
            VaultSearchBestFieldDto::Title => 10_000.0f32,
            VaultSearchBestFieldDto::Path => 5_000.0f32,
            VaultSearchBestFieldDto::Body => 0.0f32,
        };
        let min_d = ranking_min_distance_for_field(
            best_field,
            &title_lower,
            &filename_lower,
            &rel_lower,
            &body_lower,
            &tokens,
        );
        let combined_score = tier_boost + rank_quality_boost(min_d) + tantivy_score * 0.02;

        out.push(VaultSearchNoteResultDto {
            uri,
            relative_path: rel_path,
            title,
            best_field,
            match_count,
            score: combined_score,
            snippets,
        });
    }

    out.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| {
                let ra = best_field_rank(a.best_field);
                let rb = best_field_rank(b.best_field);
                ra.cmp(&rb)
            })
            .then_with(|| a.uri.cmp(&b.uri))
    });

    Ok(out)
}

fn best_field_rank(f: VaultSearchBestFieldDto) -> u8 {
    match f {
        VaultSearchBestFieldDto::Title => 0,
        VaultSearchBestFieldDto::Path => 1,
        VaultSearchBestFieldDto::Body => 2,
    }
}

#[tauri::command]
pub fn vault_search_index_schedule(
    app: AppHandle,
    vault_state: tauri::State<'_, VaultRootState>,
    index_state: tauri::State<'_, VaultSearchIndexState>,
) -> Result<(), String> {
    let vault_root = vault_state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or_else(|| "no vault session".to_string())?;

    schedule_full_rebuild(app, vault_root, (*index_state).clone());
    Ok(())
}

#[tauri::command]
pub fn vault_search_index_touch_paths(
    app: AppHandle,
    vault_state: tauri::State<'_, VaultRootState>,
    index_state: tauri::State<'_, VaultSearchIndexState>,
    paths: Vec<String>,
) -> Result<(), String> {
    let vault_root = vault_state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or_else(|| "no vault session".to_string())?;
    reindex_paths_best_effort(&app, &vault_root, &index_state, &paths);
    Ok(())
}

#[cfg(test)]
impl VaultSearchIndexState {
    fn test_ready(index: Index, reader: tantivy::IndexReader) -> Self {
        Self {
            inner: Arc::new(Mutex::new(VaultSearchIndexInner {
                vault_root: None,
                index_dir: None,
                index: Some(index),
                reader: Some(reader),
                status: VaultSearchIndexStatusDto::Ready,
                last_error: None,
            })),
        }
    }
}

#[cfg(test)]
mod ranking_tests {
    use super::*;
    use std::fs;
    use tantivy::doc;

    #[test]
    fn path_requires_index_write_ignores_non_markdown_paths() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let root = tmp.path();
        let dir = root.join("Inbox");
        fs::create_dir(&dir).expect("create dir");
        let txt = root.join("Inbox").join("note.txt");
        fs::write(&txt, "not indexed").expect("write txt");

        assert!(!path_requires_index_write(root, &dir));
        assert!(!path_requires_index_write(root, &txt));
        assert!(!path_requires_index_write(
            root,
            &root.join("missing-folder")
        ));
    }

    #[test]
    fn path_requires_index_write_keeps_markdown_creates_and_deletes_actionable() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let root = tmp.path();
        let note = root.join("note.md");
        fs::write(&note, "# Note").expect("write note");
        let deleted_note = root.join("deleted.md");
        let hidden_note = root.join(".hidden.md");
        fs::write(&hidden_note, "# Hidden").expect("write hidden note");

        assert!(path_requires_index_write(root, &note));
        assert!(path_requires_index_write(root, &deleted_note));
        assert!(!path_requires_index_write(root, &hidden_note));
    }

    #[test]
    fn lisane_prefers_title_lisanne_over_body_only_note() {
        let (schema, f_uri, f_title, f_filename, f_rel_path, f_body) = build_schema();
        let index = Index::create_in_ram(schema);
        let mut writer = index
            .writer(INDEX_WRITER_HEAP_MB * 1024 * 1024)
            .expect("writer");

        let add = |uri: &str, stem: &str, fname: &str, rel: &str, body: &str| {
            writer
                .add_document(doc!(
                    f_uri => uri,
                    f_title => stem,
                    f_filename => fname,
                    f_rel_path => rel,
                    f_body => body,
                ))
                .expect("add");
        };

        add(
            "/v/Lisanne.md",
            "Lisanne",
            "Lisanne.md",
            "Lisanne.md",
            "Other text.",
        );
        add(
            "/v/body.md",
            "body",
            "body.md",
            "body.md",
            "Meeting with Lisanne.",
        );
        add(
            "/v/prose.md",
            "prose",
            "prose.md",
            "prose.md",
            "lijstje van dingen om aan te werken",
        );

        writer.commit().expect("commit");
        let reader = index.reader().expect("reader");
        let state = VaultSearchIndexState::test_ready(index, reader);

        let out = run_indexed_search(&state, "lisane", 20).expect("search");
        let uris: Vec<&str> = out.iter().map(|n| n.uri.as_str()).collect();

        let pos_title = uris
            .iter()
            .position(|u| *u == "/v/Lisanne.md")
            .expect("Lisanne note in results");
        let pos_body = uris
            .iter()
            .position(|u| *u == "/v/body.md")
            .expect("body note in results");
        assert!(
            pos_title < pos_body,
            "title match should rank above body-only: {uris:?}"
        );

        if let Some(pos_prose) = uris.iter().position(|u| *u == "/v/prose.md") {
            assert!(
                pos_body < pos_prose || pos_title < pos_prose,
                "prose false positive should not outrank real matches: {uris:?}"
            );
        }
    }

    /// Mirrors weak title matches vs strong `Lisanne` typo match (desktop screenshot case).
    #[test]
    fn lisane_ranks_lisanne_notes_before_call_lisa_and_cart_line() {
        let (schema, f_uri, f_title, f_filename, f_rel_path, f_body) = build_schema();
        let index = Index::create_in_ram(schema);
        let mut writer = index
            .writer(INDEX_WRITER_HEAP_MB * 1024 * 1024)
            .expect("writer");

        let add = |uri: &str, stem: &str, fname: &str, rel: &str, body: &str| {
            writer
                .add_document(doc!(
                    f_uri => uri,
                    f_title => stem,
                    f_filename => fname,
                    f_rel_path => rel,
                    f_body => body,
                ))
                .expect("add");
        };

        add(
            "/v/Call Lisa.md",
            "Call Lisa",
            "Call Lisa.md",
            "General/Call Lisa.md",
            "# Call Lisa\n\n- Lisa, 31 org psychologie\n",
        );
        add(
            "/v/Cart line update.md",
            "Cart line update",
            "Cart line update.md",
            "General/Cart line update.md",
            "# Cart line update\n\nDetails here.\n",
        );
        add(
            "/v/Familie Lisanne.md",
            "Familie Lisanne",
            "Familie Lisanne.md",
            "General/Familie Lisanne.md",
            "# Familie Lisanne\n\nNotes.\n",
        );
        add(
            "/v/Lisanne.md",
            "Lisanne",
            "Lisanne.md",
            "General/Lisanne.md",
            "# Lisanne letswaart\n\n- [[Familie Lisanne]]\n",
        );

        writer.commit().expect("commit");
        let reader = index.reader().expect("reader");
        let state = VaultSearchIndexState::test_ready(index, reader);

        let out = run_indexed_search(&state, "lisane", 20).expect("search");
        let uris: Vec<&str> = out.iter().map(|n| n.uri.as_str()).collect();

        let pos_lisanne = uris
            .iter()
            .position(|u| *u == "/v/Lisanne.md")
            .expect("Lisanne.md in results");
        let pos_familie = uris
            .iter()
            .position(|u| *u == "/v/Familie Lisanne.md")
            .expect("Familie Lisanne in results");
        let pos_call = uris
            .iter()
            .position(|u| *u == "/v/Call Lisa.md")
            .expect("Call Lisa in results");
        let pos_cart = uris
            .iter()
            .position(|u| *u == "/v/Cart line update.md")
            .expect("Cart line in results");

        assert!(
            pos_lisanne < pos_call && pos_familie < pos_call,
            "Lisanne title matches should rank above Call Lisa: {uris:?}"
        );
        assert!(
            pos_lisanne < pos_cart && pos_familie < pos_cart,
            "Lisanne title matches should rank above Cart line update: {uris:?}"
        );
    }
}

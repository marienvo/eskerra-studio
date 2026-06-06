//! Vault scanning: walk the active vault tree (whole vault, every eligible
//! `.md`, excluding hard-excluded / ignored directories — the same scope as the
//! app's walkers, via the shared exclusion rules), scan each file's bytes with
//! `eskerra_reminder_core::scan`, and build the freshly-scanned reminder set.
//!
//! Incremental rescans (`rescan_changed_files`) re-scan only the files a watch
//! batch touched, reusing the prior index's reminders for unchanged files, so
//! detection→index-update stays inside the <1s budget on large vaults.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use eskerra_reminder_core::{fresh_reminder_from_scan, scan, DefaultTime, Reminder};
use eskerra_vault_watch::{
    is_vault_tree_hard_excluded_directory_name, is_vault_tree_ignored_entry_name,
};

/// Skip files larger than this when scanning for tokens. Mirrors the app's
/// `MAX_FILE_BYTES`; reminders never live in multi-hundred-KB files and the cap
/// keeps a scan bounded.
pub const MAX_FILE_BYTES: u64 = 524_288;

const MARKDOWN_EXTENSION: &str = ".md";
const SYNC_CONFLICT_MARKER: &str = "sync-conflict";

/// Same eligibility as the app's `is_eligible_vault_markdown_file_name`:
/// `.md`, not a Syncthing conflict copy, not dot-prefixed.
pub fn is_eligible_markdown_file_name(name: &str) -> bool {
    name.ends_with(MARKDOWN_EXTENSION)
        && !name.to_lowercase().contains(SYNC_CONFLICT_MARKER)
        && !is_vault_tree_ignored_entry_name(name)
}

/// Routing handle for IPC + open (ADR §3 `noteUri`). A `file://` URI over the
/// absolute path; the stable identity is `vaultRelativePath`, this is only a
/// routing convenience and is re-derivable from the vault root + relative path.
fn note_uri_for(abs_path: &Path) -> String {
    format!("file://{}", abs_path.to_string_lossy())
}

/// Vault-relative path with `/` separators, or `None` if `abs` is not under
/// `root`. Used both as the identity key and to address files for rescans.
pub fn vault_relative(root: &Path, abs: &Path) -> Option<String> {
    let rel = abs.strip_prefix(root).ok()?;
    let mut parts = Vec::new();
    for component in rel.components() {
        parts.push(component.as_os_str().to_string_lossy().into_owned());
    }
    Some(parts.join("/"))
}

/// Scan a single file's bytes into fresh reminders. Returns an empty vec for an
/// ineligible/oversized/unreadable file or one with no live tokens — never an
/// error (a single bad file must not abort a whole-vault scan).
fn scan_file(root: &Path, abs_path: &Path, default_time: DefaultTime, lead_minutes: u32) -> Vec<Reminder> {
    let Some(name) = abs_path.file_name().map(|n| n.to_string_lossy().into_owned()) else {
        return Vec::new();
    };
    if !is_eligible_markdown_file_name(&name) {
        return Vec::new();
    }
    let Some(vault_relative_path) = vault_relative(root, abs_path) else {
        return Vec::new();
    };
    let metadata = match std::fs::metadata(abs_path) {
        Ok(m) if m.is_file() && m.len() <= MAX_FILE_BYTES => m,
        _ => return Vec::new(),
    };
    let _ = metadata;
    let bytes = match std::fs::read(abs_path) {
        Ok(b) => b,
        Err(_) => return Vec::new(),
    };
    let Some(output) = scan(&bytes) else {
        return Vec::new();
    };
    let note_uri = note_uri_for(abs_path);
    output
        .tokens
        .iter()
        .filter_map(|token| {
            fresh_reminder_from_scan(
                &vault_relative_path,
                &note_uri,
                token,
                &output.scan_fingerprint,
                default_time,
                lead_minutes,
            )
        })
        .collect()
}

/// Recursively walk `root`, scanning every eligible `.md`. Skips ignored /
/// hard-excluded directories. Returns the complete fresh reminder set in a
/// stable order (sorted by vault-relative path then occurrence ordinal) so the
/// written index is deterministic.
pub fn scan_vault(root: &Path, default_time: DefaultTime, lead_minutes: u32) -> Vec<Reminder> {
    let mut reminders = Vec::new();
    walk(root, root, default_time, lead_minutes, &mut reminders);
    sort_reminders(&mut reminders);
    reminders
}

fn walk(root: &Path, dir: &Path, default_time: DefaultTime, lead_minutes: u32, out: &mut Vec<Reminder>) {
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if is_vault_tree_ignored_entry_name(&name_str)
            || is_vault_tree_hard_excluded_directory_name(&name_str)
        {
            continue;
        }
        let path = entry.path();
        match entry.file_type() {
            Ok(ft) if ft.is_dir() => walk(root, &path, default_time, lead_minutes, out),
            Ok(ft) if ft.is_file() => {
                out.extend(scan_file(root, &path, default_time, lead_minutes));
            }
            _ => {}
        }
    }
}

/// Incremental rescan: build a fresh reminder set by re-scanning only the
/// `changed_abs_paths` (files) and reusing `prior`'s reminders for every other
/// file. Reminders for a changed path that no longer yields tokens (deleted,
/// struck, edited away) simply drop. The caller still runs `merge_reminders`
/// over the result to carry state forward safely.
///
/// A changed path that is (or *was*) a **directory** drops every prior reminder
/// beneath it as well: a deleted directory arrives in a watch batch as a single
/// path that no longer exists on disk, so neither the daemon nor we can prove it
/// was a directory via `is_dir()`. Filtering by prefix here keeps the index from
/// retaining stale reminders for files inside a directory the user just removed,
/// regardless of that race. The daemon still falls back to a full [`scan_vault`]
/// when it *can* see a directory in the batch (or the batch is coarse); this is
/// the belt-and-suspenders for the case it cannot.
pub fn rescan_changed_files(
    root: &Path,
    prior: &[Reminder],
    changed_abs_paths: &[PathBuf],
    default_time: DefaultTime,
    lead_minutes: u32,
) -> Vec<Reminder> {
    // Vault-relative paths of the changed entries (those under the root).
    let changed_rel: BTreeSet<String> = changed_abs_paths
        .iter()
        .filter_map(|p| vault_relative(root, p))
        .collect();

    let mut fresh: Vec<Reminder> = prior
        .iter()
        .filter(|r| !is_changed_or_under_changed(&r.vault_relative_path, &changed_rel))
        .cloned()
        .collect();

    for abs in changed_abs_paths {
        // Re-scan the live file (skips silently if it was deleted/ineligible).
        fresh.extend(scan_file(root, abs, default_time, lead_minutes));
    }

    sort_reminders(&mut fresh);
    fresh
}

/// True when `rel` is one of the changed paths, or lives under one of them (a
/// changed *directory*). A changed file matches only by exact equality — no
/// prior reminder is ever addressed as `<file>/...`, so the prefix arm never
/// over-drops for files — while a changed/deleted directory matches every
/// reminder beneath it.
fn is_changed_or_under_changed(rel: &str, changed_rel: &BTreeSet<String>) -> bool {
    if changed_rel.contains(rel) {
        return true;
    }
    changed_rel
        .iter()
        .any(|c| rel.strip_prefix(c.as_str()).is_some_and(|rest| rest.starts_with('/')))
}

fn sort_reminders(reminders: &mut [Reminder]) {
    reminders.sort_by(|a, b| {
        a.vault_relative_path
            .cmp(&b.vault_relative_path)
            .then(a.normalized_token_text.cmp(&b.normalized_token_text))
            .then(a.occurrence_ordinal.cmp(&b.occurrence_ordinal))
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn write(root: &Path, rel: &str, body: &str) {
        let path = root.join(rel);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, body).unwrap();
    }

    #[test]
    fn scans_whole_vault_excluding_ignored_and_hard_excluded() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        write(root, "Inbox/today.md", "meet @2026-06-06_0900 soon");
        write(root, "Notes/plan.md", "deadline @2026-12-31");
        write(root, "Templates/tmpl.md", "ignored @2026-01-01_1000"); // hard-excluded dir
        write(root, ".hidden/secret.md", "ignored @2026-01-02_1000"); // dot-dir
        write(root, "Inbox/.draft.md", "ignored @2026-01-03_1000"); // dot-file
        write(root, "Inbox/note.sync-conflict-1.md", "ignored @2026-01-04"); // conflict copy
        write(root, "Inbox/notes.txt", "ignored @2026-01-05_1000"); // not .md

        let reminders = scan_vault(root, DefaultTime::DEFAULT_NINE_AM, 5);
        let texts: Vec<&str> = reminders.iter().map(|r| r.normalized_token_text.as_str()).collect();
        assert_eq!(texts, vec!["@2026-06-06_0900", "@2026-12-31"]);
        assert_eq!(reminders[0].vault_relative_path, "Inbox/today.md");
        assert_eq!(reminders[1].vault_relative_path, "Notes/plan.md");
        assert!(reminders[0].note_uri.starts_with("file://"));
    }

    #[test]
    fn incremental_rescan_replaces_only_changed_file_reminders() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        write(root, "Inbox/a.md", "@2026-06-06_0900");
        write(root, "Inbox/b.md", "@2026-07-07_1000");
        let prior = scan_vault(root, DefaultTime::DEFAULT_NINE_AM, 5);
        assert_eq!(prior.len(), 2);

        // Edit a.md's token; b.md untouched on disk.
        write(root, "Inbox/a.md", "@2026-06-06_1100 changed");
        let changed = vec![root.join("Inbox/a.md")];
        let fresh = rescan_changed_files(root, &prior, &changed, DefaultTime::DEFAULT_NINE_AM, 5);

        let by_path: Vec<(&str, &str)> = fresh
            .iter()
            .map(|r| (r.vault_relative_path.as_str(), r.normalized_token_text.as_str()))
            .collect();
        assert_eq!(
            by_path,
            vec![("Inbox/a.md", "@2026-06-06_1100"), ("Inbox/b.md", "@2026-07-07_1000")]
        );
        // b.md's reminder object was reused verbatim from the prior set.
        let prior_b = prior.iter().find(|r| r.vault_relative_path == "Inbox/b.md").unwrap();
        let fresh_b = fresh.iter().find(|r| r.vault_relative_path == "Inbox/b.md").unwrap();
        assert_eq!(prior_b, fresh_b);
    }

    #[test]
    fn incremental_rescan_drops_reminders_for_deleted_file() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        write(root, "Inbox/a.md", "@2026-06-06_0900");
        write(root, "Inbox/b.md", "@2026-07-07_1000");
        let prior = scan_vault(root, DefaultTime::DEFAULT_NINE_AM, 5);

        fs::remove_file(root.join("Inbox/a.md")).unwrap();
        let changed = vec![root.join("Inbox/a.md")];
        let fresh = rescan_changed_files(root, &prior, &changed, DefaultTime::DEFAULT_NINE_AM, 5);

        assert_eq!(fresh.len(), 1);
        assert_eq!(fresh[0].vault_relative_path, "Inbox/b.md");
    }

    #[test]
    fn incremental_rescan_drops_reminders_under_deleted_directory() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        write(root, "Inbox/a.md", "@2026-06-06_0900");
        write(root, "Inbox/sub/c.md", "@2026-08-08_1200");
        write(root, "Notes/keep.md", "@2026-07-07_1000");
        let prior = scan_vault(root, DefaultTime::DEFAULT_NINE_AM, 5);
        assert_eq!(prior.len(), 3);

        // The user deletes the whole Inbox/ directory. The watch batch carries
        // only the (now non-existent) directory path — is_dir() can no longer
        // prove it was a directory.
        fs::remove_dir_all(root.join("Inbox")).unwrap();
        let changed = vec![root.join("Inbox")];
        let fresh = rescan_changed_files(root, &prior, &changed, DefaultTime::DEFAULT_NINE_AM, 5);

        // Both reminders that lived under Inbox/ are gone; Notes/ untouched.
        assert_eq!(fresh.len(), 1);
        assert_eq!(fresh[0].vault_relative_path, "Notes/keep.md");
    }

    #[test]
    fn incremental_rescan_prefix_does_not_over_drop_sibling_directories() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        write(root, "Inbox/a.md", "@2026-06-06_0900");
        // "Inbox2" shares the "Inbox" string prefix but is not under it.
        write(root, "Inbox2/b.md", "@2026-07-07_1000");
        let prior = scan_vault(root, DefaultTime::DEFAULT_NINE_AM, 5);

        fs::remove_dir_all(root.join("Inbox")).unwrap();
        let changed = vec![root.join("Inbox")];
        let fresh = rescan_changed_files(root, &prior, &changed, DefaultTime::DEFAULT_NINE_AM, 5);

        // Inbox2/b.md must survive — "Inbox2/b.md" is not under "Inbox/".
        assert_eq!(fresh.len(), 1);
        assert_eq!(fresh[0].vault_relative_path, "Inbox2/b.md");
    }

    #[test]
    fn vault_relative_rejects_paths_outside_root() {
        let root = Path::new("/vault");
        assert_eq!(vault_relative(root, Path::new("/vault/Inbox/a.md")).as_deref(), Some("Inbox/a.md"));
        assert_eq!(vault_relative(root, Path::new("/elsewhere/a.md")), None);
    }
}

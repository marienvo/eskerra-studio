use std::path::{Component, Path};

use serde::Serialize;

use crate::vault_git_sync::cli::GitCmd;
use crate::vault_git_sync::config::SyncConfig;
use crate::vault_git_sync::errors::SyncError;
use crate::vault_git_sync::validation::{
    validate_index_clean, validate_is_git_repo, validate_vault_path,
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StagePlan {
    pub included_paths: Vec<StagePlanEntry>,
    pub excluded_paths: Vec<StagePlanEntry>,
    pub unsupported_paths: Vec<StagePlanEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StageApplyResult {
    pub staged_paths: Vec<StagePlanEntry>,
    pub excluded_paths: Vec<StagePlanEntry>,
    pub unsupported_paths: Vec<StagePlanEntry>,
    pub mutated: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StagePlanEntry {
    pub path: String,
    pub change: StagePlanChange,
    pub reason: StagePlanReason,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum StagePlanChange {
    ModifiedTracked,
    AddedUntracked,
    DeletedTracked,
    Staged,
    Unsupported,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum StagePlanReason {
    Included,
    ExcludedByConfig,
    ExcludedGitDirectory,
    IncludeNotMatched,
    UnsupportedStatus,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct StatusPath {
    path: String,
    change: StagePlanChange,
    reason: Option<StagePlanReason>,
}

pub fn build_stage_plan(vault_path: &Path, config: &SyncConfig) -> Result<StagePlan, SyncError> {
    validate_vault_path(vault_path)?;
    validate_is_git_repo(vault_path)?;
    validate_index_clean(vault_path)?;

    let compiled = config.compile()?;
    let status_paths = read_status_paths(vault_path)?;

    Ok(classify_status_paths(status_paths, &compiled))
}

pub fn apply_stage_plan(
    vault_path: &Path,
    config: &SyncConfig,
) -> Result<StageApplyResult, SyncError> {
    let plan = build_stage_plan(vault_path, config)?;
    apply_built_stage_plan(vault_path, plan)
}

pub(crate) fn apply_built_stage_plan(
    vault_path: &Path,
    plan: StagePlan,
) -> Result<StageApplyResult, SyncError> {
    if !plan.unsupported_paths.is_empty() {
        return Err(SyncError::UnsupportedStagePlan {
            paths: plan
                .unsupported_paths
                .iter()
                .map(|entry| entry.path.clone())
                .collect(),
        });
    }

    for entry in &plan.included_paths {
        validate_stage_entry_path(&entry.path)?;
    }

    let mut staged_paths = Vec::new();
    for entry in &plan.included_paths {
        match entry.change {
            StagePlanChange::ModifiedTracked | StagePlanChange::AddedUntracked => {
                run_stage_git(vault_path, "add", &entry.path)?;
            }
            StagePlanChange::DeletedTracked => {
                run_stage_git(vault_path, "rm", &entry.path)?;
            }
            StagePlanChange::Staged | StagePlanChange::Unsupported => {
                return Err(SyncError::UnsupportedStagePlan {
                    paths: vec![entry.path.clone()],
                });
            }
        }
        staged_paths.push(entry.clone());
    }

    Ok(StageApplyResult {
        mutated: !staged_paths.is_empty(),
        staged_paths,
        excluded_paths: plan.excluded_paths,
        unsupported_paths: plan.unsupported_paths,
    })
}

fn classify_status_paths(
    status_paths: Vec<StatusPath>,
    compiled: &crate::vault_git_sync::config::CompiledSyncConfig,
) -> StagePlan {
    let mut included_paths = Vec::new();
    let mut excluded_paths = Vec::new();
    let mut unsupported_paths = Vec::new();

    for status_path in status_paths {
        let Some(path) = normalize_vault_relative_path(&status_path.path) else {
            unsupported_paths.push(StagePlanEntry {
                path: status_path.path,
                change: StagePlanChange::Unsupported,
                reason: StagePlanReason::UnsupportedStatus,
            });
            continue;
        };

        let entry = |reason| StagePlanEntry {
            path: path.clone(),
            change: status_path.change.clone(),
            reason,
        };

        if let Some(reason) = status_path.reason {
            unsupported_paths.push(entry(reason));
        } else if path == ".git" || path.starts_with(".git/") {
            excluded_paths.push(entry(StagePlanReason::ExcludedGitDirectory));
        } else if compiled.exclude.matches(&path) {
            excluded_paths.push(entry(StagePlanReason::ExcludedByConfig));
        } else if !compiled.include.matches(&path) {
            excluded_paths.push(entry(StagePlanReason::IncludeNotMatched));
        } else {
            included_paths.push(entry(StagePlanReason::Included));
        }
    }

    included_paths.sort_by(|a, b| a.path.cmp(&b.path));
    excluded_paths.sort_by(|a, b| a.path.cmp(&b.path));
    unsupported_paths.sort_by(|a, b| a.path.cmp(&b.path));

    StagePlan {
        included_paths,
        excluded_paths,
        unsupported_paths,
    }
}

fn read_status_paths(vault_path: &Path) -> Result<Vec<StatusPath>, SyncError> {
    let out = GitCmd::new(
        vault_path,
        &["status", "--porcelain=v2", "-z", "--untracked-files=all"],
    )
    .run()?;
    if !out.success {
        return Err(SyncError::GitCommandFailed {
            command: "git status --porcelain=v2 -z --untracked-files=all".into(),
            exit_code: out.exit_code,
            stderr: out.stderr,
        });
    }
    Ok(parse_status_paths(&out.stdout))
}

fn parse_status_paths(stdout: &str) -> Vec<StatusPath> {
    let mut paths = Vec::new();
    let mut records = stdout.split('\0').peekable();

    while let Some(record) = records.next() {
        let record = record.trim_end_matches('\n');
        if record.is_empty() || record.starts_with('#') || record.starts_with('!') {
            continue;
        }

        if let Some(path) = record.strip_prefix("? ") {
            paths.push(StatusPath {
                path: path.to_string(),
                change: StagePlanChange::AddedUntracked,
                reason: None,
            });
            continue;
        }

        let mut tokens = record.splitn(3, ' ');
        let kind = tokens.next().unwrap_or("");
        let xy = tokens.next().unwrap_or("..");
        let x = xy.chars().next().unwrap_or('.');
        let y = xy.chars().nth(1).unwrap_or('.');

        if kind == "2" {
            if let Some(path) = renamed_path(record) {
                paths.push(StatusPath {
                    path: path.to_string(),
                    change: StagePlanChange::Unsupported,
                    reason: Some(StagePlanReason::UnsupportedStatus),
                });
            }
            let _ = records.next();
            continue;
        }

        if kind == "u" {
            if let Some(path) = unmerged_path(record) {
                paths.push(StatusPath {
                    path: path.to_string(),
                    change: StagePlanChange::Unsupported,
                    reason: Some(StagePlanReason::UnsupportedStatus),
                });
            }
            continue;
        }

        if x != '.' {
            paths.push(StatusPath {
                path: porcelain_path(record, kind).unwrap_or_default().to_string(),
                change: StagePlanChange::Staged,
                reason: Some(StagePlanReason::UnsupportedStatus),
            });
            if kind == "2" {
                let _ = records.next();
            }
            continue;
        }

        match kind {
            "1" => {
                if let Some(path) = ordinary_path(record) {
                    let change = match y {
                        'D' => StagePlanChange::DeletedTracked,
                        'M' | 'T' => StagePlanChange::ModifiedTracked,
                        _ => StagePlanChange::Unsupported,
                    };
                    let reason = if change == StagePlanChange::Unsupported {
                        Some(StagePlanReason::UnsupportedStatus)
                    } else {
                        None
                    };
                    paths.push(StatusPath {
                        path: path.to_string(),
                        change,
                        reason,
                    });
                }
            }
            _ => {}
        }
    }

    paths
}

fn porcelain_path<'a>(record: &'a str, kind: &str) -> Option<&'a str> {
    match kind {
        "1" => ordinary_path(record),
        "2" => renamed_path(record),
        "u" => unmerged_path(record),
        _ => None,
    }
}

fn ordinary_path(record: &str) -> Option<&str> {
    record.splitn(9, ' ').nth(8)
}

fn renamed_path(record: &str) -> Option<&str> {
    record.splitn(10, ' ').nth(9)
}

fn unmerged_path(record: &str) -> Option<&str> {
    record.splitn(11, ' ').nth(10)
}

fn normalize_vault_relative_path(path: &str) -> Option<String> {
    if path.trim().is_empty() {
        return None;
    }
    let normalized = path.replace('\\', "/");
    let parsed = Path::new(&normalized);
    if parsed.is_absolute() {
        return None;
    }
    if parsed
        .components()
        .any(|component| !matches!(component, Component::Normal(_) | Component::CurDir))
    {
        return None;
    }
    Some(normalized.trim_start_matches("./").to_string())
}

fn validate_stage_entry_path(path: &str) -> Result<(), SyncError> {
    match normalize_vault_relative_path(path) {
        Some(normalized) if normalized == path => Ok(()),
        _ => Err(SyncError::UnsupportedStagePlan {
            paths: vec![path.to_string()],
        }),
    }
}

fn run_stage_git(vault_path: &Path, command: &str, path: &str) -> Result<(), SyncError> {
    let out = GitCmd::new(vault_path, &[command, "--", path]).run()?;
    if out.success {
        return Ok(());
    }

    Err(SyncError::GitCommandFailed {
        command: format!("git {command} -- {path}"),
        exit_code: out.exit_code,
        stderr: out.stderr,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault_git_sync::config::{
        ConflictPolicy, ConflictStrategy, MarkdownCalloutConfig, SyncTimeouts,
    };
    use crate::vault_git_sync::errors::UnsafeKind;
    use std::path::Path;
    use std::process::Command;
    use tempfile::TempDir;

    struct Repo {
        dir: TempDir,
    }

    impl Repo {
        fn new() -> Self {
            let dir = tempfile::tempdir().unwrap();
            git(&["-c", "init.defaultBranch=main", "init"], dir.path());
            git(&["config", "user.email", "t@t.com"], dir.path());
            git(&["config", "user.name", "T"], dir.path());
            git(&["config", "commit.gpgsign", "false"], dir.path());
            Self { dir }
        }

        fn path(&self) -> &Path {
            self.dir.path()
        }

        fn write(&self, file: &str, content: &str) {
            if let Some(parent) = Path::new(file).parent() {
                std::fs::create_dir_all(self.path().join(parent)).unwrap();
            }
            std::fs::write(self.path().join(file), content).unwrap();
        }

        fn commit(&self, file: &str, content: &str, msg: &str) {
            self.write(file, content);
            git(&["add", file], self.path());
            git(&["commit", "--no-gpg-sign", "-m", msg], self.path());
        }
    }

    fn git(args: &[&str], cwd: &Path) -> std::process::Output {
        Command::new("git")
            .args(args)
            .current_dir(cwd)
            .env("GIT_EDITOR", "true")
            .env("GIT_SEQUENCE_EDITOR", "true")
            .env("GIT_TERMINAL_PROMPT", "0")
            .output()
            .expect("git must be on PATH")
    }

    fn config(include: Vec<&str>, exclude: Vec<&str>) -> SyncConfig {
        SyncConfig {
            remote: "origin".into(),
            branch: "main".into(),
            include: include.into_iter().map(String::from).collect(),
            exclude: exclude.into_iter().map(String::from).collect(),
            backup_directory: "_sync-backups".into(),
            conflict_policies: vec![ConflictPolicy {
                glob: "**/*.md".into(),
                strategy: ConflictStrategy::Manual,
            }],
            markdown_conflict_callout: MarkdownCalloutConfig {
                enabled: true,
                callout_kind: "warning".into(),
                template: "Conflict backup: [[{backup_path}]]".into(),
            },
            commit_message_template: "chore: sync {timestamp} {host}".into(),
            host_label: Some("test-host".into()),
            backup_local_subdir: "local".into(),
            backup_remote_subdir: "remote".into(),
            timeouts: SyncTimeouts {
                fetch_secs: 30,
                push_secs: 30,
                merge_secs: 30,
            },
            allow_create_backup_directory: false,
            skip_commit_hooks: true,
        }
    }

    fn paths(entries: &[StagePlanEntry]) -> Vec<&str> {
        entries.iter().map(|entry| entry.path.as_str()).collect()
    }

    fn cached_name_status(repo: &Repo) -> String {
        let out = git(&["diff", "--cached", "--name-status"], repo.path());
        String::from_utf8_lossy(&out.stdout).into_owned()
    }

    fn porcelain(repo: &Repo) -> String {
        let out = git(&["status", "--porcelain"], repo.path());
        String::from_utf8_lossy(&out.stdout).into_owned()
    }

    fn compiled(
        include: Vec<&str>,
        exclude: Vec<&str>,
    ) -> crate::vault_git_sync::config::CompiledSyncConfig {
        config(include, exclude).compile().unwrap()
    }

    fn ordinary_record(xy: &str, path: &str) -> String {
        format!("1 {xy} N... 100644 100644 100644 headhash indexhash {path}")
    }

    #[test]
    fn parse_porcelain_unstaged_modified_tracked_file() {
        let parsed = parse_status_paths(&format!("{}\0", ordinary_record(".M", "note.md")));

        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].path, "note.md");
        assert_eq!(parsed[0].change, StagePlanChange::ModifiedTracked);
        assert_eq!(parsed[0].reason, None);
    }

    #[test]
    fn parse_porcelain_unstaged_deleted_tracked_file() {
        let parsed = parse_status_paths(&format!("{}\0", ordinary_record(".D", "gone.md")));

        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].path, "gone.md");
        assert_eq!(parsed[0].change, StagePlanChange::DeletedTracked);
        assert_eq!(parsed[0].reason, None);
    }

    #[test]
    fn parse_porcelain_untracked_file() {
        let parsed = parse_status_paths("? new.md\0");

        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].path, "new.md");
        assert_eq!(parsed[0].change, StagePlanChange::AddedUntracked);
        assert_eq!(parsed[0].reason, None);
    }

    #[test]
    fn parse_porcelain_staged_file_is_staged_unsupported() {
        let parsed = parse_status_paths(&format!("{}\0", ordinary_record("A.", "staged.md")));

        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].path, "staged.md");
        assert_eq!(parsed[0].change, StagePlanChange::Staged);
        assert_eq!(parsed[0].reason, Some(StagePlanReason::UnsupportedStatus));
    }

    #[test]
    fn parse_porcelain_rename_is_unsupported_and_consumes_extra_path() {
        let stdout = concat!(
            "2 R. N... 100644 100644 100644 headhash indexhash R100 renamed.md",
            "\0",
            "old.md",
            "\0",
            "? next.md",
            "\0"
        );

        let parsed = parse_status_paths(stdout);

        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].path, "renamed.md");
        assert_eq!(parsed[0].change, StagePlanChange::Unsupported);
        assert_eq!(parsed[0].reason, Some(StagePlanReason::UnsupportedStatus));
        assert_eq!(parsed[1].path, "next.md");
        assert_eq!(parsed[1].change, StagePlanChange::AddedUntracked);
    }

    #[test]
    fn parse_porcelain_unmerged_record_is_unsupported() {
        let stdout = concat!(
            "u UU N... 100644 100644 100644 100644 basehash ourhash theirhash conflict.md",
            "\0"
        );

        let parsed = parse_status_paths(stdout);

        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].path, "conflict.md");
        assert_eq!(parsed[0].change, StagePlanChange::Unsupported);
        assert_eq!(parsed[0].reason, Some(StagePlanReason::UnsupportedStatus));
    }

    #[test]
    fn classify_excluded_paths_are_not_included_even_when_include_matches() {
        let compiled = compiled(vec!["**/*.md"], vec!["Scripts/**"]);
        let plan = classify_status_paths(
            vec![StatusPath {
                path: "Scripts/build.md".into(),
                change: StagePlanChange::ModifiedTracked,
                reason: None,
            }],
            &compiled,
        );

        assert!(plan.included_paths.is_empty());
        assert_eq!(paths(&plan.excluded_paths), vec!["Scripts/build.md"]);
        assert_eq!(
            plan.excluded_paths[0].reason,
            StagePlanReason::ExcludedByConfig
        );
    }

    #[test]
    fn classify_unsupported_paths_are_not_included() {
        let compiled = compiled(vec!["**/*.md"], vec![]);
        let plan = classify_status_paths(
            vec![StatusPath {
                path: "renamed.md".into(),
                change: StagePlanChange::Unsupported,
                reason: Some(StagePlanReason::UnsupportedStatus),
            }],
            &compiled,
        );

        assert!(plan.included_paths.is_empty());
        assert_eq!(paths(&plan.unsupported_paths), vec!["renamed.md"]);
    }

    #[test]
    fn classify_paths_are_sorted_deterministically() {
        let compiled = compiled(vec!["**/*.md"], vec!["Scripts/**"]);
        let plan = classify_status_paths(
            vec![
                StatusPath {
                    path: "z.md".into(),
                    change: StagePlanChange::ModifiedTracked,
                    reason: None,
                },
                StatusPath {
                    path: "a.md".into(),
                    change: StagePlanChange::ModifiedTracked,
                    reason: None,
                },
                StatusPath {
                    path: "Scripts/z.md".into(),
                    change: StagePlanChange::ModifiedTracked,
                    reason: None,
                },
                StatusPath {
                    path: "Scripts/a.md".into(),
                    change: StagePlanChange::ModifiedTracked,
                    reason: None,
                },
                StatusPath {
                    path: "unsupported-z.md".into(),
                    change: StagePlanChange::Unsupported,
                    reason: Some(StagePlanReason::UnsupportedStatus),
                },
                StatusPath {
                    path: "unsupported-a.md".into(),
                    change: StagePlanChange::Unsupported,
                    reason: Some(StagePlanReason::UnsupportedStatus),
                },
            ],
            &compiled,
        );

        assert_eq!(paths(&plan.included_paths), vec!["a.md", "z.md"]);
        assert_eq!(
            paths(&plan.excluded_paths),
            vec!["Scripts/a.md", "Scripts/z.md"]
        );
        assert_eq!(
            paths(&plan.unsupported_paths),
            vec!["unsupported-a.md", "unsupported-z.md"]
        );
    }

    #[test]
    fn classify_git_directory_is_excluded_even_when_include_matches() {
        let compiled = compiled(vec!["**/*"], vec![]);
        let plan = classify_status_paths(
            vec![StatusPath {
                path: ".git/config".into(),
                change: StagePlanChange::AddedUntracked,
                reason: None,
            }],
            &compiled,
        );

        assert!(plan.included_paths.is_empty());
        assert_eq!(paths(&plan.excluded_paths), vec![".git/config"]);
        assert_eq!(
            plan.excluded_paths[0].reason,
            StagePlanReason::ExcludedGitDirectory
        );
    }

    #[test]
    fn stage_plan_serializes_camel_case_fields_and_values() {
        let plan = StagePlan {
            included_paths: vec![StagePlanEntry {
                path: "note.md".into(),
                change: StagePlanChange::ModifiedTracked,
                reason: StagePlanReason::Included,
            }],
            excluded_paths: vec![StagePlanEntry {
                path: "Scripts/build.md".into(),
                change: StagePlanChange::AddedUntracked,
                reason: StagePlanReason::ExcludedByConfig,
            }],
            unsupported_paths: vec![StagePlanEntry {
                path: "conflict.md".into(),
                change: StagePlanChange::Unsupported,
                reason: StagePlanReason::UnsupportedStatus,
            }],
        };

        let value = serde_json::to_value(&plan).unwrap();

        assert_eq!(value["includedPaths"][0]["path"], "note.md");
        assert_eq!(value["includedPaths"][0]["change"], "modifiedTracked");
        assert_eq!(value["includedPaths"][0]["reason"], "included");
        assert_eq!(value["excludedPaths"][0]["reason"], "excludedByConfig");
        assert_eq!(value["unsupportedPaths"][0]["reason"], "unsupportedStatus");
        assert!(value.get("included_paths").is_none());
        assert!(value["includedPaths"][0].get("change").is_some());
    }

    #[test]
    fn apply_modified_included_file_becomes_staged() {
        let repo = Repo::new();
        repo.commit("note.md", "old", "init");
        repo.write("note.md", "new");

        let result = apply_stage_plan(repo.path(), &config(vec!["**/*.md"], vec![])).unwrap();

        assert!(result.mutated);
        assert_eq!(paths(&result.staged_paths), vec!["note.md"]);
        assert_eq!(cached_name_status(&repo), "M\tnote.md\n");
    }

    #[test]
    fn apply_untracked_included_file_becomes_staged() {
        let repo = Repo::new();
        repo.commit("base.md", "base", "init");
        repo.write("new.md", "new");

        let result = apply_stage_plan(repo.path(), &config(vec!["**/*.md"], vec![])).unwrap();

        assert!(result.mutated);
        assert_eq!(paths(&result.staged_paths), vec!["new.md"]);
        assert_eq!(cached_name_status(&repo), "A\tnew.md\n");
    }

    #[test]
    fn apply_untracked_file_inside_new_inbox_directory_becomes_staged() {
        let repo = Repo::new();
        repo.commit("base.md", "base", "init");
        repo.write("Inbox/new.md", "new");

        assert_eq!(porcelain(&repo), "?? Inbox/\n");

        let result = apply_stage_plan(repo.path(), &config(vec!["**/*.md"], vec![])).unwrap();

        assert!(result.mutated);
        assert_eq!(paths(&result.staged_paths), vec!["Inbox/new.md"]);
        assert_eq!(cached_name_status(&repo), "A\tInbox/new.md\n");
        assert!(!porcelain(&repo).contains("?? Inbox/"));
    }

    #[test]
    fn apply_deleted_included_file_becomes_staged_deletion() {
        let repo = Repo::new();
        repo.commit("delete-me.md", "bye", "init");
        std::fs::remove_file(repo.path().join("delete-me.md")).unwrap();

        let result = apply_stage_plan(repo.path(), &config(vec!["**/*.md"], vec![])).unwrap();

        assert!(result.mutated);
        assert_eq!(paths(&result.staged_paths), vec!["delete-me.md"]);
        assert_eq!(cached_name_status(&repo), "D\tdelete-me.md\n");
    }

    #[test]
    fn apply_excluded_file_remains_unstaged() {
        let repo = Repo::new();
        repo.commit("keep.md", "old keep", "keep");
        repo.commit("Scripts/build.md", "old script", "script");
        repo.write("keep.md", "new keep");
        repo.write("Scripts/build.md", "new script");

        let result =
            apply_stage_plan(repo.path(), &config(vec!["**/*.md"], vec!["Scripts/**"])).unwrap();

        assert_eq!(paths(&result.staged_paths), vec!["keep.md"]);
        assert_eq!(paths(&result.excluded_paths), vec!["Scripts/build.md"]);
        assert_eq!(cached_name_status(&repo), "M\tkeep.md\n");
        assert!(
            porcelain(&repo).contains(" M Scripts/build.md"),
            "excluded file should remain unstaged"
        );
    }

    #[test]
    fn apply_include_not_matched_file_remains_unstaged() {
        let repo = Repo::new();
        repo.commit("base.md", "base", "init");
        repo.write("base.md", "changed");
        repo.write("note.txt", "not matched");

        let result = apply_stage_plan(repo.path(), &config(vec!["**/*.md"], vec![])).unwrap();

        assert_eq!(paths(&result.staged_paths), vec!["base.md"]);
        assert_eq!(paths(&result.excluded_paths), vec!["note.txt"]);
        assert_eq!(
            result.excluded_paths[0].reason,
            StagePlanReason::IncludeNotMatched
        );
        assert_eq!(cached_name_status(&repo), "M\tbase.md\n");
        assert!(
            porcelain(&repo).contains("?? note.txt"),
            "unmatched file should remain untracked"
        );
    }

    #[test]
    fn apply_unsupported_plan_returns_error_without_staging() {
        let repo = Repo::new();
        repo.commit("ok.md", "old", "init");
        repo.write("ok.md", "new");
        let plan = StagePlan {
            included_paths: vec![StagePlanEntry {
                path: "ok.md".into(),
                change: StagePlanChange::ModifiedTracked,
                reason: StagePlanReason::Included,
            }],
            excluded_paths: Vec::new(),
            unsupported_paths: vec![StagePlanEntry {
                path: "renamed.md".into(),
                change: StagePlanChange::Unsupported,
                reason: StagePlanReason::UnsupportedStatus,
            }],
        };

        let result = apply_built_stage_plan(repo.path(), plan);

        assert!(matches!(
            result,
            Err(SyncError::UnsupportedStagePlan { paths }) if paths == vec!["renamed.md"]
        ));
        assert_eq!(cached_name_status(&repo), "");
        assert!(
            porcelain(&repo).contains(" M ok.md"),
            "included file should remain unstaged after unsupported error"
        );
    }

    #[test]
    fn apply_clean_repo_returns_noop_result() {
        let repo = Repo::new();
        repo.commit("base.md", "base", "init");

        let result = apply_stage_plan(repo.path(), &config(vec!["**/*.md"], vec![])).unwrap();

        assert!(!result.mutated);
        assert!(result.staged_paths.is_empty());
        assert!(result.excluded_paths.is_empty());
        assert!(result.unsupported_paths.is_empty());
        assert_eq!(cached_name_status(&repo), "");
        assert_eq!(porcelain(&repo), "");
    }

    #[test]
    fn apply_pre_staged_changes_are_rejected_before_new_staging() {
        let repo = Repo::new();
        repo.commit("already.md", "old already", "already");
        repo.commit("new-change.md", "old new", "new");
        repo.write("already.md", "staged already");
        git(&["add", "already.md"], repo.path());
        repo.write("new-change.md", "new change");

        let result = apply_stage_plan(repo.path(), &config(vec!["**/*.md"], vec![]));

        assert!(matches!(
            result,
            Err(SyncError::UnsafeGitState {
                kind: UnsafeKind::IndexNotClean
            })
        ));
        assert_eq!(cached_name_status(&repo), "M\talready.md\n");
        assert!(
            porcelain(&repo).contains(" M new-change.md"),
            "new unstaged change should not be staged"
        );
    }

    #[test]
    fn apply_multiple_included_paths_are_staged_deterministically() {
        let repo = Repo::new();
        repo.commit("z.md", "old z", "z");
        repo.commit("a.md", "old a", "a");
        repo.write("z.md", "new z");
        repo.write("a.md", "new a");

        let result = apply_stage_plan(repo.path(), &config(vec!["**/*.md"], vec![])).unwrap();

        assert_eq!(paths(&result.staged_paths), vec!["a.md", "z.md"]);
        assert_eq!(cached_name_status(&repo), "M\ta.md\nM\tz.md\n");
    }

    #[test]
    fn apply_path_with_spaces_is_staged() {
        let repo = Repo::new();
        repo.commit("base.md", "base", "init");
        repo.write("note with space.md", "new");

        let result = apply_stage_plan(repo.path(), &config(vec!["**/*.md"], vec![])).unwrap();

        assert_eq!(paths(&result.staged_paths), vec!["note with space.md"]);
        assert_eq!(cached_name_status(&repo), "A\tnote with space.md\n");
    }

    #[test]
    fn apply_excluded_path_matching_include_is_not_staged() {
        let repo = Repo::new();
        repo.commit("Scripts/build.md", "old script", "script");
        repo.write("Scripts/build.md", "new script");

        let result =
            apply_stage_plan(repo.path(), &config(vec!["**/*.md"], vec!["Scripts/**"])).unwrap();

        assert!(!result.mutated);
        assert!(result.staged_paths.is_empty());
        assert_eq!(paths(&result.excluded_paths), vec!["Scripts/build.md"]);
        assert_eq!(cached_name_status(&repo), "");
        assert!(
            porcelain(&repo).contains(" M Scripts/build.md"),
            "excluded file should remain unstaged"
        );
    }

    #[test]
    fn apply_result_contains_staged_and_excluded_paths() {
        let repo = Repo::new();
        repo.commit("note.md", "old note", "note");
        repo.commit("Scripts/build.md", "old script", "script");
        repo.write("note.md", "new note");
        repo.write("Scripts/build.md", "new script");

        let result =
            apply_stage_plan(repo.path(), &config(vec!["**/*.md"], vec!["Scripts/**"])).unwrap();

        assert_eq!(paths(&result.staged_paths), vec!["note.md"]);
        assert_eq!(paths(&result.excluded_paths), vec!["Scripts/build.md"]);
        assert!(result.unsupported_paths.is_empty());
        assert!(result.mutated);
    }

    #[test]
    fn apply_rejects_absolute_or_parent_paths_before_staging() {
        let repo = Repo::new();
        repo.commit("ok.md", "old", "init");
        repo.write("ok.md", "new");

        for path in ["/tmp/evil.md", "../evil.md"] {
            let plan = StagePlan {
                included_paths: vec![
                    StagePlanEntry {
                        path: path.into(),
                        change: StagePlanChange::ModifiedTracked,
                        reason: StagePlanReason::Included,
                    },
                    StagePlanEntry {
                        path: "ok.md".into(),
                        change: StagePlanChange::ModifiedTracked,
                        reason: StagePlanReason::Included,
                    },
                ],
                excluded_paths: Vec::new(),
                unsupported_paths: Vec::new(),
            };

            let result = apply_built_stage_plan(repo.path(), plan);
            assert!(matches!(
                result,
                Err(SyncError::UnsupportedStagePlan { .. })
            ));
            assert_eq!(cached_name_status(&repo), "");
        }
    }

    #[test]
    fn include_only_markdown() {
        let repo = Repo::new();
        repo.commit("base.txt", "base", "init");
        repo.commit("root.md", "old root", "root");
        repo.commit("Folder/note.md", "old nested", "nested");
        repo.commit("Folder/data.json", "{}", "data");
        repo.write("root.md", "root");
        repo.write("Folder/note.md", "nested");
        repo.write("Folder/data.json", "{\"changed\":true}");

        let plan = build_stage_plan(repo.path(), &config(vec!["**/*.md"], vec![])).unwrap();

        assert_eq!(
            paths(&plan.included_paths),
            vec!["Folder/note.md", "root.md"]
        );
        assert_eq!(paths(&plan.excluded_paths), vec!["Folder/data.json"]);
        assert!(plan.unsupported_paths.is_empty());
    }

    #[test]
    fn exclude_scripts_directory() {
        let repo = Repo::new();
        repo.commit("base.txt", "base", "init");
        repo.commit("Notes/ok.md", "old ok", "notes");
        repo.commit("Scripts/build.md", "old script", "scripts");
        repo.write("Notes/ok.md", "ok");
        repo.write("Scripts/build.md", "script");

        let plan =
            build_stage_plan(repo.path(), &config(vec!["**/*.md"], vec!["Scripts/**"])).unwrap();

        assert_eq!(paths(&plan.included_paths), vec!["Notes/ok.md"]);
        assert_eq!(paths(&plan.excluded_paths), vec!["Scripts/build.md"]);
        assert_eq!(
            plan.excluded_paths[0].reason,
            StagePlanReason::ExcludedByConfig
        );
    }

    #[test]
    fn root_level_exclude_glob_is_honored() {
        let repo = Repo::new();
        repo.commit("base.txt", "base", "init");
        repo.commit("draft.md", "old draft", "draft");
        repo.commit("Nested/draft.md", "old nested draft", "nested draft");
        repo.write("draft.md", "draft");
        repo.write("Nested/draft.md", "nested draft");

        let plan = build_stage_plan(repo.path(), &config(vec!["**/*.md"], vec!["*.md"])).unwrap();

        assert_eq!(paths(&plan.included_paths), vec!["Nested/draft.md"]);
        assert_eq!(paths(&plan.excluded_paths), vec!["draft.md"]);
    }

    #[test]
    fn deleted_file_appears_in_stage_plan() {
        let repo = Repo::new();
        repo.commit("delete-me.md", "bye", "init");
        std::fs::remove_file(repo.path().join("delete-me.md")).unwrap();

        let plan = build_stage_plan(repo.path(), &config(vec!["**/*.md"], vec![])).unwrap();

        assert_eq!(paths(&plan.included_paths), vec!["delete-me.md"]);
        assert_eq!(
            plan.included_paths[0].change,
            StagePlanChange::DeletedTracked
        );
    }

    #[test]
    fn untracked_file_appears_in_stage_plan() {
        let repo = Repo::new();
        repo.commit("base.txt", "base", "init");
        repo.write("new.md", "new");

        let plan = build_stage_plan(repo.path(), &config(vec!["**/*.md"], vec![])).unwrap();

        assert_eq!(paths(&plan.included_paths), vec!["new.md"]);
        assert_eq!(
            plan.included_paths[0].change,
            StagePlanChange::AddedUntracked
        );
    }

    #[test]
    fn untracked_file_inside_new_inbox_directory_appears_in_stage_plan() {
        let repo = Repo::new();
        repo.commit("base.txt", "base", "init");
        repo.write("Inbox/new.md", "new");

        assert_eq!(porcelain(&repo), "?? Inbox/\n");

        let plan = build_stage_plan(repo.path(), &config(vec!["**/*.md"], vec![])).unwrap();

        assert_eq!(paths(&plan.included_paths), vec!["Inbox/new.md"]);
        assert!(plan.excluded_paths.is_empty());
        assert_eq!(
            plan.included_paths[0].change,
            StagePlanChange::AddedUntracked
        );
    }

    #[test]
    fn clean_repo_gives_empty_plan() {
        let repo = Repo::new();
        repo.commit("base.md", "base", "init");

        let plan = build_stage_plan(repo.path(), &config(vec!["**/*.md"], vec![])).unwrap();

        assert!(plan.included_paths.is_empty());
        assert!(plan.excluded_paths.is_empty());
        assert!(plan.unsupported_paths.is_empty());
    }

    #[test]
    fn stage_plan_does_not_mutate_repo() {
        let repo = Repo::new();
        repo.commit("base.md", "base", "init");
        repo.write("base.md", "changed");
        repo.write("new.md", "new");

        let head_before = git(&["rev-parse", "HEAD"], repo.path());
        let porcelain_before = git(&["status", "--porcelain"], repo.path());

        let plan = build_stage_plan(repo.path(), &config(vec!["**/*.md"], vec![])).unwrap();

        let head_after = git(&["rev-parse", "HEAD"], repo.path());
        let porcelain_after = git(&["status", "--porcelain"], repo.path());

        assert_eq!(paths(&plan.included_paths), vec!["base.md", "new.md"]);
        assert_eq!(head_before.stdout, head_after.stdout, "HEAD changed");
        assert_eq!(
            porcelain_before.stdout, porcelain_after.stdout,
            "working tree changed"
        );
    }

    #[test]
    fn pre_staged_changes_are_rejected_by_clean_index_policy() {
        let repo = Repo::new();
        repo.commit("base.md", "base", "init");
        repo.write("staged.md", "staged");
        git(&["add", "staged.md"], repo.path());

        let result = build_stage_plan(repo.path(), &config(vec!["**/*.md"], vec![]));

        assert!(matches!(
            result,
            Err(SyncError::UnsafeGitState {
                kind: UnsafeKind::IndexNotClean
            })
        ));
    }

    #[test]
    fn git_directory_is_always_excluded_by_parser_policy() {
        let stdout = "? .git/config\0";
        let parsed = parse_status_paths(stdout);
        assert_eq!(parsed[0].path, ".git/config");

        let repo = Repo::new();
        repo.commit("base.md", "base", "init");
        let config = config(vec!["**/*"], vec![]);
        let mut plan = StagePlan {
            included_paths: Vec::new(),
            excluded_paths: Vec::new(),
            unsupported_paths: Vec::new(),
        };
        for status_path in parsed {
            let path = normalize_vault_relative_path(&status_path.path).unwrap();
            if path == ".git" || path.starts_with(".git/") {
                plan.excluded_paths.push(StagePlanEntry {
                    path,
                    change: status_path.change,
                    reason: StagePlanReason::ExcludedGitDirectory,
                });
            }
        }

        assert_eq!(paths(&plan.excluded_paths), vec![".git/config"]);
        config.validate().unwrap();
    }
}

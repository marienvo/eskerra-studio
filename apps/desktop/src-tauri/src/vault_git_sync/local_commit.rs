use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;

use crate::vault_git_sync::cli::GitCmd;
use crate::vault_git_sync::config::SyncConfig;
use crate::vault_git_sync::errors::SyncError;
use crate::vault_git_sync::stage_plan::{apply_stage_plan, StageApplyResult};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalCommitResult {
    pub stage_result: StageApplyResult,
    pub commit: Option<CommitInfo>,
    pub mutated: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitInfo {
    pub sha: String,
    pub message: String,
}

pub fn local_sync_commit(
    vault_path: &Path,
    config: &SyncConfig,
) -> Result<LocalCommitResult, SyncError> {
    let timestamp = current_timestamp()?;
    local_sync_commit_with_timestamp(vault_path, config, &timestamp)
}

fn local_sync_commit_with_timestamp(
    vault_path: &Path,
    config: &SyncConfig,
    timestamp: &str,
) -> Result<LocalCommitResult, SyncError> {
    let stage_result = apply_stage_plan(vault_path, config)?;

    if !has_staged_changes(vault_path)? {
        return Ok(LocalCommitResult {
            stage_result,
            commit: None,
            mutated: false,
        });
    }

    let message = render_commit_message(config, timestamp);
    commit_staged_changes(vault_path, config, &message)?;
    let sha = read_head_sha(vault_path)?;

    Ok(LocalCommitResult {
        stage_result,
        commit: Some(CommitInfo { sha, message }),
        mutated: true,
    })
}

fn has_staged_changes(vault_path: &Path) -> Result<bool, SyncError> {
    let out = GitCmd::new(vault_path, &["diff", "--cached", "--quiet"]).run()?;
    match out.exit_code {
        Some(0) => Ok(false),
        Some(1) => Ok(true),
        _ => Err(SyncError::GitCommandFailed {
            command: "git diff --cached --quiet".into(),
            exit_code: out.exit_code,
            stderr: out.stderr,
        }),
    }
}

fn commit_staged_changes(
    vault_path: &Path,
    config: &SyncConfig,
    message: &str,
) -> Result<(), SyncError> {
    let mut args = vec!["commit", "--no-gpg-sign"];
    if config.skip_commit_hooks {
        args.push("--no-verify");
    }
    args.extend(["--message", message]);

    let out = GitCmd::new(vault_path, &args).run()?;
    if out.success {
        return Ok(());
    }

    Err(SyncError::GitCommandFailed {
        command: "git commit --no-gpg-sign --message <message>".into(),
        exit_code: out.exit_code,
        stderr: out.stderr,
    })
}

fn read_head_sha(vault_path: &Path) -> Result<String, SyncError> {
    let out = GitCmd::new(vault_path, &["rev-parse", "HEAD"]).run()?;
    if !out.success {
        return Err(SyncError::GitCommandFailed {
            command: "git rev-parse HEAD".into(),
            exit_code: out.exit_code,
            stderr: out.stderr,
        });
    }
    Ok(out.stdout.trim().to_string())
}

fn render_commit_message(config: &SyncConfig, timestamp: &str) -> String {
    let host = config.host_label.as_deref().unwrap_or("local");
    config
        .commit_message_template
        .replace("{timestamp}", timestamp)
        .replace("{host}", host)
}

fn current_timestamp() -> Result<String, SyncError> {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|err| SyncError::GitCommandFailed {
            command: "system time".into(),
            exit_code: None,
            stderr: err.to_string(),
        })?
        .as_secs();
    Ok(format!("unix-{secs}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault_git_sync::config::{
        ConflictPolicy, ConflictStrategy, MarkdownCalloutConfig, SyncTimeouts,
    };
    use crate::vault_git_sync::errors::UnsafeKind;
    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;
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
            commit_message_template: "chore: sync {timestamp} from {host}".into(),
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

    fn head(repo: &Repo) -> String {
        let out = git(&["rev-parse", "HEAD"], repo.path());
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    }

    fn commit_count(repo: &Repo) -> usize {
        let out = git(&["rev-list", "--count", "HEAD"], repo.path());
        String::from_utf8_lossy(&out.stdout).trim().parse().unwrap()
    }

    fn cached_name_status(repo: &Repo) -> String {
        let out = git(&["diff", "--cached", "--name-status"], repo.path());
        String::from_utf8_lossy(&out.stdout).into_owned()
    }

    fn porcelain(repo: &Repo) -> String {
        let out = git(&["status", "--porcelain"], repo.path());
        String::from_utf8_lossy(&out.stdout).into_owned()
    }

    fn last_commit_message(repo: &Repo) -> String {
        let out = git(&["log", "-1", "--pretty=%B"], repo.path());
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    }

    fn write_failing_pre_commit_hook(repo: &Repo) {
        let hook = repo.path().join(".git/hooks/pre-commit");
        std::fs::write(&hook, "#!/bin/sh\nexit 1\n").unwrap();
        #[cfg(unix)]
        {
            let mut permissions = std::fs::metadata(&hook).unwrap().permissions();
            permissions.set_mode(0o755);
            std::fs::set_permissions(&hook, permissions).unwrap();
        }
    }

    #[test]
    fn clean_repo_returns_noop_without_commit() {
        let repo = Repo::new();
        repo.commit("base.md", "base", "init");
        let head_before = head(&repo);
        let count_before = commit_count(&repo);

        let result =
            local_sync_commit_with_timestamp(repo.path(), &config(vec!["**/*.md"], vec![]), "ts")
                .unwrap();

        assert!(!result.mutated);
        assert!(result.commit.is_none());
        assert!(!result.stage_result.mutated);
        assert_eq!(head(&repo), head_before);
        assert_eq!(commit_count(&repo), count_before);
        assert_eq!(cached_name_status(&repo), "");
    }

    #[test]
    fn modified_included_file_creates_commit() {
        let repo = Repo::new();
        repo.commit("note.md", "old", "init");
        repo.write("note.md", "new");

        let result =
            local_sync_commit_with_timestamp(repo.path(), &config(vec!["**/*.md"], vec![]), "ts")
                .unwrap();

        assert!(result.mutated);
        assert_eq!(
            result.commit.as_ref().unwrap().message,
            "chore: sync ts from test-host"
        );
        assert_eq!(cached_name_status(&repo), "");
        assert_eq!(porcelain(&repo), "");
        assert_eq!(last_commit_message(&repo), "chore: sync ts from test-host");
    }

    #[test]
    fn untracked_included_file_creates_commit() {
        let repo = Repo::new();
        repo.commit("base.md", "base", "init");
        repo.write("new.md", "new");

        let result =
            local_sync_commit_with_timestamp(repo.path(), &config(vec!["**/*.md"], vec![]), "ts")
                .unwrap();

        assert!(result.mutated);
        assert!(result.commit.is_some());
        assert_eq!(cached_name_status(&repo), "");
        assert_eq!(porcelain(&repo), "");
    }

    #[test]
    fn deleted_included_file_creates_commit() {
        let repo = Repo::new();
        repo.commit("delete-me.md", "bye", "init");
        std::fs::remove_file(repo.path().join("delete-me.md")).unwrap();

        let result =
            local_sync_commit_with_timestamp(repo.path(), &config(vec!["**/*.md"], vec![]), "ts")
                .unwrap();

        assert!(result.mutated);
        assert!(result.commit.is_some());
        assert_eq!(cached_name_status(&repo), "");
        assert_eq!(porcelain(&repo), "");
    }

    #[test]
    fn excluded_file_only_returns_noop_without_commit() {
        let repo = Repo::new();
        repo.commit("Scripts/build.md", "old", "init");
        repo.write("Scripts/build.md", "new");
        let head_before = head(&repo);

        let result = local_sync_commit_with_timestamp(
            repo.path(),
            &config(vec!["**/*.md"], vec!["Scripts/**"]),
            "ts",
        )
        .unwrap();

        assert!(!result.mutated);
        assert!(result.commit.is_none());
        assert_eq!(head(&repo), head_before);
        assert_eq!(cached_name_status(&repo), "");
        assert!(porcelain(&repo).contains(" M Scripts/build.md"));
    }

    #[test]
    fn unsupported_path_errors_before_commit() {
        let repo = Repo::new();
        repo.commit("ok.md", "old", "init");
        repo.write("ok.md", "new");
        let head_before = head(&repo);
        let plan = crate::vault_git_sync::stage_plan::StagePlan {
            included_paths: vec![crate::vault_git_sync::stage_plan::StagePlanEntry {
                path: "ok.md".into(),
                change: crate::vault_git_sync::stage_plan::StagePlanChange::ModifiedTracked,
                reason: crate::vault_git_sync::stage_plan::StagePlanReason::Included,
            }],
            excluded_paths: Vec::new(),
            unsupported_paths: vec![crate::vault_git_sync::stage_plan::StagePlanEntry {
                path: "renamed.md".into(),
                change: crate::vault_git_sync::stage_plan::StagePlanChange::Unsupported,
                reason: crate::vault_git_sync::stage_plan::StagePlanReason::UnsupportedStatus,
            }],
        };

        let stage_result =
            crate::vault_git_sync::stage_plan::apply_built_stage_plan(repo.path(), plan);

        assert!(matches!(
            stage_result,
            Err(SyncError::UnsupportedStagePlan { paths }) if paths == vec!["renamed.md"]
        ));
        assert_eq!(head(&repo), head_before);
        assert_eq!(cached_name_status(&repo), "");
    }

    #[test]
    fn pre_staged_changes_error_before_commit() {
        let repo = Repo::new();
        repo.commit("already.md", "old", "init");
        repo.write("already.md", "staged");
        git(&["add", "already.md"], repo.path());
        let head_before = head(&repo);

        let result =
            local_sync_commit_with_timestamp(repo.path(), &config(vec!["**/*.md"], vec![]), "ts");

        assert!(matches!(
            result,
            Err(SyncError::UnsafeGitState {
                kind: UnsafeKind::IndexNotClean
            })
        ));
        assert_eq!(head(&repo), head_before);
        assert_eq!(cached_name_status(&repo), "M\talready.md\n");
    }

    #[test]
    fn skip_commit_hooks_true_uses_no_verify_behavior() {
        let repo = Repo::new();
        repo.commit("note.md", "old", "init");
        repo.write("note.md", "new");
        write_failing_pre_commit_hook(&repo);
        let mut config = config(vec!["**/*.md"], vec![]);
        config.skip_commit_hooks = true;

        let result = local_sync_commit_with_timestamp(repo.path(), &config, "ts").unwrap();

        assert!(result.mutated);
        assert!(result.commit.is_some());
    }

    #[test]
    fn skip_commit_hooks_false_does_not_use_no_verify_behavior() {
        let repo = Repo::new();
        repo.commit("note.md", "old", "init");
        repo.write("note.md", "new");
        write_failing_pre_commit_hook(&repo);
        let mut config = config(vec!["**/*.md"], vec![]);
        config.skip_commit_hooks = false;
        let head_before = head(&repo);

        let result = local_sync_commit_with_timestamp(repo.path(), &config, "ts");

        assert!(matches!(result, Err(SyncError::GitCommandFailed { .. })));
        assert_eq!(head(&repo), head_before);
        assert_eq!(cached_name_status(&repo), "M\tnote.md\n");
    }

    #[test]
    fn commit_message_renders_timestamp_and_host() {
        let repo = Repo::new();
        repo.commit("note.md", "old", "init");
        repo.write("note.md", "new");
        let mut config = config(vec!["**/*.md"], vec![]);
        config.commit_message_template = "sync {timestamp} {host}".into();
        config.host_label = Some("workstation".into());

        let result = local_sync_commit_with_timestamp(repo.path(), &config, "fixed-ts").unwrap();

        let commit = result.commit.unwrap();
        assert_eq!(commit.message, "sync fixed-ts workstation");
        assert!(!commit.message.contains("{timestamp}"));
        assert!(!commit.message.contains("{host}"));
        assert_eq!(last_commit_message(&repo), "sync fixed-ts workstation");
    }

    #[test]
    fn commit_message_uses_local_when_host_label_is_none() {
        let mut config = config(vec!["**/*.md"], vec![]);
        config.host_label = None;
        config.commit_message_template = "sync {timestamp} {host}".into();

        assert_eq!(render_commit_message(&config, "ts"), "sync ts local");
    }

    #[test]
    fn commit_sha_returned_matches_head() {
        let repo = Repo::new();
        repo.commit("note.md", "old", "init");
        repo.write("note.md", "new");

        let result =
            local_sync_commit_with_timestamp(repo.path(), &config(vec!["**/*.md"], vec![]), "ts")
                .unwrap();

        assert_eq!(result.commit.unwrap().sha, head(&repo));
    }

    #[test]
    fn excluded_file_remains_unstaged_and_uncommitted() {
        let repo = Repo::new();
        repo.commit("note.md", "old note", "note");
        repo.commit("Scripts/build.md", "old script", "script");
        repo.write("note.md", "new note");
        repo.write("Scripts/build.md", "new script");

        let result = local_sync_commit_with_timestamp(
            repo.path(),
            &config(vec!["**/*.md"], vec!["Scripts/**"]),
            "ts",
        )
        .unwrap();

        assert!(result.mutated);
        assert!(result.commit.is_some());
        assert_eq!(cached_name_status(&repo), "");
        assert!(porcelain(&repo).contains(" M Scripts/build.md"));
    }
}

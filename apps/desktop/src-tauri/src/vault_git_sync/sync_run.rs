use std::path::Path;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;

use crate::vault_git_sync::cli::GitCmd;
use crate::vault_git_sync::config::SyncConfig;
use crate::vault_git_sync::errors::SyncError;
use crate::vault_git_sync::local_commit::{local_sync_commit, LocalCommitResult};
use crate::vault_git_sync::lock::VaultSyncLock;
use crate::vault_git_sync::validation::validate_all;

const SNAPSHOT_BRANCH_RETRIES: usize = 8;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncRunResult {
    pub local_commit: LocalCommitResult,
    pub pre_merge_sha: Option<String>,
    pub pushed: bool,
    pub snapshot_branch: Option<String>,
    pub final_head_sha: Option<String>,
}

pub fn sync_fetch_merge_push(
    vault_path: &Path,
    locks_dir: &Path,
    config: &SyncConfig,
) -> Result<SyncRunResult, SyncError> {
    let _lock = VaultSyncLock::try_acquire(locks_dir, vault_path)?;
    config.validate()?;
    validate_all(vault_path, &config.branch, &config.remote)?;

    let local_commit = local_sync_commit(vault_path, config)?;
    let pre_merge_sha = read_head_sha(vault_path)?;

    fetch(vault_path, config)?;
    let remote_ref = format!("refs/remotes/{}/{}", config.remote, config.branch);
    verify_remote_branch(vault_path, config, &remote_ref)?;

    if let Err(err) = merge_remote(vault_path, config, &remote_ref) {
        let merge_error = recover_after_merge_failure(vault_path, &pre_merge_sha, err)?;
        return Err(merge_error);
    }

    push(vault_path, config)?;
    let final_head_sha = read_head_sha(vault_path)?;

    Ok(SyncRunResult {
        local_commit,
        pre_merge_sha: Some(pre_merge_sha),
        pushed: true,
        snapshot_branch: None,
        final_head_sha: Some(final_head_sha),
    })
}

fn fetch(vault_path: &Path, config: &SyncConfig) -> Result<(), SyncError> {
    let out = GitCmd::new(vault_path, &["fetch", &config.remote])
        .timeout(Duration::from_secs(config.timeouts.fetch_secs.into()))
        .run()?;
    if out.success {
        return Ok(());
    }
    Err(SyncError::FetchFailed { stderr: out.stderr })
}

fn verify_remote_branch(
    vault_path: &Path,
    config: &SyncConfig,
    remote_ref: &str,
) -> Result<(), SyncError> {
    let out = GitCmd::new(vault_path, &["rev-parse", "--verify", remote_ref]).run()?;
    if out.success {
        return Ok(());
    }
    Err(SyncError::RemoteBranchMissing {
        remote: config.remote.clone(),
        branch: config.branch.clone(),
    })
}

fn merge_remote(vault_path: &Path, config: &SyncConfig, remote_ref: &str) -> Result<(), String> {
    let out = GitCmd::new(vault_path, &["merge", "--no-edit", remote_ref])
        .timeout(Duration::from_secs(config.timeouts.merge_secs.into()))
        .run()
        .map_err(|err| format!("{err:?}"))?;
    if out.success {
        return Ok(());
    }
    Err(out.stderr)
}

fn push(vault_path: &Path, config: &SyncConfig) -> Result<(), SyncError> {
    let refspec = format!("HEAD:{}", config.branch);
    let out = GitCmd::new(vault_path, &["push", &config.remote, &refspec])
        .timeout(Duration::from_secs(config.timeouts.push_secs.into()))
        .run()?;
    if out.success {
        return Ok(());
    }
    Err(SyncError::PushRejected { stderr: out.stderr })
}

fn abort_merge(vault_path: &Path) -> Result<(), SyncError> {
    let out = GitCmd::new(vault_path, &["merge", "--abort"]).run()?;
    if out.success {
        return Ok(());
    }
    Err(SyncError::GitCommandFailed {
        command: "git merge --abort".into(),
        exit_code: out.exit_code,
        stderr: out.stderr,
    })
}

fn create_snapshot_branch_with_timestamp(
    vault_path: &Path,
    pre_merge_sha: &str,
    timestamp: &str,
) -> Result<String, SyncError> {
    let mut last_stderr = String::new();
    let mut last_exit_code = None;

    for attempt in 1..=SNAPSHOT_BRANCH_RETRIES {
        let branch = snapshot_branch_name(timestamp, attempt);
        let out = GitCmd::new(vault_path, &["branch", &branch, pre_merge_sha]).run()?;
        if out.success {
            return Ok(branch);
        }
        last_stderr = out.stderr;
        last_exit_code = out.exit_code;
        if is_snapshot_branch_collision(&last_stderr) {
            continue;
        }
        return Err(SyncError::GitCommandFailed {
            command: "git branch <snapshot> <pre_merge_sha>".into(),
            exit_code: last_exit_code,
            stderr: last_stderr,
        });
    }

    Err(SyncError::GitCommandFailed {
        command: "git branch <snapshot> <pre_merge_sha>".into(),
        exit_code: last_exit_code,
        stderr: format!(
            "could not create unique snapshot branch after {SNAPSHOT_BRANCH_RETRIES} attempts: {last_stderr}"
        ),
    })
}

fn snapshot_branch_name(timestamp: &str, attempt: usize) -> String {
    let branch = format!("eskerra/sync-snapshot-{timestamp}");
    if attempt == 1 {
        branch
    } else {
        format!("{branch}-{attempt}")
    }
}

fn is_snapshot_branch_collision(stderr: &str) -> bool {
    stderr.contains("already exists") || stderr.contains("a branch named")
}

fn recover_after_merge_failure(
    vault_path: &Path,
    pre_merge_sha: &str,
    merge_stderr: String,
) -> Result<SyncError, SyncError> {
    let snapshot_result = match snapshot_timestamp() {
        Ok(timestamp) => {
            create_snapshot_branch_with_timestamp(vault_path, pre_merge_sha, &timestamp)
        }
        Err(err) => Err(err),
    };
    finish_merge_failure_recovery(vault_path, pre_merge_sha, merge_stderr, snapshot_result)
}

fn recover_after_merge_failure_with_snapshot_timestamp(
    vault_path: &Path,
    pre_merge_sha: &str,
    merge_stderr: String,
    timestamp: &str,
) -> Result<SyncError, SyncError> {
    let snapshot_result =
        create_snapshot_branch_with_timestamp(vault_path, pre_merge_sha, timestamp);
    finish_merge_failure_recovery(vault_path, pre_merge_sha, merge_stderr, snapshot_result)
}

fn finish_merge_failure_recovery(
    vault_path: &Path,
    pre_merge_sha: &str,
    merge_stderr: String,
    snapshot_result: Result<String, SyncError>,
) -> Result<SyncError, SyncError> {
    let unresolved_error = unresolved_paths(vault_path).err();
    let (snapshot_branch, snapshot_error) = match snapshot_result {
        Ok(branch) => (Some(branch), None),
        Err(err) => (None, Some(err)),
    };

    abort_merge(vault_path)?;

    Ok(SyncError::MergeFailed {
        stderr: merge_failed_stderr(merge_stderr, snapshot_error, unresolved_error),
        snapshot_branch,
        pre_merge_sha: Some(pre_merge_sha.to_string()),
    })
}

fn merge_failed_stderr(
    mut merge_stderr: String,
    snapshot_error: Option<SyncError>,
    unresolved_error: Option<SyncError>,
) -> String {
    if let Some(err) = snapshot_error {
        merge_stderr.push_str("\nSnapshot branch creation failed: ");
        merge_stderr.push_str(&format!("{err:?}"));
    }
    if let Some(err) = unresolved_error {
        merge_stderr.push_str("\nUnresolved path inspection failed: ");
        merge_stderr.push_str(&format!("{err:?}"));
    }
    merge_stderr
}

fn unresolved_paths(vault_path: &Path) -> Result<Vec<String>, SyncError> {
    let out = GitCmd::new(
        vault_path,
        &["diff", "--name-only", "--diff-filter=U", "-z"],
    )
    .run()?;
    if !out.success {
        return Err(SyncError::GitCommandFailed {
            command: "git diff --name-only --diff-filter=U -z".into(),
            exit_code: out.exit_code,
            stderr: out.stderr,
        });
    }
    Ok(out
        .stdout
        .split('\0')
        .filter(|path| !path.is_empty())
        .map(ToString::to_string)
        .collect())
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

fn snapshot_timestamp() -> Result<String, SyncError> {
    let dur = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|err| SyncError::GitCommandFailed {
            command: "system time".into(),
            exit_code: None,
            stderr: err.to_string(),
        })?;
    Ok(format!("{}{:03}", dur.as_secs(), dur.subsec_millis()))
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

    struct Fixture {
        local: TempDir,
        remote: TempDir,
        locks: TempDir,
    }

    impl Fixture {
        fn new() -> Self {
            let seed = tempfile::tempdir().unwrap();
            git(&["-c", "init.defaultBranch=main", "init"], seed.path());
            configure_user(seed.path());
            write(seed.path(), "base.md", "base");
            git(&["add", "base.md"], seed.path());
            git(&["commit", "--no-gpg-sign", "-m", "init"], seed.path());

            let remote = tempfile::tempdir().unwrap();
            git(
                &[
                    "clone",
                    "--bare",
                    seed.path().to_str().unwrap(),
                    remote.path().to_str().unwrap(),
                ],
                seed.path(),
            );

            let local = tempfile::tempdir().unwrap();
            git(
                &[
                    "clone",
                    remote.path().to_str().unwrap(),
                    local.path().to_str().unwrap(),
                ],
                seed.path(),
            );
            configure_user(local.path());
            git(
                &["branch", "--set-upstream-to=origin/main", "main"],
                local.path(),
            );

            Self {
                local,
                remote,
                locks: tempfile::tempdir().unwrap(),
            }
        }

        fn local_path(&self) -> &Path {
            self.local.path()
        }

        fn locks_path(&self) -> &Path {
            self.locks.path()
        }

        fn config(&self) -> SyncConfig {
            let mut config = config();
            config.remote = "origin".into();
            config
        }

        fn remote_clone(&self) -> TempDir {
            let dir = tempfile::tempdir().unwrap();
            git(
                &[
                    "clone",
                    self.remote.path().to_str().unwrap(),
                    dir.path().to_str().unwrap(),
                ],
                self.local_path(),
            );
            configure_user(dir.path());
            dir
        }
    }

    fn config() -> SyncConfig {
        SyncConfig {
            remote: "origin".into(),
            branch: "main".into(),
            include: vec!["**/*.md".into()],
            exclude: vec!["Scripts/**".into()],
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
            commit_message_template: "sync {timestamp} {host}".into(),
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

    fn configure_user(path: &Path) {
        git(&["config", "user.email", "t@t.com"], path);
        git(&["config", "user.name", "T"], path);
        git(&["config", "commit.gpgsign", "false"], path);
    }

    fn write(repo: &Path, file: &str, content: &str) {
        if let Some(parent) = Path::new(file).parent() {
            std::fs::create_dir_all(repo.join(parent)).unwrap();
        }
        std::fs::write(repo.join(file), content).unwrap();
    }

    fn commit(repo: &Path, file: &str, content: &str, msg: &str) {
        write(repo, file, content);
        git(&["add", file], repo);
        git(&["commit", "--no-gpg-sign", "-m", msg], repo);
    }

    fn head(repo: &Path) -> String {
        let out = git(&["rev-parse", "HEAD"], repo);
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    }

    fn remote_main(remote: &Path) -> String {
        let out = git(&["rev-parse", "main"], remote);
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    }

    fn merge_head_exists(repo: &Path) -> bool {
        repo.join(".git/MERGE_HEAD").exists()
    }

    fn branch_sha(repo: &Path, branch: &str) -> String {
        let out = git(&["rev-parse", branch], repo);
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    }

    #[test]
    fn sync_run_result_serializes_camel_case_fields() {
        use crate::vault_git_sync::local_commit::CommitInfo;
        use crate::vault_git_sync::stage_plan::{
            StageApplyResult, StagePlanChange, StagePlanEntry, StagePlanReason,
        };

        let result = SyncRunResult {
            local_commit: LocalCommitResult {
                stage_result: StageApplyResult {
                    staged_paths: vec![StagePlanEntry {
                        path: "note.md".into(),
                        change: StagePlanChange::ModifiedTracked,
                        reason: StagePlanReason::Included,
                    }],
                    excluded_paths: vec![],
                    unsupported_paths: vec![],
                    mutated: true,
                },
                commit: Some(CommitInfo {
                    sha: "abc123".into(),
                    message: "sync".into(),
                }),
                mutated: true,
            },
            pre_merge_sha: Some("abc123".into()),
            pushed: true,
            snapshot_branch: Some("eskerra/sync-snapshot-1".into()),
            final_head_sha: Some("def456".into()),
        };

        let value = serde_json::to_value(result).unwrap();

        assert_eq!(
            value["localCommit"]["stageResult"]["stagedPaths"][0]["path"],
            "note.md"
        );
        assert_eq!(value["localCommit"]["commit"]["sha"], "abc123");
        assert_eq!(value["preMergeSha"], "abc123");
        assert_eq!(value["snapshotBranch"], "eskerra/sync-snapshot-1");
        assert_eq!(value["finalHeadSha"], "def456");
        assert!(value.get("local_commit").is_none());
        assert!(value["localCommit"].get("stage_result").is_none());
    }

    fn put_local_repo_in_merge_conflict(f: &Fixture) -> String {
        write(f.local_path(), "base.md", "local");
        git(&["add", "base.md"], f.local_path());
        git(&["commit", "--no-gpg-sign", "-m", "local"], f.local_path());
        let pre_merge_sha = head(f.local_path());

        let other = f.remote_clone();
        commit(other.path(), "base.md", "remote", "remote");
        git(&["push", "origin", "main"], other.path());

        git(&["fetch", "origin"], f.local_path());
        let out = git(
            &["merge", "--no-edit", "refs/remotes/origin/main"],
            f.local_path(),
        );
        assert!(!out.status.success(), "merge should conflict");
        assert!(merge_head_exists(f.local_path()));
        pre_merge_sha
    }

    #[test]
    fn clean_local_and_remote_succeeds_without_local_commit() {
        let f = Fixture::new();

        let result = sync_fetch_merge_push(f.local_path(), f.locks_path(), &f.config()).unwrap();

        assert!(result.local_commit.commit.is_none());
        assert!(result.pushed);
        assert_eq!(
            result.final_head_sha.as_deref(),
            Some(head(f.local_path()).as_str())
        );
    }

    #[test]
    fn local_changes_only_commit_and_push() {
        let f = Fixture::new();
        write(f.local_path(), "local.md", "local");

        let result = sync_fetch_merge_push(f.local_path(), f.locks_path(), &f.config()).unwrap();

        assert!(result.local_commit.commit.is_some());
        assert_eq!(remote_main(f.remote.path()), head(f.local_path()));
    }

    #[test]
    fn remote_changes_only_merge_and_push_succeeds() {
        let f = Fixture::new();
        let other = f.remote_clone();
        commit(other.path(), "remote.md", "remote", "remote");
        git(&["push", "origin", "main"], other.path());
        let remote_head = remote_main(f.remote.path());

        let result = sync_fetch_merge_push(f.local_path(), f.locks_path(), &f.config()).unwrap();

        assert!(result.local_commit.commit.is_none());
        assert_eq!(head(f.local_path()), remote_head);
        assert_eq!(remote_main(f.remote.path()), remote_head);
    }

    #[test]
    fn local_and_remote_non_conflicting_changes_merge_and_push() {
        let f = Fixture::new();
        write(f.local_path(), "local.md", "local");
        let other = f.remote_clone();
        commit(other.path(), "remote.md", "remote", "remote");
        git(&["push", "origin", "main"], other.path());

        let result = sync_fetch_merge_push(f.local_path(), f.locks_path(), &f.config()).unwrap();

        assert!(result.local_commit.commit.is_some());
        assert_eq!(remote_main(f.remote.path()), head(f.local_path()));
    }

    #[test]
    fn missing_remote_branch_after_fetch_returns_remote_branch_missing() {
        let f = Fixture::new();
        git(&["switch", "-c", "missing"], f.local_path());
        let mut config = f.config();
        config.branch = "missing".into();

        let result = sync_fetch_merge_push(f.local_path(), f.locks_path(), &config);

        assert!(matches!(
            result,
            Err(SyncError::RemoteBranchMissing {
                remote,
                branch
            }) if remote == "origin" && branch == "missing"
        ));
    }

    #[test]
    fn merge_conflict_snapshots_aborts_and_does_not_push() {
        let f = Fixture::new();
        write(f.local_path(), "base.md", "local");
        let other = f.remote_clone();
        commit(other.path(), "base.md", "remote", "remote");
        git(&["push", "origin", "main"], other.path());
        let remote_before = remote_main(f.remote.path());

        let result = sync_fetch_merge_push(f.local_path(), f.locks_path(), &f.config());

        let Err(SyncError::MergeFailed {
            snapshot_branch,
            pre_merge_sha,
            ..
        }) = result
        else {
            panic!("expected MergeFailed");
        };
        let snapshot_branch = snapshot_branch.unwrap();
        let pre_merge_sha = pre_merge_sha.unwrap();
        assert!(!merge_head_exists(f.local_path()));
        assert_eq!(head(f.local_path()), pre_merge_sha);
        assert_eq!(branch_sha(f.local_path(), &snapshot_branch), pre_merge_sha);
        assert_eq!(remote_main(f.remote.path()), remote_before);
    }

    #[test]
    fn snapshot_branch_collision_creates_unique_snapshot_and_aborts() {
        let f = Fixture::new();
        let pre_merge_sha = put_local_repo_in_merge_conflict(&f);
        git(
            &["branch", "eskerra/sync-snapshot-fixed", &pre_merge_sha],
            f.local_path(),
        );

        let result = recover_after_merge_failure_with_snapshot_timestamp(
            f.local_path(),
            &pre_merge_sha,
            "merge failed".into(),
            "fixed",
        )
        .unwrap();

        let SyncError::MergeFailed {
            snapshot_branch,
            pre_merge_sha: reported_pre_merge_sha,
            ..
        } = result
        else {
            panic!("expected MergeFailed");
        };
        let snapshot_branch = snapshot_branch.unwrap();
        assert_eq!(snapshot_branch, "eskerra/sync-snapshot-fixed-2");
        assert_eq!(
            reported_pre_merge_sha.as_deref(),
            Some(pre_merge_sha.as_str())
        );
        assert!(!merge_head_exists(f.local_path()));
        assert_eq!(head(f.local_path()), pre_merge_sha);
        assert_eq!(branch_sha(f.local_path(), &snapshot_branch), pre_merge_sha);
    }

    #[test]
    fn snapshot_creation_failure_still_attempts_merge_abort() {
        let f = Fixture::new();
        let pre_merge_sha = put_local_repo_in_merge_conflict(&f);
        std::fs::write(
            f.local_path().join(".git/refs/heads/eskerra"),
            "not a ref\n",
        )
        .unwrap();

        let result = recover_after_merge_failure_with_snapshot_timestamp(
            f.local_path(),
            &pre_merge_sha,
            "merge failed".into(),
            "fixed",
        )
        .unwrap();

        let SyncError::MergeFailed {
            stderr,
            snapshot_branch,
            pre_merge_sha: reported_pre_merge_sha,
        } = result
        else {
            panic!("expected MergeFailed");
        };
        assert!(snapshot_branch.is_none());
        assert_eq!(
            reported_pre_merge_sha.as_deref(),
            Some(pre_merge_sha.as_str())
        );
        assert!(stderr.contains("Snapshot branch creation failed"));
        assert!(!merge_head_exists(f.local_path()));
        assert_eq!(head(f.local_path()), pre_merge_sha);
    }

    #[test]
    fn merge_abort_failure_is_reported_clearly() {
        let f = Fixture::new();
        let pre_merge_sha = head(f.local_path());

        let result = recover_after_merge_failure_with_snapshot_timestamp(
            f.local_path(),
            &pre_merge_sha,
            "merge failed".into(),
            "fixed",
        );

        assert!(matches!(
            result,
            Err(SyncError::GitCommandFailed { command, .. }) if command == "git merge --abort"
        ));
    }

    #[test]
    fn push_rejection_returns_error_and_preserves_local_commit() {
        let f = Fixture::new();
        let hook = f.remote.path().join("hooks/pre-receive");
        std::fs::write(&hook, "#!/bin/sh\nexit 1\n").unwrap();
        #[cfg(unix)]
        {
            let mut permissions = std::fs::metadata(&hook).unwrap().permissions();
            permissions.set_mode(0o755);
            std::fs::set_permissions(&hook, permissions).unwrap();
        }
        write(f.local_path(), "local.md", "local");

        let result = sync_fetch_merge_push(f.local_path(), f.locks_path(), &f.config());

        assert!(matches!(result, Err(SyncError::PushRejected { .. })));
        assert!(head(f.local_path()) != remote_main(f.remote.path()));
    }

    #[test]
    fn lock_contention_returns_lock_already_held_without_mutation() {
        let f = Fixture::new();
        let _held = VaultSyncLock::try_acquire(f.locks_path(), f.local_path()).unwrap();
        write(f.local_path(), "local.md", "local");
        let head_before = head(f.local_path());

        let result = sync_fetch_merge_push(f.local_path(), f.locks_path(), &f.config());

        assert!(matches!(result, Err(SyncError::LockAlreadyHeld)));
        assert_eq!(head(f.local_path()), head_before);
    }

    #[test]
    fn wrong_branch_rejected_before_fetch_merge_push() {
        let f = Fixture::new();
        git(&["switch", "-c", "side"], f.local_path());
        let head_before = head(f.local_path());

        let result = sync_fetch_merge_push(f.local_path(), f.locks_path(), &f.config());

        assert!(matches!(result, Err(SyncError::WrongBranch { .. })));
        assert_eq!(head(f.local_path()), head_before);
    }

    #[test]
    fn pre_staged_changes_rejected_before_fetch_merge_push() {
        let f = Fixture::new();
        write(f.local_path(), "staged.md", "staged");
        git(&["add", "staged.md"], f.local_path());
        let head_before = head(f.local_path());

        let result = sync_fetch_merge_push(f.local_path(), f.locks_path(), &f.config());

        assert!(matches!(
            result,
            Err(SyncError::UnsafeGitState {
                kind: UnsafeKind::IndexNotClean
            })
        ));
        assert_eq!(head(f.local_path()), head_before);
    }
}

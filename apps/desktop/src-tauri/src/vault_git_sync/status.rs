use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Serialize;

use crate::vault_git_sync::cli::GitCmd;
use crate::vault_git_sync::errors::SyncError;
use crate::vault_git_sync::validation::{validate_is_git_repo, validate_vault_path};

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum GitStatusUnsafeState {
    DetachedHead,
    Merge,
    Rebase,
    CherryPick,
    Revert,
    Bisect,
    IndexLock,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusResult {
    /// Current branch name, or None when HEAD is detached.
    pub branch: Option<String>,
    /// The branch name that sync expects (from config).
    pub expected_branch: String,
    /// Working tree has unstaged modifications to tracked files.
    pub has_uncommitted_changes: bool,
    /// Index has staged changes not yet committed.
    pub has_staged_changes: bool,
    /// Working tree contains files unknown to Git.
    pub has_untracked_files: bool,
    /// Local commits not present in the remote ref (local-only).
    pub ahead: u32,
    /// Remote-ref commits not present in HEAD (available to pull).
    pub behind: u32,
    /// False when the remote tracking ref (refs/remotes/{remote}/{branch})
    /// does not exist locally. ahead/behind are 0 in that case.
    pub remote_ref_available: bool,
    /// Set when the repo is in an operation state that blocks sync.
    pub unsafe_state: Option<GitStatusUnsafeState>,
    /// HEAD branch differs from expected_branch. Not a hard error.
    pub is_wrong_branch: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CurrentBranchResult {
    /// Current branch name, or None when HEAD is detached.
    pub branch: Option<String>,
    /// True when HEAD is detached and therefore unsafe for manual sync.
    pub detached_head: bool,
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/// Collect read-only status for a vault.
///
/// Fails with `SyncError::NotGitRepository` when `vault_path` is not a Git
/// repo root. All other conditions (wrong branch, unsafe state, missing remote
/// ref) are reflected in the returned struct rather than as errors.
///
/// Never fetches from the remote. Ahead/behind are derived from the local
/// remote-tracking ref only.
pub fn git_status(
    vault_path: &Path,
    expected_branch: &str,
    remote: &str,
) -> Result<GitStatusResult, SyncError> {
    validate_vault_path(vault_path)?;
    validate_is_git_repo(vault_path)?;

    let unsafe_state = detect_unsafe_state(vault_path)?;

    // When HEAD is detached symbolic-ref fails — treat that as DetachedHead
    // unsafe state regardless of what detect_unsafe_state returned.
    let branch = read_branch(vault_path)?;
    let unsafe_state = if branch.is_none() && unsafe_state.is_none() {
        Some(GitStatusUnsafeState::DetachedHead)
    } else {
        unsafe_state
    };

    let is_wrong_branch = branch.as_deref() != Some(expected_branch);

    let (has_uncommitted_changes, has_staged_changes, has_untracked_files) =
        parse_porcelain(vault_path)?;

    let remote_ref = format!("refs/remotes/{remote}/{expected_branch}");
    let (ahead, behind, remote_ref_available) = read_ahead_behind(vault_path, &remote_ref)?;

    Ok(GitStatusResult {
        branch,
        expected_branch: expected_branch.to_string(),
        has_uncommitted_changes,
        has_staged_changes,
        has_untracked_files,
        ahead,
        behind,
        remote_ref_available,
        unsafe_state,
        is_wrong_branch,
    })
}

/// Returns the currently checked-out branch state.
pub fn current_branch(vault_path: &Path) -> Result<CurrentBranchResult, SyncError> {
    validate_vault_path(vault_path)?;
    validate_is_git_repo(vault_path)?;
    let branch = read_branch(vault_path)?;
    let detached_head = branch.is_none();
    Ok(CurrentBranchResult {
        branch,
        detached_head,
    })
}

/// Fetches `remote/expected_branch` (updating the local remote-tracking ref),
/// then returns the current local status.
///
/// HEAD and the working tree are never modified — only
/// `refs/remotes/{remote}/{expected_branch}` is updated.
pub fn remote_status(
    vault_path: &Path,
    expected_branch: &str,
    remote: &str,
    fetch_timeout_secs: u32,
) -> Result<GitStatusResult, SyncError> {
    validate_vault_path(vault_path)?;
    validate_is_git_repo(vault_path)?;
    fetch_remote(vault_path, remote, expected_branch, fetch_timeout_secs)?;
    git_status(vault_path, expected_branch, remote)
}

// ---------------------------------------------------------------------------
// Remote fetch
// ---------------------------------------------------------------------------

fn fetch_remote(
    vault_path: &Path,
    remote: &str,
    branch: &str,
    timeout_secs: u32,
) -> Result<(), SyncError> {
    let timeout = Duration::from_secs(u64::from(timeout_secs));
    let out = GitCmd::new(vault_path, &["fetch", "--quiet", "--prune", remote, branch])
        .timeout(timeout)
        .run()?;
    if !out.success {
        return Err(SyncError::FetchFailed { stderr: out.stderr });
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Branch
// ---------------------------------------------------------------------------

/// Returns Some(branch_name) or None when HEAD is detached.
fn read_branch(vault_path: &Path) -> Result<Option<String>, SyncError> {
    let out = GitCmd::new(vault_path, &["symbolic-ref", "--short", "HEAD"]).run()?;
    if out.success {
        Ok(Some(out.stdout.trim().to_string()))
    } else {
        Ok(None)
    }
}

// ---------------------------------------------------------------------------
// Unsafe-state detection (filesystem-only, no git commands)
// ---------------------------------------------------------------------------

fn detect_unsafe_state(vault_path: &Path) -> Result<Option<GitStatusUnsafeState>, SyncError> {
    let gd = git_dir(vault_path)?;

    if gd.join("MERGE_HEAD").exists() {
        return Ok(Some(GitStatusUnsafeState::Merge));
    }
    if gd.join("REBASE_HEAD").exists()
        || gd.join("rebase-merge").is_dir()
        || gd.join("rebase-apply").is_dir()
    {
        return Ok(Some(GitStatusUnsafeState::Rebase));
    }
    if gd.join("CHERRY_PICK_HEAD").exists() {
        return Ok(Some(GitStatusUnsafeState::CherryPick));
    }
    if gd.join("REVERT_HEAD").exists() {
        return Ok(Some(GitStatusUnsafeState::Revert));
    }
    if gd.join("BISECT_LOG").exists() {
        return Ok(Some(GitStatusUnsafeState::Bisect));
    }
    if gd.join("index.lock").exists() {
        return Ok(Some(GitStatusUnsafeState::IndexLock));
    }
    Ok(None)
}

fn git_dir(vault_path: &Path) -> Result<PathBuf, SyncError> {
    let out = GitCmd::new(vault_path, &["rev-parse", "--absolute-git-dir"]).run()?;
    if !out.success {
        return Err(SyncError::NotGitRepository);
    }
    Ok(PathBuf::from(out.stdout.trim()))
}

// ---------------------------------------------------------------------------
// Porcelain v2 parser
// ---------------------------------------------------------------------------

/// Parse `git status --porcelain=v2 -z` output.
///
/// Returns (has_uncommitted_changes, has_staged_changes, has_untracked_files).
///
/// Porcelain v2 record types used here:
///   `1 <XY> ...`  — ordinary changed entry
///   `2 <XY> ...`  — renamed/copied entry
///   `u <XY> ...`  — unmerged entry
///   `? ...`        — untracked entry
///   `! ...`        — ignored entry (skipped)
///
/// For entries with an XY field:
///   X = index (staged) status character
///   Y = worktree (unstaged) status character
///   `.` means unmodified in that column
///
/// Ref: git-status(1) "Porcelain Format Version 2"
fn parse_porcelain(vault_path: &Path) -> Result<(bool, bool, bool), SyncError> {
    let out = GitCmd::new(vault_path, &["status", "--porcelain=v2", "-z"]).run()?;
    if !out.success {
        return Err(SyncError::GitCommandFailed {
            command: "git status --porcelain=v2 -z".into(),
            exit_code: out.exit_code,
            stderr: out.stderr,
        });
    }

    // -z: records are NUL-terminated (and renamed entries have a second NUL-separated path)
    // We only need the first token of each record to identify type and XY.
    let mut has_uncommitted = false;
    let mut has_staged = false;
    let mut has_untracked = false;

    for record in out.stdout.split('\0') {
        let record = record.trim_end_matches('\n');
        if record.is_empty() {
            continue;
        }

        // Header lines start with `#`; skip them.
        if record.starts_with('#') {
            continue;
        }

        // Untracked: `? <path>`
        if record.starts_with('?') {
            has_untracked = true;
            continue;
        }

        // Ignored: `! <path>` — not relevant for sync status
        if record.starts_with('!') {
            continue;
        }

        // Ordinary changed (`1`) or renamed/copied (`2`): `<type> <XY> ...`
        // Unmerged (`u`): `u <XY> ...`
        // All have XY as the second space-delimited token.
        let mut tokens = record.splitn(3, ' ');
        let kind = tokens.next().unwrap_or("");
        if kind != "1" && kind != "2" && kind != "u" {
            continue;
        }

        let xy = tokens.next().unwrap_or("..");
        let x = xy.chars().next().unwrap_or('.');
        let y = xy.chars().nth(1).unwrap_or('.');

        // X != '.' means something is staged in the index.
        if x != '.' {
            has_staged = true;
        }
        // Y != '.' means the worktree copy differs from the index/HEAD.
        if y != '.' {
            has_uncommitted = true;
        }
    }

    Ok((has_uncommitted, has_staged, has_untracked))
}

// ---------------------------------------------------------------------------
// Ahead / behind
// ---------------------------------------------------------------------------

/// Count commits HEAD is ahead of and behind `remote_ref`.
///
/// Uses `git rev-list --left-right --count HEAD...{remote_ref}`.
/// Left count  = ahead  (commits in HEAD not in remote_ref)
/// Right count = behind (commits in remote_ref not in HEAD)
///
/// Returns (ahead, behind, remote_ref_available).
/// When the ref does not exist locally, returns (0, 0, false) without fetching.
fn read_ahead_behind(vault_path: &Path, remote_ref: &str) -> Result<(u32, u32, bool), SyncError> {
    // Probe whether the ref exists locally before running rev-list.
    let probe = GitCmd::new(vault_path, &["rev-parse", "--verify", remote_ref]).run()?;
    if !probe.success {
        return Ok((0, 0, false));
    }

    let range = format!("HEAD...{remote_ref}");
    let out = GitCmd::new(vault_path, &["rev-list", "--left-right", "--count", &range]).run()?;

    if !out.success {
        // e.g. empty repo with no commits — treat as 0/0 but ref was present
        return Ok((0, 0, true));
    }

    let (ahead, behind) = parse_rev_list_count(out.stdout.trim())?;
    Ok((ahead, behind, true))
}

/// Parse `<left>\t<right>` output from `rev-list --left-right --count`.
fn parse_rev_list_count(s: &str) -> Result<(u32, u32), SyncError> {
    let mut parts = s.split_whitespace();
    let ahead: u32 =
        parts
            .next()
            .and_then(|v| v.parse().ok())
            .ok_or_else(|| SyncError::GitCommandFailed {
                command: "rev-list --left-right --count".into(),
                exit_code: None,
                stderr: format!("unexpected rev-list output: {s:?}"),
            })?;
    let behind: u32 =
        parts
            .next()
            .and_then(|v| v.parse().ok())
            .ok_or_else(|| SyncError::GitCommandFailed {
                command: "rev-list --left-right --count".into(),
                exit_code: None,
                stderr: format!("unexpected rev-list output: {s:?}"),
            })?;
    Ok((ahead, behind))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;
    use std::process::Command;
    use tempfile::TempDir;

    // -----------------------------------------------------------------------
    // Repo helper
    // -----------------------------------------------------------------------

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

        fn commit(&self, file: &str, content: &str, msg: &str) {
            std::fs::write(self.dir.path().join(file), content).unwrap();
            git(&["add", file], self.path());
            git(&["commit", "--no-gpg-sign", "-m", msg], self.path());
        }

        /// Create a bare clone of self, add it as `origin`, and configure the
        /// tracking branch so rev-list works.
        fn add_remote_origin(&self) -> TempDir {
            let remote_dir = tempfile::tempdir().unwrap();
            git(
                &[
                    "clone",
                    "--bare",
                    self.path().to_str().unwrap(),
                    remote_dir.path().to_str().unwrap(),
                ],
                self.path(),
            );
            git(
                &[
                    "remote",
                    "add",
                    "origin",
                    remote_dir.path().to_str().unwrap(),
                ],
                self.path(),
            );
            git(&["fetch", "origin"], self.path());
            git(
                &["branch", "--set-upstream-to=origin/main", "main"],
                self.path(),
            );
            remote_dir
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

    // -----------------------------------------------------------------------
    // 1. Clean repo on expected branch
    // -----------------------------------------------------------------------

    #[test]
    fn clean_repo_no_changes() {
        let repo = Repo::new();
        repo.commit("f.txt", "a", "init");
        let _remote = repo.add_remote_origin();

        let result = git_status(repo.path(), "main", "origin").unwrap();
        assert_eq!(result.branch.as_deref(), Some("main"));
        assert!(!result.has_uncommitted_changes);
        assert!(!result.has_staged_changes);
        assert!(!result.has_untracked_files);
        assert_eq!(result.ahead, 0);
        assert_eq!(result.behind, 0);
        assert!(result.remote_ref_available);
        assert!(result.unsafe_state.is_none());
        assert!(!result.is_wrong_branch);
    }

    // -----------------------------------------------------------------------
    // 2. Modified tracked file
    // -----------------------------------------------------------------------

    #[test]
    fn modified_tracked_file_has_uncommitted_changes() {
        let repo = Repo::new();
        repo.commit("f.txt", "a", "init");
        std::fs::write(repo.path().join("f.txt"), "modified").unwrap();

        let result = git_status(repo.path(), "main", "origin").unwrap();
        assert!(result.has_uncommitted_changes);
        assert!(!result.has_staged_changes);
    }

    // -----------------------------------------------------------------------
    // 3. Staged file
    // -----------------------------------------------------------------------

    #[test]
    fn staged_file_has_staged_changes() {
        let repo = Repo::new();
        repo.commit("f.txt", "a", "init");
        std::fs::write(repo.path().join("new.txt"), "new").unwrap();
        git(&["add", "new.txt"], repo.path());

        let result = git_status(repo.path(), "main", "origin").unwrap();
        assert!(result.has_staged_changes);
    }

    #[test]
    fn git_status_propagates_porcelain_failure() {
        let repo = Repo::new();
        repo.commit("f.txt", "a", "init");
        std::fs::write(repo.path().join(".git").join("index"), b"corrupt-index").unwrap();

        let result = git_status(repo.path(), "main", "origin");

        assert!(matches!(
            result,
            Err(SyncError::GitCommandFailed { command, .. })
                if command == "git status --porcelain=v2 -z"
        ));
    }

    // -----------------------------------------------------------------------
    // 4. Untracked file
    // -----------------------------------------------------------------------

    #[test]
    fn untracked_file_detected() {
        let repo = Repo::new();
        repo.commit("f.txt", "a", "init");
        std::fs::write(repo.path().join("untracked.txt"), "x").unwrap();

        let result = git_status(repo.path(), "main", "origin").unwrap();
        assert!(result.has_untracked_files);
    }

    // -----------------------------------------------------------------------
    // 5. Wrong branch — no hard failure, is_wrong_branch true
    // -----------------------------------------------------------------------

    #[test]
    fn wrong_branch_no_failure() {
        let repo = Repo::new();
        repo.commit("f.txt", "a", "init");
        git(&["checkout", "-b", "feature"], repo.path());

        let result = git_status(repo.path(), "main", "origin").unwrap();
        assert!(result.is_wrong_branch);
        assert_eq!(result.branch.as_deref(), Some("feature"));
        assert_eq!(result.expected_branch, "main");
    }

    #[test]
    fn current_branch_reads_main_branch() {
        let repo = Repo::new();
        repo.commit("f.txt", "a", "init");

        let result = current_branch(repo.path()).unwrap();

        assert_eq!(result.branch.as_deref(), Some("main"));
        assert!(!result.detached_head);
    }

    #[test]
    fn current_branch_reads_master_branch() {
        let repo = Repo::new();
        repo.commit("f.txt", "a", "init");
        git(&["checkout", "-b", "master"], repo.path());

        let result = current_branch(repo.path()).unwrap();

        assert_eq!(result.branch.as_deref(), Some("master"));
        assert!(!result.detached_head);
    }

    // -----------------------------------------------------------------------
    // 6. Detached HEAD
    // -----------------------------------------------------------------------

    #[test]
    fn detached_head_unsafe_state() {
        let repo = Repo::new();
        repo.commit("f.txt", "a", "init");
        git(&["checkout", "--detach"], repo.path());

        let result = git_status(repo.path(), "main", "origin").unwrap();
        assert_eq!(
            result.unsafe_state,
            Some(GitStatusUnsafeState::DetachedHead)
        );
        assert!(result.branch.is_none());
    }

    #[test]
    fn current_branch_returns_none_for_detached_head() {
        let repo = Repo::new();
        repo.commit("f.txt", "a", "init");
        git(&["checkout", "--detach"], repo.path());

        let result = current_branch(repo.path()).unwrap();

        assert!(result.branch.is_none());
        assert!(result.detached_head);
    }

    // -----------------------------------------------------------------------
    // 7. Merge in progress
    // -----------------------------------------------------------------------

    #[test]
    fn merge_in_progress_unsafe_state() {
        let repo = Repo::new();
        repo.commit("f.txt", "base", "init");
        git(&["checkout", "-b", "side"], repo.path());
        repo.commit("f.txt", "side", "side commit");
        git(&["checkout", "main"], repo.path());
        repo.commit("f.txt", "main", "main commit");
        let _ = git(&["merge", "--no-edit", "side"], repo.path());

        let result = git_status(repo.path(), "main", "origin").unwrap();
        assert_eq!(result.unsafe_state, Some(GitStatusUnsafeState::Merge));
    }

    // -----------------------------------------------------------------------
    // 8. Rebase in progress
    // -----------------------------------------------------------------------

    #[test]
    fn rebase_in_progress_unsafe_state() {
        let repo = Repo::new();
        repo.commit("f.txt", "base", "init");
        git(&["checkout", "-b", "side"], repo.path());
        repo.commit("f.txt", "side", "side commit");
        git(&["checkout", "main"], repo.path());
        repo.commit("f.txt", "main", "main commit");
        git(&["checkout", "side"], repo.path());
        let _ = git(&["rebase", "main"], repo.path());

        let result = git_status(repo.path(), "side", "origin").unwrap();
        assert_eq!(result.unsafe_state, Some(GitStatusUnsafeState::Rebase));
    }

    // -----------------------------------------------------------------------
    // 9. index.lock
    // -----------------------------------------------------------------------

    #[test]
    fn index_lock_unsafe_state() {
        let repo = Repo::new();
        repo.commit("f.txt", "a", "init");
        let git_dir = repo.path().join(".git");
        std::fs::write(git_dir.join("index.lock"), "").unwrap();

        let result = git_status(repo.path(), "main", "origin").unwrap();
        assert_eq!(result.unsafe_state, Some(GitStatusUnsafeState::IndexLock));
    }

    // -----------------------------------------------------------------------
    // 10. Ahead count
    // -----------------------------------------------------------------------

    #[test]
    fn ahead_count_local_commits_not_in_remote() {
        let repo = Repo::new();
        repo.commit("f.txt", "a", "init");
        let _remote = repo.add_remote_origin();

        // Two local commits after the clone point.
        repo.commit("f.txt", "b", "local 1");
        repo.commit("f.txt", "c", "local 2");

        let result = git_status(repo.path(), "main", "origin").unwrap();
        assert_eq!(result.ahead, 2);
        assert_eq!(result.behind, 0);
        assert!(result.remote_ref_available);
    }

    // -----------------------------------------------------------------------
    // 11. Behind count
    // -----------------------------------------------------------------------

    #[test]
    fn behind_count_remote_commits_not_local() {
        let repo = Repo::new();
        repo.commit("f.txt", "a", "init");
        let _remote = repo.add_remote_origin();

        // Simulate remote advancing: write directly to the remote bare repo,
        // then fetch into the local repo so origin/main moves forward without
        // changing local HEAD.
        let remote_path = _remote.path().to_path_buf();

        // Use a second clone to push new commits to the bare remote.
        let other = tempfile::tempdir().unwrap();
        git(
            &[
                "clone",
                remote_path.to_str().unwrap(),
                other.path().to_str().unwrap(),
            ],
            Path::new("/tmp"),
        );
        git(&["config", "user.email", "t@t.com"], other.path());
        git(&["config", "user.name", "T"], other.path());
        git(&["config", "commit.gpgsign", "false"], other.path());
        std::fs::write(other.path().join("f.txt"), "remote1").unwrap();
        git(&["add", "f.txt"], other.path());
        git(
            &["commit", "--no-gpg-sign", "-m", "remote commit 1"],
            other.path(),
        );
        std::fs::write(other.path().join("f.txt"), "remote2").unwrap();
        git(&["add", "f.txt"], other.path());
        git(
            &["commit", "--no-gpg-sign", "-m", "remote commit 2"],
            other.path(),
        );
        git(&["push", "origin", "main"], other.path());

        // Fetch in the original repo so origin/main reflects the new commits,
        // but do NOT merge — local HEAD stays behind.
        git(&["fetch", "origin"], repo.path());

        let result = git_status(repo.path(), "main", "origin").unwrap();
        assert_eq!(result.ahead, 0);
        assert_eq!(result.behind, 2);
        assert!(result.remote_ref_available);
    }

    // -----------------------------------------------------------------------
    // 12. Diverged (ahead and behind)
    // -----------------------------------------------------------------------

    #[test]
    fn diverged_counts_ahead_and_behind() {
        let repo = Repo::new();
        repo.commit("f.txt", "a", "init");
        let _remote = repo.add_remote_origin();

        // Advance remote via a second clone.
        let remote_path = _remote.path().to_path_buf();
        let other = tempfile::tempdir().unwrap();
        git(
            &[
                "clone",
                remote_path.to_str().unwrap(),
                other.path().to_str().unwrap(),
            ],
            Path::new("/tmp"),
        );
        git(&["config", "user.email", "t@t.com"], other.path());
        git(&["config", "user.name", "T"], other.path());
        git(&["config", "commit.gpgsign", "false"], other.path());
        std::fs::write(other.path().join("g.txt"), "remote1").unwrap();
        git(&["add", "g.txt"], other.path());
        git(
            &["commit", "--no-gpg-sign", "-m", "remote commit"],
            other.path(),
        );
        git(&["push", "origin", "main"], other.path());

        // Fetch so origin/main advances, then make a local-only commit.
        git(&["fetch", "origin"], repo.path());
        repo.commit("h.txt", "local", "local commit");

        let result = git_status(repo.path(), "main", "origin").unwrap();
        assert_eq!(result.ahead, 1);
        assert_eq!(result.behind, 1);
        assert!(result.remote_ref_available);
    }

    // -----------------------------------------------------------------------
    // 13. Missing local remote ref
    // -----------------------------------------------------------------------

    #[test]
    fn missing_remote_ref_no_fetch() {
        let repo = Repo::new();
        repo.commit("f.txt", "a", "init");
        // No remote configured at all — refs/remotes/origin/main does not exist.

        let result = git_status(repo.path(), "main", "origin").unwrap();
        assert!(!result.remote_ref_available);
        assert_eq!(result.ahead, 0);
        assert_eq!(result.behind, 0);
    }

    // -----------------------------------------------------------------------
    // 14. Mutation safety
    // -----------------------------------------------------------------------

    #[test]
    fn git_status_does_not_mutate_repo() {
        let repo = Repo::new();
        repo.commit("f.txt", "a", "init");
        std::fs::write(repo.path().join("f.txt"), "modified").unwrap();

        let head_before = git(&["rev-parse", "HEAD"], repo.path());
        let porcelain_before = git(&["status", "--porcelain"], repo.path());

        git_status(repo.path(), "main", "origin").unwrap();

        let head_after = git(&["rev-parse", "HEAD"], repo.path());
        let porcelain_after = git(&["status", "--porcelain"], repo.path());

        assert_eq!(head_before.stdout, head_after.stdout, "HEAD changed");
        assert_eq!(
            porcelain_before.stdout, porcelain_after.stdout,
            "working tree changed"
        );
    }

    // -----------------------------------------------------------------------
    // parse_rev_list_count unit tests
    // -----------------------------------------------------------------------

    #[test]
    fn parse_rev_list_count_zero_zero() {
        assert_eq!(parse_rev_list_count("0\t0").unwrap(), (0, 0));
    }

    #[test]
    fn parse_rev_list_count_ahead_behind() {
        assert_eq!(parse_rev_list_count("3\t7").unwrap(), (3, 7));
    }

    #[test]
    fn parse_rev_list_count_space_separated() {
        // git sometimes outputs space-separated on some platforms
        assert_eq!(parse_rev_list_count("2 5").unwrap(), (2, 5));
    }

    // -----------------------------------------------------------------------
    // GitStatusResult serialization — verifies camelCase field names
    // -----------------------------------------------------------------------

    // -----------------------------------------------------------------------
    // 15. remote_status fetches and detects behind
    // -----------------------------------------------------------------------

    #[test]
    fn remote_status_detects_behind_after_remote_advance() {
        let repo = Repo::new();
        repo.commit("f.txt", "a", "init");
        let _remote = repo.add_remote_origin();

        // Advance remote via a second clone — do NOT fetch locally beforehand.
        let remote_path = _remote.path().to_path_buf();
        let other = tempfile::tempdir().unwrap();
        git(
            &[
                "clone",
                remote_path.to_str().unwrap(),
                other.path().to_str().unwrap(),
            ],
            Path::new("/tmp"),
        );
        git(&["config", "user.email", "t@t.com"], other.path());
        git(&["config", "user.name", "T"], other.path());
        git(&["config", "commit.gpgsign", "false"], other.path());
        std::fs::write(other.path().join("f.txt"), "remote").unwrap();
        git(&["add", "f.txt"], other.path());
        git(
            &["commit", "--no-gpg-sign", "-m", "remote commit"],
            other.path(),
        );
        git(&["push", "origin", "main"], other.path());

        let head_before = git(&["rev-parse", "HEAD"], repo.path());
        let result = remote_status(repo.path(), "main", "origin", 30).unwrap();
        let head_after = git(&["rev-parse", "HEAD"], repo.path());

        assert_eq!(result.behind, 1);
        assert_eq!(result.ahead, 0);
        assert!(result.remote_ref_available);
        assert_eq!(
            head_before.stdout, head_after.stdout,
            "HEAD must not change"
        );
    }

    // -----------------------------------------------------------------------
    // 16. remote_status errors on missing remote branch
    // -----------------------------------------------------------------------

    #[test]
    fn remote_status_errors_on_missing_remote_branch() {
        let repo = Repo::new();
        repo.commit("f.txt", "a", "init");
        let _remote = repo.add_remote_origin();

        let result = remote_status(repo.path(), "nonexistent-branch", "origin", 30);
        assert!(matches!(result, Err(SyncError::FetchFailed { .. })));
    }

    // -----------------------------------------------------------------------
    // 17. remote_status does not return stale data when tracked branch deleted
    // -----------------------------------------------------------------------

    #[test]
    fn remote_status_fails_not_stale_after_tracked_branch_deleted() {
        // When the remote branch we track is deleted, fetch_remote runs
        // `git fetch --quiet --prune origin <branch>`.  The fetch itself
        // fails because the refspec can no longer be resolved; --prune
        // additionally removes refs/remotes/origin/<branch> if it lingers
        // after a successful fetch that no longer sees the branch.
        // Either way the function must return an error rather than reading
        // the stale local tracking ref and reporting "Synced".
        let repo = Repo::new();
        repo.commit("f.txt", "a", "init");
        let remote = repo.add_remote_origin();

        // First call: main exists on remote — succeeds and establishes the
        // remote-tracking ref.
        let first = remote_status(repo.path(), "main", "origin", 30).unwrap();
        assert!(first.remote_ref_available, "main remote ref must be available initially");

        // Push a second branch so we can change HEAD on the bare repo, which
        // is required before deleting its current HEAD branch (main).
        git(&["checkout", "-b", "other"], repo.path());
        repo.commit("g.txt", "b", "other commit");
        git(&["push", "origin", "other"], repo.path());
        git(&["symbolic-ref", "HEAD", "refs/heads/other"], remote.path());
        git(&["branch", "-D", "main"], remote.path());
        git(&["checkout", "main"], repo.path());

        // Second call: main is gone from remote. Must fail — not silently
        // read refs/remotes/origin/main and report ahead/behind as if up
        // to date.
        let second = remote_status(repo.path(), "main", "origin", 30);
        assert!(
            matches!(second, Err(SyncError::FetchFailed { .. })),
            "expected FetchFailed after upstream branch deletion, got: {second:?}"
        );
    }

    // -----------------------------------------------------------------------
    // GitStatusResult serialization — verifies camelCase field names
    // -----------------------------------------------------------------------

    #[test]
    fn git_status_result_serializes_camel_case_fields() {
        use serde_json::Value;

        let result = GitStatusResult {
            branch: Some("main".into()),
            expected_branch: "main".into(),
            has_uncommitted_changes: true,
            has_staged_changes: false,
            has_untracked_files: true,
            ahead: 2,
            behind: 1,
            remote_ref_available: true,
            unsafe_state: Some(GitStatusUnsafeState::IndexLock),
            is_wrong_branch: false,
        };
        let v: Value = serde_json::to_value(&result).unwrap();

        // Spot-check every multi-word snake_case field to confirm camelCase output.
        assert_eq!(v["expectedBranch"], "main");
        assert_eq!(v["hasUncommittedChanges"], true);
        assert_eq!(v["hasStagedChanges"], false);
        assert_eq!(v["hasUntrackedFiles"], true);
        assert_eq!(v["remoteRefAvailable"], true);
        assert_eq!(v["unsafeState"], "indexLock");
        assert_eq!(v["isWrongBranch"], false);
        assert_eq!(v["ahead"], 2);
        assert_eq!(v["behind"], 1);

        // Confirm no snake_case keys leak through.
        for key in &[
            "expected_branch",
            "has_uncommitted_changes",
            "has_staged_changes",
            "has_untracked_files",
            "remote_ref_available",
            "unsafe_state",
            "is_wrong_branch",
        ] {
            assert!(
                v.get(key).is_none(),
                "snake_case key {key:?} must not appear in serialized output"
            );
        }
    }
}

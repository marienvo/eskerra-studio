use std::path::{Path, PathBuf};

use crate::vault_git_sync::cli::GitCmd;
use crate::vault_git_sync::errors::{SyncError, UnsafeKind};

pub fn validate_vault_path(vault_path: &Path) -> Result<(), SyncError> {
    let canonical = vault_path
        .canonicalize()
        .map_err(|_| SyncError::NotGitRepository)?;
    if !canonical.is_dir() {
        return Err(SyncError::NotGitRepository);
    }
    Ok(())
}

pub fn validate_is_git_repo(vault_path: &Path) -> Result<(), SyncError> {
    let out = GitCmd::new(vault_path, &["rev-parse", "--is-inside-work-tree"]).run()?;
    if !out.success {
        return Err(SyncError::NotGitRepository);
    }
    // Refuse to operate on a subdirectory of a git repo — vault_path must be the toplevel.
    let canonical = vault_path
        .canonicalize()
        .map_err(|_| SyncError::NotGitRepository)?;
    let toplevel = git_toplevel(vault_path)?;
    if canonical != toplevel {
        return Err(SyncError::NotGitRepository);
    }
    Ok(())
}

pub fn validate_not_detached_head(vault_path: &Path) -> Result<(), SyncError> {
    let out = GitCmd::new(vault_path, &["symbolic-ref", "HEAD"]).run()?;
    if !out.success {
        return Err(SyncError::DetachedHead);
    }
    Ok(())
}

pub fn validate_no_unsafe_state(vault_path: &Path) -> Result<(), SyncError> {
    let gd = git_dir(vault_path)?;
    if gd.join("MERGE_HEAD").exists() {
        return Err(SyncError::UnsafeGitState {
            kind: UnsafeKind::Merge,
        });
    }
    if gd.join("rebase-merge").is_dir() || gd.join("rebase-apply").is_dir() {
        return Err(SyncError::UnsafeGitState {
            kind: UnsafeKind::Rebase,
        });
    }
    if gd.join("CHERRY_PICK_HEAD").exists() {
        return Err(SyncError::UnsafeGitState {
            kind: UnsafeKind::CherryPick,
        });
    }
    if gd.join("REVERT_HEAD").exists() {
        return Err(SyncError::UnsafeGitState {
            kind: UnsafeKind::Revert,
        });
    }
    if gd.join("BISECT_LOG").exists() {
        return Err(SyncError::UnsafeGitState {
            kind: UnsafeKind::Bisect,
        });
    }
    if gd.join("index.lock").exists() {
        return Err(SyncError::UnsafeGitState {
            kind: UnsafeKind::IndexLock,
        });
    }
    Ok(())
}

pub fn validate_index_clean(vault_path: &Path) -> Result<(), SyncError> {
    let out = GitCmd::new(vault_path, &["diff", "--cached", "--quiet"]).run()?;
    if !out.success {
        return Err(SyncError::UnsafeGitState {
            kind: UnsafeKind::IndexNotClean,
        });
    }
    Ok(())
}

pub fn validate_branch(vault_path: &Path, expected: &str) -> Result<(), SyncError> {
    let out = GitCmd::new(vault_path, &["symbolic-ref", "--short", "HEAD"]).run()?;
    if !out.success {
        return Err(SyncError::DetachedHead);
    }
    let actual = out.stdout.trim().to_string();
    if actual != expected {
        return Err(SyncError::WrongBranch {
            expected: expected.to_string(),
            actual,
        });
    }
    Ok(())
}

pub fn validate_remote_exists(vault_path: &Path, remote: &str) -> Result<(), SyncError> {
    let out = GitCmd::new(vault_path, &["remote", "get-url", remote]).run()?;
    if !out.success {
        return Err(SyncError::RemoteMissing {
            remote: remote.to_string(),
        });
    }
    Ok(())
}

/// Run all Phase-1 safety checks in documented order.
/// Caller is responsible for acquiring the vault lock before calling this.
pub fn validate_all(vault_path: &Path, branch: &str, remote: &str) -> Result<(), SyncError> {
    validate_vault_path(vault_path)?;
    validate_is_git_repo(vault_path)?;
    validate_not_detached_head(vault_path)?;
    validate_no_unsafe_state(vault_path)?;
    validate_index_clean(vault_path)?;
    validate_branch(vault_path, branch)?;
    validate_remote_exists(vault_path, remote)?;
    Ok(())
}

fn git_toplevel(vault_path: &Path) -> Result<PathBuf, SyncError> {
    let out = GitCmd::new(vault_path, &["rev-parse", "--show-toplevel"]).run()?;
    if !out.success {
        return Err(SyncError::NotGitRepository);
    }
    PathBuf::from(out.stdout.trim())
        .canonicalize()
        .map_err(|_| SyncError::NotGitRepository)
}

fn git_dir(vault_path: &Path) -> Result<PathBuf, SyncError> {
    let out = GitCmd::new(vault_path, &["rev-parse", "--absolute-git-dir"]).run()?;
    if !out.success {
        return Err(SyncError::NotGitRepository);
    }
    Ok(PathBuf::from(out.stdout.trim()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;
    use std::process::Command;
    use tempfile::TempDir;

    // ---------------------------------------------------------------------------
    // Test repo helper
    // ---------------------------------------------------------------------------

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

    // ---------------------------------------------------------------------------
    // validate_vault_path
    // ---------------------------------------------------------------------------

    #[test]
    fn nonexistent_path_returns_not_git_repo() {
        let result = validate_vault_path(Path::new("/nonexistent/path/that/cannot/exist"));
        assert!(matches!(result, Err(SyncError::NotGitRepository)));
    }

    // ---------------------------------------------------------------------------
    // validate_is_git_repo
    // ---------------------------------------------------------------------------

    #[test]
    fn valid_repo_root_passes() {
        let repo = Repo::new();
        repo.commit("f.txt", "a", "init");
        validate_is_git_repo(repo.path()).unwrap();
    }

    #[test]
    fn plain_directory_returns_not_git_repo() {
        let dir = tempfile::tempdir().unwrap();
        let result = validate_is_git_repo(dir.path());
        assert!(matches!(result, Err(SyncError::NotGitRepository)));
    }

    #[test]
    fn subdirectory_of_repo_returns_not_git_repo() {
        let repo = Repo::new();
        repo.commit("f.txt", "a", "init");
        let sub = repo.path().join("sub");
        std::fs::create_dir_all(&sub).unwrap();
        let result = validate_is_git_repo(&sub);
        assert!(
            matches!(result, Err(SyncError::NotGitRepository)),
            "expected NotGitRepository for subdirectory"
        );
    }

    // ---------------------------------------------------------------------------
    // validate_not_detached_head / validate_branch
    // ---------------------------------------------------------------------------

    #[test]
    fn detached_head_returns_error() {
        let repo = Repo::new();
        repo.commit("f.txt", "a", "init");
        git(&["checkout", "--detach"], repo.path());
        let result = validate_not_detached_head(repo.path());
        assert!(matches!(result, Err(SyncError::DetachedHead)));
    }

    #[test]
    fn detached_head_also_caught_by_validate_branch() {
        let repo = Repo::new();
        repo.commit("f.txt", "a", "init");
        git(&["checkout", "--detach"], repo.path());
        let result = validate_branch(repo.path(), "main");
        assert!(matches!(result, Err(SyncError::DetachedHead)));
    }

    #[test]
    fn wrong_branch_returns_error_with_names() {
        let repo = Repo::new();
        repo.commit("f.txt", "a", "init");
        let result = validate_branch(repo.path(), "master");
        assert!(
            matches!(
                result,
                Err(SyncError::WrongBranch { ref expected, ref actual })
                if expected == "master" && actual == "main"
            ),
            "got: {:?}",
            result
        );
    }

    #[test]
    fn correct_branch_passes() {
        let repo = Repo::new();
        repo.commit("f.txt", "a", "init");
        validate_branch(repo.path(), "main").unwrap();
    }

    // ---------------------------------------------------------------------------
    // validate_no_unsafe_state
    // ---------------------------------------------------------------------------

    #[test]
    fn merge_in_progress_returns_unsafe_state() {
        let repo = Repo::new();
        repo.commit("f.txt", "base", "init");
        git(&["checkout", "-b", "side"], repo.path());
        repo.commit("f.txt", "side", "side commit");
        git(&["checkout", "main"], repo.path());
        repo.commit("f.txt", "main", "main commit");
        // Merge will fail with conflict, leaving MERGE_HEAD.
        let _ = git(&["merge", "--no-edit", "side"], repo.path());
        let result = validate_no_unsafe_state(repo.path());
        assert!(
            matches!(
                result,
                Err(SyncError::UnsafeGitState {
                    kind: UnsafeKind::Merge
                })
            ),
            "got: {:?}",
            result
        );
    }

    #[test]
    fn rebase_in_progress_returns_unsafe_state() {
        let repo = Repo::new();
        repo.commit("f.txt", "base", "init");
        git(&["checkout", "-b", "side"], repo.path());
        repo.commit("f.txt", "side", "side commit");
        git(&["checkout", "main"], repo.path());
        repo.commit("f.txt", "main", "main commit");
        git(&["checkout", "side"], repo.path());
        // Rebase will stop on conflict, creating rebase-merge/.
        let _ = git(&["rebase", "main"], repo.path());
        let result = validate_no_unsafe_state(repo.path());
        assert!(
            matches!(
                result,
                Err(SyncError::UnsafeGitState {
                    kind: UnsafeKind::Rebase
                })
            ),
            "got: {:?}",
            result
        );
    }

    #[test]
    fn stale_rebase_head_without_rebase_dirs_is_allowed() {
        let repo = Repo::new();
        repo.commit("f.txt", "a", "init");
        let git_dir = repo.path().join(".git");
        std::fs::write(git_dir.join("REBASE_HEAD"), "deadbeef\n").unwrap();

        assert!(validate_no_unsafe_state(repo.path()).is_ok());
    }

    #[test]
    fn cherry_pick_in_progress_returns_unsafe_state() {
        let repo = Repo::new();
        repo.commit("f.txt", "base", "init");
        git(&["checkout", "-b", "side"], repo.path());
        repo.commit("f.txt", "side", "side commit");
        git(&["checkout", "main"], repo.path());
        repo.commit("f.txt", "main", "main commit");
        let sha_out = git(&["rev-parse", "side"], repo.path());
        let sha = String::from_utf8_lossy(&sha_out.stdout).trim().to_string();
        // Cherry-pick will conflict (both modified f.txt from the same base).
        let _ = git(&["cherry-pick", &sha], repo.path());
        let result = validate_no_unsafe_state(repo.path());
        assert!(
            matches!(
                result,
                Err(SyncError::UnsafeGitState {
                    kind: UnsafeKind::CherryPick
                })
            ),
            "got: {:?}",
            result
        );
    }

    #[test]
    fn index_lock_returns_unsafe_state() {
        let repo = Repo::new();
        repo.commit("f.txt", "a", "init");
        let git_dir = repo.path().join(".git");
        std::fs::write(git_dir.join("index.lock"), "").unwrap();
        let result = validate_no_unsafe_state(repo.path());
        assert!(
            matches!(
                result,
                Err(SyncError::UnsafeGitState {
                    kind: UnsafeKind::IndexLock
                })
            ),
            "got: {:?}",
            result
        );
    }

    // ---------------------------------------------------------------------------
    // validate_index_clean
    // ---------------------------------------------------------------------------

    #[test]
    fn staged_changes_return_index_not_clean() {
        let repo = Repo::new();
        repo.commit("f.txt", "a", "init");
        std::fs::write(repo.path().join("new.txt"), "new").unwrap();
        git(&["add", "new.txt"], repo.path());
        let result = validate_index_clean(repo.path());
        assert!(
            matches!(
                result,
                Err(SyncError::UnsafeGitState {
                    kind: UnsafeKind::IndexNotClean
                })
            ),
            "got: {:?}",
            result
        );
    }

    #[test]
    fn unstaged_changes_pass_index_clean() {
        let repo = Repo::new();
        repo.commit("f.txt", "a", "init");
        // Modify but do not stage.
        std::fs::write(repo.path().join("f.txt"), "modified").unwrap();
        validate_index_clean(repo.path()).unwrap();
    }

    // ---------------------------------------------------------------------------
    // validate_remote_exists
    // ---------------------------------------------------------------------------

    #[test]
    fn missing_remote_returns_error() {
        let repo = Repo::new();
        repo.commit("f.txt", "a", "init");
        let result = validate_remote_exists(repo.path(), "origin");
        assert!(
            matches!(result, Err(SyncError::RemoteMissing { ref remote }) if remote == "origin"),
            "got: {:?}",
            result
        );
    }

    #[test]
    fn configured_remote_passes() {
        let repo = Repo::new();
        repo.commit("f.txt", "a", "init");
        git(
            &["remote", "add", "origin", "https://example.com/fake.git"],
            repo.path(),
        );
        validate_remote_exists(repo.path(), "origin").unwrap();
    }

    // ---------------------------------------------------------------------------
    // validate_all
    // ---------------------------------------------------------------------------

    #[test]
    fn validate_all_passes_on_clean_repo() {
        let repo = Repo::new();
        repo.commit("f.txt", "a", "init");
        git(
            &["remote", "add", "origin", "https://example.com/fake.git"],
            repo.path(),
        );
        validate_all(repo.path(), "main", "origin").unwrap();
    }

    #[test]
    fn validate_all_fails_fast_on_detached_head() {
        let repo = Repo::new();
        repo.commit("f.txt", "a", "init");
        git(
            &["remote", "add", "origin", "https://example.com/fake.git"],
            repo.path(),
        );
        git(&["checkout", "--detach"], repo.path());
        let result = validate_all(repo.path(), "main", "origin");
        assert!(matches!(result, Err(SyncError::DetachedHead)));
    }
}

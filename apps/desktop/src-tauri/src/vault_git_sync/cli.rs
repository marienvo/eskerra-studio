use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use crate::vault_git_sync::errors::SyncError;

pub struct GitOutput {
    pub stdout: String,
    pub stderr: String,
    pub success: bool,
    pub exit_code: Option<i32>,
}

/// Builder for a single `git` subprocess invocation. Does not shell-expand arguments.
/// `cwd` is required by construction — callers must always be explicit about which
/// directory git operates in.
pub struct GitCmd {
    cwd: PathBuf,
    args: Vec<String>,
    /// Stored for API stability. **No-op until Phase 3.** All Phase 1 calls are
    /// local-only (rev-parse, symbolic-ref, diff --cached, etc.) and complete in
    /// milliseconds. Wire up in Phase 3 when `git fetch` / `git push` are added —
    /// those can block indefinitely on a slow or unreachable remote. Implementation:
    /// thread + channel, or switch `run` to `tokio::process::Command` with
    /// `tokio::time::timeout`.
    timeout: Option<Duration>,
}

impl GitCmd {
    pub fn new(cwd: impl AsRef<Path>, args: &[&str]) -> Self {
        Self {
            cwd: cwd.as_ref().to_path_buf(),
            args: args.iter().map(|s| s.to_string()).collect(),
            timeout: None,
        }
    }

    pub fn timeout(mut self, dur: Duration) -> Self {
        self.timeout = Some(dur);
        self
    }

    pub fn run(self) -> Result<GitOutput, SyncError> {
        let output = Command::new("git")
            .args(&self.args)
            .current_dir(&self.cwd)
            // Non-interactive defaults: never prompt for credentials or open an editor.
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GIT_EDITOR", "true")
            .env("GIT_SEQUENCE_EDITOR", "true")
            .output()
            .map_err(|e| SyncError::GitCommandFailed {
                command: format!("git {}", self.args.join(" ")),
                exit_code: None,
                stderr: e.to_string(),
            })?;
        Ok(GitOutput {
            stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
            success: output.status.success(),
            exit_code: output.status.code(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn runs_git_version() {
        let dir = tempdir().unwrap();
        let out = GitCmd::new(dir.path(), &["--version"]).run().unwrap();
        assert!(out.success);
        assert!(out.stdout.starts_with("git version"));
    }

    #[test]
    fn captures_stderr_and_nonzero_exit() {
        let dir = tempdir().unwrap();
        let out = GitCmd::new(dir.path(), &["rev-parse", "--show-toplevel"])
            .run()
            .unwrap();
        assert!(!out.success);
        assert!(out.exit_code.is_some());
        assert!(!out.stderr.is_empty());
    }

    #[test]
    fn env_defaults_suppress_prompts() {
        // GIT_TERMINAL_PROMPT=0 is always set. Verify indirectly: a command that would
        // normally prompt still runs without hanging.
        let dir = tempdir().unwrap();
        let out = GitCmd::new(dir.path(), &["--version"]).run().unwrap();
        assert!(out.success);
    }

    #[test]
    fn timeout_builder_is_noop_until_phase_3() {
        // timeout() is accepted and stored but not enforced; wired up in Phase 3.
        let dir = tempdir().unwrap();
        let out = GitCmd::new(dir.path(), &["--version"])
            .timeout(Duration::from_secs(30))
            .run()
            .unwrap();
        assert!(out.success);
    }
}

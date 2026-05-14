use std::path::PathBuf;

use crate::vault_git_sync::config::SyncConfig;
use crate::vault_git_sync::errors::SyncError;
use crate::vault_git_sync::stage_plan::{build_stage_plan, StagePlan};
use crate::vault_git_sync::status::{
    current_branch, git_status, remote_status, CurrentBranchResult, GitStatusResult,
};
use crate::vault_git_sync::sync_run::{sync_fetch_merge_push, SyncRunResult};

async fn run_blocking_git_command<T, F>(command: &'static str, task: F) -> Result<T, SyncError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, SyncError> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|e| SyncError::GitCommandFailed {
            command: command.into(),
            exit_code: None,
            stderr: format!("join error: {e}"),
        })?
}

#[tauri::command]
pub async fn vault_git_status(
    vault_path: String,
    remote: String,
    branch: String,
) -> Result<GitStatusResult, SyncError> {
    run_blocking_git_command("vault_git_status", move || {
        git_status(&PathBuf::from(vault_path), &branch, &remote)
    })
    .await
}

#[tauri::command]
pub async fn vault_git_current_branch(
    vault_path: String,
) -> Result<CurrentBranchResult, SyncError> {
    run_blocking_git_command("vault_git_current_branch", move || {
        current_branch(&PathBuf::from(vault_path))
    })
    .await
}

#[tauri::command]
pub async fn vault_git_stage_plan(
    vault_path: String,
    config: SyncConfig,
) -> Result<StagePlan, SyncError> {
    run_blocking_git_command("vault_git_stage_plan", move || {
        build_stage_plan(&PathBuf::from(vault_path), &config)
    })
    .await
}

#[tauri::command]
pub async fn vault_git_remote_status(
    vault_path: String,
    remote: String,
    branch: String,
    fetch_timeout_secs: u32,
) -> Result<GitStatusResult, SyncError> {
    run_blocking_git_command("vault_git_remote_status", move || {
        remote_status(
            &PathBuf::from(vault_path),
            &branch,
            &remote,
            fetch_timeout_secs,
        )
    })
    .await
}

#[tauri::command]
pub async fn vault_git_sync_run(
    vault_path: String,
    locks_dir: String,
    config: SyncConfig,
) -> Result<SyncRunResult, SyncError> {
    run_blocking_git_command("vault_git_sync_run", move || {
        sync_fetch_merge_push(
            &PathBuf::from(vault_path),
            &PathBuf::from(locks_dir),
            &config,
        )
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocking_command_panic_maps_to_json_shaped_git_error() {
        let result = tauri::async_runtime::block_on(run_blocking_git_command(
            "test_command",
            || -> Result<(), SyncError> { panic!("boom") },
        ));

        let err = result.expect_err("panic should be mapped to a SyncError");
        assert!(matches!(
            err,
            SyncError::GitCommandFailed {
                ref command,
                exit_code: None,
                ..
            } if command == "test_command"
        ));

        let json = serde_json::to_value(err).unwrap();
        assert_eq!(json["type"], "gitCommandFailed");
        assert_eq!(json["command"], "test_command");
        assert_eq!(json["exitCode"], serde_json::Value::Null);
        assert!(
            json["stderr"]
                .as_str()
                .is_some_and(|stderr| stderr.contains("join error")),
            "stderr should expose the join error"
        );
    }
}

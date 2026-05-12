use std::path::PathBuf;

use crate::vault_git_sync::config::SyncConfig;
use crate::vault_git_sync::errors::SyncError;
use crate::vault_git_sync::stage_plan::{build_stage_plan, StagePlan};
use crate::vault_git_sync::status::{current_branch, git_status, GitStatusResult};
use crate::vault_git_sync::sync_run::{sync_fetch_merge_push, SyncRunResult};

#[tauri::command]
pub fn vault_git_status(
    vault_path: String,
    remote: String,
    branch: String,
) -> Result<GitStatusResult, SyncError> {
    git_status(&PathBuf::from(vault_path), &branch, &remote)
}

#[tauri::command]
pub fn vault_git_current_branch(vault_path: String) -> Result<Option<String>, SyncError> {
    current_branch(&PathBuf::from(vault_path))
}

#[tauri::command]
pub fn vault_git_stage_plan(
    vault_path: String,
    config: SyncConfig,
) -> Result<StagePlan, SyncError> {
    build_stage_plan(&PathBuf::from(vault_path), &config)
}

#[tauri::command]
pub fn vault_git_sync_run(
    vault_path: String,
    locks_dir: String,
    config: SyncConfig,
) -> Result<SyncRunResult, SyncError> {
    sync_fetch_merge_push(
        &PathBuf::from(vault_path),
        &PathBuf::from(locks_dir),
        &config,
    )
}

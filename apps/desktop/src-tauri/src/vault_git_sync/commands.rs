use std::path::PathBuf;

use crate::vault_git_sync::config::SyncConfig;
use crate::vault_git_sync::errors::SyncError;
use crate::vault_git_sync::stage_plan::{build_stage_plan, StagePlan};
use crate::vault_git_sync::status::{git_status, GitStatusResult};

#[tauri::command]
pub fn vault_git_status(
    vault_path: String,
    remote: String,
    branch: String,
) -> Result<GitStatusResult, SyncError> {
    git_status(&PathBuf::from(vault_path), &branch, &remote)
}

#[tauri::command]
pub fn vault_git_stage_plan(
    vault_path: String,
    config: SyncConfig,
) -> Result<StagePlan, SyncError> {
    build_stage_plan(&PathBuf::from(vault_path), &config)
}

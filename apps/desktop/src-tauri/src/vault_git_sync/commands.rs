use std::path::PathBuf;

use crate::vault_git_sync::errors::SyncError;
use crate::vault_git_sync::status::{git_status, GitStatusResult};

#[tauri::command]
pub fn vault_git_status(
    vault_path: String,
    remote: String,
    branch: String,
) -> Result<GitStatusResult, SyncError> {
    git_status(&PathBuf::from(vault_path), &branch, &remote)
}

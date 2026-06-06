//! Tauri adapter over the shared `eskerra-vault-watch` engine.
//!
//! The dual-backend watcher, debounce, cross-backend dedup, coarse fallback,
//! and ignored-dir filtering all live in the `eskerra-vault-watch` crate now
//! (extracted in Phase 2 of `specs/plans/desktop-reminders-daemon-phased.md` so
//! the app and the `eskerra-reminderd` daemon share one implementation). This
//! module only wires that engine into Tauri: it maps each [`WatchBatch`] to the
//! `vault-files-changed` event the frontend already consumes, and exposes the
//! `vault_start_watch` command. All watcher behavior and its unit tests now live
//! in the shared crate.

use std::sync::Arc;

use eskerra_vault_watch::{VaultWatchEngine, WatchBatch};
use serde::Serialize;
use tauri::{App, Emitter, Manager, State};

use crate::vault::VaultRootState;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultFilesChangedPayload {
    /// Absolute filesystem paths touched in this debounced batch (files and directories).
    pub paths: Vec<String>,
    /// When true, the frontend must treat this as full-vault invalidation (ignore `paths` precision).
    pub coarse: bool,
    /// Best-effort coarse invalidation reason for diagnostics.
    pub coarse_reason: Option<String>,
}

impl From<WatchBatch> for VaultFilesChangedPayload {
    fn from(batch: WatchBatch) -> Self {
        Self {
            paths: batch.paths,
            coarse: batch.coarse,
            coarse_reason: batch.coarse_reason,
        }
    }
}

pub struct VaultWatchState {
    engine: VaultWatchEngine,
}

pub fn setup_vault_watch(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    let app_handle = app.handle().clone();
    let engine = VaultWatchEngine::new(Arc::new(move |batch: WatchBatch| {
        let _ = app_handle.emit("vault-files-changed", VaultFilesChangedPayload::from(batch));
    }));
    app.manage(VaultWatchState { engine });
    Ok(())
}

#[tauri::command]
pub fn vault_start_watch(
    vault_state: State<'_, VaultRootState>,
    watch_state: State<'_, VaultWatchState>,
) -> Result<(), String> {
    let vault = vault_state.0.lock().map_err(|e| e.to_string())?;
    let root = vault
        .as_ref()
        .ok_or_else(|| "no vault session; pick a folder first".to_string())?
        .clone();
    drop(vault);

    watch_state.engine.start_watching(&root)
}

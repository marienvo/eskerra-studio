mod crash_log;
mod link_rich_metadata;
mod media;
mod r2_http;
mod tiling;
#[cfg(target_os = "linux")]
mod linux_app_identity;
#[cfg(target_os = "linux")]
mod tiling_gdk;
mod tiling_score;
mod vault;
mod vault_frontmatter_index;
mod vault_search;
mod vault_search_index;
mod vault_watch;
mod window_state_disk;

use vault::VaultRootState;
use vault_frontmatter_index::VaultFrontmatterIndexState;
use vault_search::VaultSearchSessionState;
use vault_search_index::VaultSearchIndexState;

#[cfg(all(not(mobile), debug_assertions))]
fn prevent_default_plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    use tauri_plugin_prevent_default::Flags;

    tauri_plugin_prevent_default::Builder::new()
        .with_flags(Flags::all().difference(Flags::DEV_TOOLS | Flags::RELOAD))
        .build()
}

/// Release builds only block the context menu here. Editor shortcuts (e.g. Cmd+W smart shrink/expand
/// in the vault CodeMirror surface) rely on JS `preventDefault` instead—**macOS:** manually verify
/// Cmd+W does not close the window while the note editor is focused.
#[cfg(all(not(mobile), not(debug_assertions)))]
fn prevent_default_plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    use tauri_plugin_prevent_default::Flags;

    tauri_plugin_prevent_default::Builder::new()
        .with_flags(Flags::CONTEXT_MENU)
        .build()
}

/// Must run from `main()` before `tauri::Builder::run()` so WebKit sees a default
/// [`GApplication`](https://docs.gtk.org/gio/class.Application.html) id and `g_get_application_name()`.
#[cfg(target_os = "linux")]
pub fn early_linux_webkit_prerun() {
    linux_app_identity::early_linux_webkit_prerun();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .manage(VaultRootState::default())
        .manage(VaultSearchSessionState::default())
        .manage(VaultSearchIndexState::default())
        .manage(VaultFrontmatterIndexState::default());

    #[cfg(not(mobile))]
    {
        builder = builder.plugin(prevent_default_plugin());
    }

    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .skip_initial_state("main")
                .build(),
        )
        .setup(|app| {
            #[cfg(target_os = "linux")]
            linux_app_identity::apply_linux_app_identity_branding();
            vault_watch::setup_vault_watch(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            tiling::get_window_tiling_detection,
            r2_http::r2_signed_fetch,
            link_rich_metadata::fetch_link_rich_metadata,
            vault::vault_set_session,
            vault::vault_get_session,
            vault::vault_exists,
            vault::vault_mkdir,
            vault::vault_read_file,
            vault::vault_write_file,
            vault::vault_write_file_bytes,
            vault::vault_import_files_into_attachments,
            vault::vault_remove_file,
            vault::vault_remove_tree,
            vault::vault_rename_file,
            vault::vault_list_dir,
            vault_search::vault_search_start,
            vault_search::vault_search_cancel,
            vault_search_index::vault_search_index_schedule,
            vault_search_index::vault_search_index_touch_paths,
            vault_frontmatter_index::vault_frontmatter_index_schedule,
            vault_frontmatter_index::vault_frontmatter_index_snapshot,
            vault_frontmatter_index::vault_frontmatter_index_values_for_key,
            vault_frontmatter_index::vault_frontmatter_index_touch_paths,
            vault_watch::vault_start_watch,
            window_state_disk::eskerra_peek_window_state_file,
            crash_log::eskerra_append_crash_log,
            media::media_cache_artwork,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

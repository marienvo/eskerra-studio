mod crash_log;
mod fetch_ics;
mod link_rich_metadata;
#[cfg(target_os = "linux")]
mod linux_app_identity;
mod open_reminder;
mod r2_http;
mod reminders;
mod startup_theme;
mod tiling;
#[cfg(target_os = "linux")]
mod tiling_gdk;
mod tiling_score;
mod vault;
mod vault_frontmatter_index;
mod vault_git_sync;
mod vault_search;
mod vault_search_index;
mod vault_watch;

use open_reminder::PendingOpenReminder;
use vault::VaultRootState;
use vault_frontmatter_index::VaultFrontmatterIndexState;
use vault_search::VaultSearchSessionState;
use vault_search_index::VaultSearchIndexState;

fn main_window_restore_flags() -> tauri_plugin_window_state::StateFlags {
    tauri_plugin_window_state::StateFlags::all()
        .difference(tauri_plugin_window_state::StateFlags::POSITION)
        .difference(tauri_plugin_window_state::StateFlags::DECORATIONS)
        .difference(tauri_plugin_window_state::StateFlags::VISIBLE)
}

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
    // Parse startup args before Tauri builder takes over argv.
    let startup_args: Vec<String> = std::env::args().collect();
    let startup_pending = open_reminder::parse_open_reminder_args(&startup_args);

    let mut builder = tauri::Builder::default()
        .manage(VaultRootState::default())
        .manage(VaultSearchSessionState::default())
        .manage(VaultSearchIndexState::default())
        .manage(VaultFrontmatterIndexState::default())
        .manage(open_reminder::pending_open_reminder_from_startup(
            startup_pending,
        ));

    #[cfg(not(mobile))]
    {
        builder = builder.plugin(prevent_default_plugin());
    }

    builder
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            use tauri::{Emitter, Manager};
            if let Some(req) = open_reminder::parse_open_reminder_args(&argv) {
                let pending = app.state::<PendingOpenReminder>();
                open_reminder::store_pending_open_reminder(&pending, req.clone());
                let _ = app.emit("open-reminder", &req);
            }
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(main_window_restore_flags())
                .build(),
        )
        .setup(|app| {
            #[cfg(target_os = "linux")]
            linux_app_identity::apply_linux_app_identity_branding();
            vault_watch::setup_vault_watch(app)?;
            let startup_theme = startup_theme::load_startup_theme(app);
            let init_script = startup_theme::initialization_script(&startup_theme);
            let window_config = app
                .config()
                .app
                .windows
                .iter()
                .find(|window| window.label == "main")
                .or_else(|| app.config().app.windows.first())
                .expect("main window config exists");
            tauri::WebviewWindowBuilder::from_config(app, window_config)?
                .initialization_script(init_script)
                .build()?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            tiling::get_window_tiling_detection,
            r2_http::r2_signed_fetch,
            fetch_ics::fetch_ics,
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
            vault_git_sync::commands::vault_git_current_branch,
            vault_git_sync::commands::vault_git_status,
            vault_git_sync::commands::vault_git_remote_status,
            vault_git_sync::commands::vault_git_stage_plan,
            vault_git_sync::commands::vault_git_sync_run,
            crash_log::eskerra_append_crash_log,
            open_reminder::reminders_take_pending_open,
            open_reminder::reminders_resolve_position_in_markdown,
            open_reminder::reminders_resolve_position,
            reminders::reminders_vault_hash,
            reminders::reminders_read_index,
            reminders::reminders_write_config,
            reminders::reminders_remove,
            reminders::reminders_snooze,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

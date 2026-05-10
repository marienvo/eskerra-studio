// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // WebKit / JavaScriptCore read `g_application_get_default()` and `g_get_application_name()`
    // when building web-process parameters; run before `tauri::Builder::run()`. See
    // `linux_app_identity.rs`.
    #[cfg(target_os = "linux")]
    app_lib::early_linux_webkit_prerun();
    app_lib::run();
}

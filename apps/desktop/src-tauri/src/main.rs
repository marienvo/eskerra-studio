// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // WebKit passes `g_get_application_name()` into the web process for MPRIS `Identity` at
    // process spawn; `.setup()` is too late. See `linux_app_identity.rs`.
    #[cfg(target_os = "linux")]
    app_lib::early_linux_glib_application_name_for_webkit();
    app_lib::run();
}

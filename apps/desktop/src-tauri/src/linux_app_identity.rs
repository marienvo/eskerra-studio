//! Linux GLib/GTK branding for GNOME and WebKitGTK.
//!
//! **`Identity` (MPRIS):** WebKit’s UI process passes **`g_get_application_name()`** into
//! [`WebProcessPool::platformInitializeWebProcess`](https://github.com/WebKit/WebKit/blob/main/Source/WebKit/UIProcess/glib/WebProcessPoolGLib.cpp)
//! when spawning the web process. Set the name from `main()` before `tauri::Builder::run()`, not
//! only from Tauri `.setup()`, so the first web process does not fall back to the binary name.
//!
//! **`DesktopEntry` / app id:** JavaScriptCore’s **`WTF::applicationID()`** (used when WebKit
//! propagates ids to the renderer) prefers **`g_application_get_default()`’s application id**,
//! then a valid reverse-DNS **`g_get_prgname()`**, else a hash of `/proc/self/exe`. The renderer
//! has no `GApplication`, so it relies on **`WebProcessCreationParameters`** from the UI
//! process—where WebKit reads **`g_application_get_default()->application_id`**. Tao registers a
//! [`gtk::Application`](https://docs.rs/gtk/0.18.2/gtk/struct.Application.html) but does **not**
//! call **`g_application_set_default()`**, so the default stays **`NULL`** until we install one.
//!
//! **`MediaSessionGLib`** still returns an empty **`DesktopEntry`** string; GNOME then resolves
//! the player using the propagated id and installed `.desktop` / icon theme data.

use std::sync::Once;

/// Must match `identifier` in `tauri.conf.json` (`enableGTKAppId`).
const LINUX_APPLICATION_ID: &str = "com.eskerra.desktop";

static DEFAULT_APPLICATION_INIT: Once = Once::new();

#[cfg(target_os = "linux")]
pub fn early_linux_webkit_prerun() {
    early_linux_default_gapplication_for_webkit();
    early_glib_application_name_for_webkit();
}

#[cfg(target_os = "linux")]
fn early_linux_default_gapplication_for_webkit() {
    use gtk::gio::prelude::ApplicationExt;

    DEFAULT_APPLICATION_INIT.call_once(|| {
        let app = gtk::gio::Application::new(
            Some(LINUX_APPLICATION_ID),
            gtk::gio::ApplicationFlags::NON_UNIQUE,
        );
        app.set_default();
        // Keep the default `GApplication` alive for the process lifetime (`Application` is not
        // `Sync`, so it cannot live in a `static OnceLock`).
        std::mem::forget(app);
    });
}

#[cfg(target_os = "linux")]
fn early_glib_application_name_for_webkit() {
    gtk::glib::set_application_name("Eskerra");
}

#[cfg(target_os = "linux")]
pub fn apply_linux_app_identity_branding() {
    gtk::glib::set_application_name("Eskerra");
    // Match `Icon=` in `.desktop` files and GNOME’s icon lookup for the reverse-DNS desktop id.
    gtk::Window::set_default_icon_name("com.eskerra.desktop");
}

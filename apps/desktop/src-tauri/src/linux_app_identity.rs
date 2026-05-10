//! Linux GLib/GTK branding for GNOME and WebKitGTK.
//!
//! WebKit’s GLib MPRIS adapter exposes **`Identity`** from the web process using the
//! **`applicationName`** parameter captured when the web process starts; that value comes from
//! **`g_get_application_name()`** in the UI process ([`WebProcessPool::platformInitializeWebProcess`](https://github.com/WebKit/WebKit/blob/main/Source/WebKit/UIProcess/glib/WebProcessPoolGLib.cpp)).
//! Calling `g_set_application_name` only from Tauri `.setup()` is **too late** if the web process
//! already launched—MPRIS then falls back to the lowercase binary name (`eskerra`).
//!
//! **`DesktopEntry`** is currently hard-coded to an empty string in WebKit’s
//! [`MediaSessionGLib`](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/audio/glib/MediaSessionGLib.cpp),
//! so GNOME cannot resolve the app icon from MPRIS alone. It typically groups the player with the
//! app window using **`StartupWMClass`** ↔ **`WM_CLASS`**, which matches the GTK application id
//! when `enableGTKAppId` is enabled (`com.eskerra.desktop`).

#[cfg(target_os = "linux")]
pub fn early_glib_application_name_for_webkit() {
    gtk::glib::set_application_name("Eskerra");
}

#[cfg(target_os = "linux")]
pub fn apply_linux_app_identity_branding() {
    gtk::glib::set_application_name("Eskerra");
    gtk::Window::set_default_icon_name("eskerra");
}

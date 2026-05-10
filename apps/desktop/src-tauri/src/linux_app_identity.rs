//! Linux GLib/GTK branding so the shell can show a friendly name and themed icon (for example
//! GNOME MPRIS) alongside the reverse-DNS GTK application ID from Tauri (`enableGTKAppId`).

#[cfg(target_os = "linux")]
pub fn apply_linux_app_identity_branding() {
    gtk::glib::set_application_name("Eskerra");
    gtk::Window::set_default_icon_name("eskerra");
}

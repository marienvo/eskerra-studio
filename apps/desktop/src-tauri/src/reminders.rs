//! Phase 6 Tauri commands for the reminder feature:
//!   - `reminders_vault_hash`   — deterministic vault identifier (SHA-256 of root path)
//!   - `reminders_read_index`   — read the daemon-written index JSON for a vault
//!   - `reminders_write_config` — write `reminderd.json` so the daemon knows the active vault
//!   - `reminders_remove`       — call `dev.eskerra.Reminders1.RemoveReminder` via D-Bus
//!
//! Only `reminders_remove` and `reminders_write_config` have Linux-specific paths;
//! on other targets both return graceful fallbacks so the TS side always has a
//! consistent result type.

use sha2::{Digest, Sha256};
use std::path::PathBuf;

use eskerra_reminder_core::write_atomic;

// ── XDG path helpers ──────────────────────────────────────────────────────────

fn xdg_dir(env_var: &str, home_relative: &str) -> Option<PathBuf> {
    if let Some(dir) = std::env::var_os(env_var)
        .map(PathBuf::from)
        .filter(|p| !p.as_os_str().is_empty())
    {
        return Some(dir);
    }
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .filter(|p| !p.as_os_str().is_empty())
        .map(|home| home.join(home_relative))
}

fn reminders_data_dir() -> Option<PathBuf> {
    xdg_dir("XDG_DATA_HOME", ".local/share").map(|d| d.join("eskerra").join("reminders"))
}

fn reminderd_config_path() -> Option<PathBuf> {
    xdg_dir("XDG_CONFIG_HOME", ".config").map(|d| d.join("eskerra").join("reminderd.json"))
}

// ── Tauri commands ────────────────────────────────────────────────────────────

/// Returns a deterministic vault identifier: SHA-256 hex of the vault root
/// path bytes. Stable across daemon restarts and app upgrades; the same vault
/// root always produces the same hash so the daemon and app agree on the index
/// filename without coordination.
#[tauri::command]
pub fn reminders_vault_hash(vault_root: String) -> String {
    let mut hasher = Sha256::new();
    hasher.update(vault_root.as_bytes());
    hasher
        .finalize()
        .iter()
        .fold(String::with_capacity(64), |mut s, b| {
            s.push_str(&format!("{b:02x}"));
            s
        })
}

/// Reads the reminder index JSON written by the daemon for the given vault
/// hash. Returns `null` (JS `None`) when the file is absent or unreadable —
/// the caller treats that as "no reminders yet".
#[tauri::command]
pub fn reminders_read_index(vault_hash: String) -> Option<String> {
    let path = reminders_data_dir()?.join(format!("{vault_hash}.json"));
    std::fs::read_to_string(&path).ok()
}

/// Writes `~/.config/eskerra/reminderd.json` atomically so the daemon learns
/// which vault to watch and what settings to use. The app calls this once on
/// vault open and again whenever settings change. Uses the locked schema
/// version 1 (ADR §5); settings default to 09:00 / 5 min lead until a
/// settings surface is added.
#[tauri::command]
pub fn reminders_write_config(vault_root: String, vault_hash: String) -> bool {
    let Some(config_path) = reminderd_config_path() else {
        return false;
    };
    if let Some(parent) = config_path.parent() {
        if std::fs::create_dir_all(parent).is_err() {
            return false;
        }
    }
    let json = format!(
        "{{\n  \"schemaVersion\": 1,\n  \"vaultRoot\": {root_json},\n  \"vaultHash\": {hash_json},\n  \"dateOnlyDefaultTime\": \"09:00\",\n  \"leadMinutes\": 5\n}}\n",
        root_json = serde_json::to_string(&vault_root).unwrap_or_default(),
        hash_json = serde_json::to_string(&vault_hash).unwrap_or_default(),
    );
    let written = write_atomic(&config_path, json.as_bytes()).is_ok();
    if written {
        ensure_daemon_running();
    }
    written
}

/// Best-effort recovery for the "installed but not running in this session"
/// case: the RPM enables the user unit so it autostarts at every login (see
/// linux/rpm-postinstall.sh), but root can't start it inside an already-running
/// session, and AppImage/.deb ship no scriptlet at all. So whenever the app
/// touches the vault we nudge the daemon up via `systemctl --user start`.
/// Idempotent (starting a running unit is a no-op) and fire-and-forget on a
/// detached thread — never blocks the command or surfaces an error: a missing
/// systemctl or absent unit just leaves the reminder pane in its existing
/// daemon-unavailable degradation.
#[cfg(target_os = "linux")]
fn ensure_daemon_running() {
    std::thread::spawn(|| {
        let _ = std::process::Command::new("systemctl")
            .args(["--user", "start", "eskerra-reminderd.service"])
            .output();
    });
}

#[cfg(not(target_os = "linux"))]
fn ensure_daemon_running() {}

/// Calls `dev.eskerra.Reminders1.RemoveReminder(noteUri, id)` on the session
/// D-Bus. Returns the daemon's result string (`"removed"` or `"stale"`) on
/// success, or `"remove-unavailable"` on any transport/registry error (daemon
/// not running, call timed out, etc.). Never writes to disk itself — the
/// single-writer invariant is preserved.
///
/// Linux only. On other targets always returns `"remove-unavailable"` so the
/// TS side degrades gracefully without conditional imports.
#[cfg(target_os = "linux")]
#[tauri::command]
pub async fn reminders_remove(note_uri: String, reminder_id: String) -> String {
    match dbus_remove_reminder(&note_uri, &reminder_id).await {
        Ok(result) => result,
        Err(_) => "remove-unavailable".to_string(),
    }
}

#[cfg(not(target_os = "linux"))]
#[tauri::command]
pub async fn reminders_remove(_note_uri: String, _reminder_id: String) -> String {
    "remove-unavailable".to_string()
}

/// Calls `dev.eskerra.Reminders1.SnoozeReminder(noteUri, id, minutes)` on the
/// session D-Bus. Returns the daemon's result string (`"rescheduled"` |
/// `"fired"` | `"expired"` | `"unknown"`) on success, or `"snooze-unavailable"`
/// on any transport/registry error (daemon not running, call timed out, etc.).
/// Like `reminders_remove`, never writes to disk itself.
///
/// Linux only. On other targets always returns `"snooze-unavailable"` so the TS
/// side degrades gracefully without conditional imports.
fn is_locked_snooze_minutes(minutes: u32) -> bool {
    matches!(minutes, 3 | 1 | 0)
}

#[cfg(target_os = "linux")]
#[tauri::command]
pub async fn reminders_snooze(note_uri: String, reminder_id: String, minutes: u32) -> String {
    if !is_locked_snooze_minutes(minutes) {
        return "unknown".to_string();
    }
    match dbus_snooze_reminder(&note_uri, &reminder_id, minutes).await {
        Ok(result) => result,
        Err(_) => "snooze-unavailable".to_string(),
    }
}

#[cfg(not(target_os = "linux"))]
#[tauri::command]
pub async fn reminders_snooze(
    _note_uri: String,
    _reminder_id: String,
    minutes: u32,
) -> String {
    if !is_locked_snooze_minutes(minutes) {
        return "unknown".to_string();
    }
    "snooze-unavailable".to_string()
}

// ── D-Bus helper (Linux only) ─────────────────────────────────────────────────

/// Bound on a single D-Bus round-trip to the reminders daemon, shared by the
/// remove and snooze calls so neither button hangs on its spinner for zbus's
/// ~25s default reply timeout when the daemon is hung (not crashed).
#[cfg(target_os = "linux")]
const DBUS_CALL_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

#[cfg(target_os = "linux")]
async fn dbus_remove_reminder(note_uri: &str, reminder_id: &str) -> zbus::Result<String> {
    let conn = zbus::Connection::session().await?;
    // On timeout the caller surfaces "remove-unavailable" and offers Retry.
    let reply = tokio::time::timeout(
        DBUS_CALL_TIMEOUT,
        conn.call_method(
            Some("dev.eskerra.Reminders1"),
            "/dev/eskerra/Reminders1",
            Some("dev.eskerra.Reminders1"),
            "RemoveReminder",
            &(note_uri, reminder_id),
        ),
    )
    .await
    .map_err(|_| zbus::Error::Failure("RemoveReminder D-Bus call timed out".to_string()))??;
    let result: String = reply.body().deserialize()?;
    Ok(result)
}

#[cfg(target_os = "linux")]
async fn dbus_snooze_reminder(
    note_uri: &str,
    reminder_id: &str,
    minutes: u32,
) -> zbus::Result<String> {
    let conn = zbus::Connection::session().await?;
    let reply = tokio::time::timeout(
        DBUS_CALL_TIMEOUT,
        conn.call_method(
            Some("dev.eskerra.Reminders1"),
            "/dev/eskerra/Reminders1",
            Some("dev.eskerra.Reminders1"),
            "SnoozeReminder",
            &(note_uri, reminder_id, minutes),
        ),
    )
    .await
    .map_err(|_| zbus::Error::Failure("SnoozeReminder D-Bus call timed out".to_string()))??;
    let result: String = reply.body().deserialize()?;
    Ok(result)
}

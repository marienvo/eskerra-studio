//! XDG path resolution for the daemon's two files:
//! - config:  `$XDG_CONFIG_HOME/eskerra/reminderd.json` (default `~/.config/...`)
//! - index:   `$XDG_DATA_HOME/eskerra/reminders/<vault-hash>.json`
//!   (default `~/.local/share/...`)
//!
//! The index lives in the **app's XDG data dir, never inside the vault** (ADR
//! §3) — putting it under the synced vault would create Syncthing conflicts.

use std::path::PathBuf;

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from).filter(|p| !p.as_os_str().is_empty())
}

fn xdg_dir(env_var: &str, home_relative: &str) -> Option<PathBuf> {
    if let Some(dir) = std::env::var_os(env_var).map(PathBuf::from).filter(|p| !p.as_os_str().is_empty()) {
        return Some(dir);
    }
    home_dir().map(|home| home.join(home_relative))
}

/// `$XDG_CONFIG_HOME/eskerra` (default `~/.config/eskerra`).
pub fn config_dir() -> Option<PathBuf> {
    xdg_dir("XDG_CONFIG_HOME", ".config").map(|d| d.join("eskerra"))
}

/// `$XDG_CONFIG_HOME/eskerra/reminderd.json`.
pub fn config_path() -> Option<PathBuf> {
    config_dir().map(|d| d.join("reminderd.json"))
}

/// `$XDG_DATA_HOME/eskerra/reminders` (default `~/.local/share/eskerra/reminders`).
pub fn reminders_data_dir() -> Option<PathBuf> {
    xdg_dir("XDG_DATA_HOME", ".local/share").map(|d| d.join("eskerra").join("reminders"))
}

/// Per-vault index file inside `data_dir`. The filename is the vault hash so
/// switching vaults back and forth is cheap and non-destructive (one file each).
pub fn index_path_in(data_dir: &std::path::Path, vault_hash: &str) -> PathBuf {
    data_dir.join(format!("{vault_hash}.json"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn index_path_is_vault_hash_json_under_data_dir() {
        let data = PathBuf::from("/data/eskerra/reminders");
        assert_eq!(
            index_path_in(&data, "abc123"),
            PathBuf::from("/data/eskerra/reminders/abc123.json")
        );
    }

    #[test]
    fn xdg_env_overrides_home() {
        // Exercised via the public helpers with a scoped env override.
        let prev = std::env::var_os("XDG_DATA_HOME");
        std::env::set_var("XDG_DATA_HOME", "/custom/data");
        assert_eq!(
            reminders_data_dir(),
            Some(PathBuf::from("/custom/data/eskerra/reminders"))
        );
        match prev {
            Some(v) => std::env::set_var("XDG_DATA_HOME", v),
            None => std::env::remove_var("XDG_DATA_HOME"),
        }
    }
}

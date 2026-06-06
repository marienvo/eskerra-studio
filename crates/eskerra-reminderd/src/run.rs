//! Process wiring: build the [`Daemon`], arm the vault watcher and a
//! config-file watcher, and run the single-threaded event loop. All threads
//! funnel into one mpsc channel so the `Daemon` (which owns no threads) is
//! driven from one place.

use std::path::Path;
use std::sync::mpsc::{self, Sender};
use std::sync::Arc;
use std::time::Duration;

use chrono::Utc;
use eskerra_vault_watch::{VaultWatchEngine, WatchBatch};
use notify::{Config as NotifyConfig, Event, RecommendedWatcher, RecursiveMode, Watcher};

use crate::daemon::Daemon;
use crate::paths::{config_dir, config_path, reminders_data_dir};
use crate::watch_control::EngineWatchControl;

/// Backoff cadence for re-checking an unavailable vault (unmounted drive,
/// deleted folder) and as a slow self-heal if a config/watch signal is missed.
const RETRY_TICK: Duration = Duration::from_secs(30);

enum DaemonEvent {
    ConfigChanged,
    Vault { coarse: bool, paths: Vec<String> },
    RetryTick,
}

fn now_ms() -> i64 {
    Utc::now().timestamp_millis()
}

/// Run the daemon forever. Returns only on an unrecoverable setup error
/// (missing HOME, etc.) — systemd restarts us per the unit's `Restart=on-failure`.
pub fn run() -> Result<(), String> {
    let config_path = config_path()
        .ok_or_else(|| "cannot resolve config path (no HOME/XDG_CONFIG_HOME)".to_string())?;
    let data_dir = reminders_data_dir()
        .ok_or_else(|| "cannot resolve data dir (no HOME/XDG_DATA_HOME)".to_string())?;

    let (tx, rx) = mpsc::channel::<DaemonEvent>();

    // Vault watcher → DaemonEvent::Vault.
    let vault_tx = tx.clone();
    let engine = Arc::new(VaultWatchEngine::new(Arc::new(move |batch: WatchBatch| {
        let _ = vault_tx.send(DaemonEvent::Vault {
            coarse: batch.coarse,
            paths: batch.paths,
        });
    })));
    let watch = Box::new(EngineWatchControl::new(Arc::clone(&engine)));

    let mut daemon = Daemon::new(config_path.clone(), data_dir, watch);

    // Initial config load from disk (restart-before-app-ran reconstructs purely
    // from disk; absent config → idle).
    let outcome = daemon.reload_config(now_ms());
    eprintln!("[reminderd] startup: {outcome:?}");

    // Config-file watcher (watches the config *directory* so atomic temp+rename
    // replacements are seen).
    let _config_watcher = spawn_config_watcher(&config_path, tx.clone());

    // Backoff / self-heal tick.
    spawn_retry_ticker(tx.clone());

    for event in rx {
        match event {
            DaemonEvent::ConfigChanged => {
                let outcome = daemon.reload_config(now_ms());
                eprintln!("[reminderd] config reload: {outcome:?}");
            }
            DaemonEvent::Vault { coarse, paths } => {
                let outcome = daemon.on_watch_batch(coarse, &paths, now_ms());
                eprintln!("[reminderd] watch batch: {outcome:?}");
            }
            DaemonEvent::RetryTick => {
                // Slow self-heal for missed config watcher events, config
                // watcher startup failure, unavailable vaults, and failed
                // vault-watch rearming. Unchanged config returns NoChange.
                let outcome = daemon.reload_config(now_ms());
                eprintln!("[reminderd] retry tick: {outcome:?}");
            }
        }
    }
    Ok(())
}

/// Watch the config directory for changes to `reminderd.json`. Returns the
/// watcher handle (dropping it stops watching). Best-effort: if the directory
/// cannot be watched (e.g. does not exist yet), logs and returns `None`; the
/// retry ticker still re-reads config periodically as a fallback.
fn spawn_config_watcher(config_path: &Path, tx: Sender<DaemonEvent>) -> Option<RecommendedWatcher> {
    let dir = config_dir()?;
    // Create the config dir so we can watch it before the app first writes.
    let _ = std::fs::create_dir_all(&dir);

    let file_name = config_path.file_name().map(|n| n.to_os_string());
    let mut watcher = match RecommendedWatcher::new(
        move |res: Result<Event, notify::Error>| {
            if let Ok(ev) = res {
                let relevant = match &file_name {
                    Some(name) => ev
                        .paths
                        .iter()
                        .any(|p| p.file_name() == Some(name.as_os_str())),
                    None => true,
                };
                if relevant {
                    let _ = tx.send(DaemonEvent::ConfigChanged);
                }
            }
        },
        NotifyConfig::default(),
    ) {
        Ok(w) => w,
        Err(err) => {
            eprintln!("[reminderd] config watcher unavailable: {err}");
            return None;
        }
    };
    if let Err(err) = watcher.watch(&dir, RecursiveMode::NonRecursive) {
        eprintln!("[reminderd] config watch start failed: {err}");
        return None;
    }
    Some(watcher)
}

fn spawn_retry_ticker(tx: Sender<DaemonEvent>) {
    std::thread::spawn(move || loop {
        std::thread::sleep(RETRY_TICK);
        if tx.send(DaemonEvent::RetryTick).is_err() {
            return; // receiver gone; process shutting down
        }
    });
}

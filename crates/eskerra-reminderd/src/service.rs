//! Phase 4 D-Bus service `dev.eskerra.Reminders1` (ADR §7): exposes
//! `RemoveReminder(IN s noteUri, IN s id, OUT s result)`, the single entry point
//! the app pane's "delete" and the OS-notification `remove` action both route
//! through (single writer). The method strikes the token via the shared
//! [`Remover`] (per-note serialized) and returns the locked result string
//! (`removed` | `stale`).
//!
//! `noteUri` is routing context only — resolution is **by `id`** against the
//! daemon-owned index, never by a caller-supplied byte span / offset, so a stale
//! position can never drive a write. Transport-level failures (daemon
//! unreachable) are the **app's** concern (`remove-unavailable`, ADR §8) and are
//! never produced here.
//!
//! `zbus`'s API is version-sensitive; this targets `zbus` 5.x and uses the
//! blocking server (`zbus::interface` + `blocking::connection::Builder`),
//! matching the daemon's thread-per-source model and the existing
//! [`crate::notify`] client.

#[cfg(target_os = "linux")]
mod imp {
    use std::sync::mpsc::Sender;
    use std::sync::{Arc, Mutex};
    use std::thread::JoinHandle;

    use crate::run::{perform_remove, DaemonEvent};
    use crate::writeback::Remover;

    const SERVICE_NAME: &str = "dev.eskerra.Reminders1";
    const SERVICE_PATH: &str = "/dev/eskerra/Reminders1";

    /// The served object. The `Sender` is wrapped in a `Mutex` only to make the
    /// interface `Sync` (an `mpsc::Sender` is `Send` but not `Sync`); each call
    /// clones a cheap sender out and never holds the lock across the write-back.
    struct RemoveService {
        remover: Arc<Remover>,
        tx: Mutex<Sender<DaemonEvent>>,
    }

    #[zbus::interface(name = "dev.eskerra.Reminders1")]
    impl RemoveService {
        /// `RemoveReminder(IN s noteUri, IN s id, OUT s result)`.
        fn remove_reminder(&self, _note_uri: &str, id: &str) -> String {
            let tx = match self.tx.lock() {
                Ok(tx) => tx.clone(),
                Err(poison) => poison.into_inner().clone(),
            };
            perform_remove(id, &self.remover, &tx)
                .as_ipc_str()
                .to_string()
        }
    }

    /// Register the service on the session bus on a dedicated thread that keeps
    /// the connection alive for the daemon's lifetime; the `zbus` reactor
    /// processes incoming `RemoveReminder` calls on its own tasks. Best-effort:
    /// always returns `Some(handle)`; if the bus / name is unavailable the
    /// thread logs and exits immediately. The app then sees a transport failure
    /// and surfaces `remove-unavailable`.
    pub(crate) fn spawn(remover: Arc<Remover>, tx: Sender<DaemonEvent>) -> Option<JoinHandle<()>> {
        let handle = std::thread::spawn(move || {
            let service = RemoveService {
                remover,
                tx: Mutex::new(tx),
            };
            let conn = match build(service) {
                Ok(conn) => conn,
                Err(err) => {
                    eprintln!(
                        "[reminderd] RemoveReminder service unavailable ({err}); \
                         app removes will see remove-unavailable"
                    );
                    return;
                }
            };
            eprintln!("[reminderd] RemoveReminder service registered ({SERVICE_NAME})");
            // Keep the connection (and the moved-in handles) alive forever; the
            // reactor serves calls on its internal tasks.
            let _keep_alive = conn;
            loop {
                std::thread::park();
            }
        });
        Some(handle)
    }

    fn build(service: RemoveService) -> zbus::Result<zbus::blocking::Connection> {
        zbus::blocking::connection::Builder::session()?
            .name(SERVICE_NAME)?
            .serve_at(SERVICE_PATH, service)?
            .build()
    }
}

#[cfg(target_os = "linux")]
pub(crate) use imp::spawn as spawn_remove_service;

/// Non-Linux fallback: no session-bus service. The daemon still runs; removes
/// arrive only via the in-process OS-notification action path.
#[cfg(not(target_os = "linux"))]
pub(crate) fn spawn_remove_service(
    _remover: std::sync::Arc<crate::writeback::Remover>,
    _tx: std::sync::mpsc::Sender<crate::run::DaemonEvent>,
) -> Option<std::thread::JoinHandle<()>> {
    None
}

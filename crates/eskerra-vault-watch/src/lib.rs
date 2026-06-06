//! Shared vault filesystem watcher, extracted from the desktop app's
//! `vault_watch.rs` so the app and the `eskerra-reminderd` daemon share **one**
//! watcher implementation (Phase 2 of
//! `specs/plans/desktop-reminders-daemon-phased.md`).
//!
//! The engine runs two `notify` backends in parallel — the OS-native
//! `RecommendedWatcher` plus a stat-based `PollWatcher` fallback — debounces
//! their events into coarse-or-precise batches, deduplicates cross-backend
//! echoes, and filters ignored / hard-excluded vault subtrees. It is
//! Tauri-free: a consumer supplies an `on_batch` callback. The app maps each
//! [`WatchBatch`] to its `vault-files-changed` Tauri event; the daemon turns a
//! batch into an incremental rescan.
//!
//! Session scoping mirrors the app's original design: a single long-lived
//! debouncer thread reads from one channel, and each [`VaultWatchEngine::start_watching`]
//! call bumps an `active_session_id` so in-flight events from a torn-down
//! watch (e.g. after a vault switch) are dropped rather than misattributed.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, Weak};
use std::time::{Duration, Instant, SystemTime};

#[cfg(test)]
use std::io;

use notify::{Config, Event, PollWatcher, RecommendedWatcher, RecursiveMode, Watcher};

mod exclusions;
pub use exclusions::{
    is_vault_tree_hard_excluded_directory_name, is_vault_tree_ignored_entry_name,
};

const WATCH_DEBOUNCE_MS: u64 = 200;
const WATCH_MAX_BATCH_MS: u64 = 900;
const WATCH_POLL_INTERVAL_MS: u64 = 750;
const WATCH_POLL_COMPARE_CONTENTS: bool = false;
const WATCH_CROSS_BACKEND_DEDUP_MS: u64 = WATCH_POLL_INTERVAL_MS + WATCH_DEBOUNCE_MS + 300;

/// A debounced batch of vault changes delivered to the engine's `on_batch`
/// callback. The app converts this to its `VaultFilesChangedPayload`; the
/// daemon turns `paths` (or a `coarse` full-vault signal) into a rescan.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WatchBatch {
    /// Absolute filesystem paths touched in this debounced batch (files and directories).
    pub paths: Vec<String>,
    /// When true, the consumer must treat this as full-vault invalidation (ignore `paths` precision).
    pub coarse: bool,
    /// Best-effort coarse invalidation reason for diagnostics / observability.
    pub coarse_reason: Option<String>,
}

/// Callback invoked once per debounced batch, off the watcher callback threads
/// (on the engine's dedicated debouncer thread). Must be cheap or hand work off
/// to another thread — it runs serially with debouncing.
pub type OnBatch = Arc<dyn Fn(WatchBatch) + Send + Sync>;

enum VaultWatchSignal {
    Paths {
        session_id: u64,
        backend: &'static str,
        paths: Vec<String>,
    },
    Coarse {
        session_id: u64,
        reason: String,
    },
}

struct VaultWatchers {
    _recommended: RecommendedWatcher,
    // Owns the poll backend. Watch callbacks only hold `Weak` references to
    // this mutex, so the PollWatcher callback cannot keep its own owner alive.
    _poll: Arc<Mutex<Option<PollWatcher>>>,
    _poll_watched_dirs: Arc<Mutex<HashSet<PathBuf>>>,
}

/// The shared watcher engine. Construct once with [`VaultWatchEngine::new`]
/// (spawns the debouncer thread), then [`start_watching`](Self::start_watching)
/// a vault root — re-call to switch vaults, or [`stop`](Self::stop) to go idle.
pub struct VaultWatchEngine {
    watchers: Mutex<Option<VaultWatchers>>,
    notify_tx: std::sync::mpsc::Sender<VaultWatchSignal>,
    active_session_id: Arc<AtomicU64>,
}

impl VaultWatchEngine {
    /// Spawn the long-lived debouncer thread. `on_batch` is invoked once per
    /// debounced batch for the currently active watch session.
    pub fn new(on_batch: OnBatch) -> Self {
        let (tx, rx) = std::sync::mpsc::channel();
        let active_session_id = Arc::new(AtomicU64::new(0));
        spawn_vault_debouncer(on_batch, rx, Arc::clone(&active_session_id));
        Self {
            watchers: Mutex::new(None),
            notify_tx: tx,
            active_session_id,
        }
    }

    /// (Re)start watching `root`: bump the session id, tear down any previous
    /// watchers, and arm the recommended + poll backends. On a vault switch,
    /// in-flight events from the previous session are dropped by the debouncer.
    pub fn start_watching(&self, root: &Path) -> Result<(), String> {
        {
            let mut guard = self.watchers.lock().map_err(|e| e.to_string())?;
            *guard = None;
        }
        let session_id = self.active_session_id.fetch_add(1, Ordering::AcqRel) + 1;

        let tx_poll = self.notify_tx.clone();
        let poll = Arc::new(Mutex::new(None));
        let poll_weak = Arc::downgrade(&poll);
        let poll_watched_dirs = Arc::new(Mutex::new(HashSet::new()));
        // Keep the poll fallback stat-based. `compare_contents=true` would recursively
        // read and hash every file in the vault on every poll, including attachments.
        let poll_config = Config::default()
            .with_poll_interval(Duration::from_millis(WATCH_POLL_INTERVAL_MS))
            .with_compare_contents(WATCH_POLL_COMPARE_CONTENTS);
        match PollWatcher::new(
            {
                let poll = Weak::clone(&poll_weak);
                let root = root.to_path_buf();
                let poll_watched_dirs = Arc::clone(&poll_watched_dirs);
                let tx_poll = tx_poll.clone();
                move |res: Result<Event, notify::Error>| {
                    handle_notify_event(
                        &tx_poll,
                        session_id,
                        "poll",
                        &root,
                        &poll,
                        &poll_watched_dirs,
                        res,
                    );
                }
            },
            poll_config,
        ) {
            Ok(created_poll) => {
                let mut poll_guard = poll.lock().map_err(|e| e.to_string())?;
                *poll_guard = Some(created_poll);
            }
            Err(err) => {
                notify_coarse(&self.notify_tx, session_id, format!("poll_watcher:{err}"));
            }
        };

        let tx_recommended = self.notify_tx.clone();
        let recommended_poll = Weak::clone(&poll_weak);
        let recommended_root = root.to_path_buf();
        let recommended_poll_watched_dirs = Arc::clone(&poll_watched_dirs);
        let mut recommended = RecommendedWatcher::new(
            move |res: Result<Event, notify::Error>| {
                handle_notify_event(
                    &tx_recommended,
                    session_id,
                    "recommended",
                    &recommended_root,
                    &recommended_poll,
                    &recommended_poll_watched_dirs,
                    res,
                );
            },
            Config::default(),
        )
        .map_err(|e| format!("recommended watcher: {e}"))?;

        if root.exists() {
            recommended
                .watch(root, RecursiveMode::Recursive)
                .map_err(|e| format!("recommended watch {}: {e}", root.display()))?;
            register_poll_watch_roots_lossy(
                &poll_weak,
                &poll_watched_dirs,
                &[root.to_path_buf()],
                &self.notify_tx,
                session_id,
            );
        } else {
            let _ = self.notify_tx.send(VaultWatchSignal::Coarse {
                session_id,
                reason: "vault_root_missing_at_watch_start".to_string(),
            });
        }

        let mut guard = self.watchers.lock().map_err(|e| e.to_string())?;
        *guard = Some(VaultWatchers {
            _recommended: recommended,
            _poll: poll,
            _poll_watched_dirs: poll_watched_dirs,
        });
        Ok(())
    }

    /// Tear down the active watch (drop both backends) and bump the session id
    /// so any in-flight events are dropped. Used to go idle (e.g. the daemon's
    /// "vault unavailable" / "no active vault" states). The debouncer thread
    /// keeps running, ready for the next [`start_watching`](Self::start_watching).
    pub fn stop(&self) {
        self.active_session_id.fetch_add(1, Ordering::AcqRel);
        if let Ok(mut guard) = self.watchers.lock() {
            *guard = None;
        }
    }
}

fn send_notify_event(
    tx: &std::sync::mpsc::Sender<VaultWatchSignal>,
    session_id: u64,
    backend: &'static str,
    res: Result<Event, notify::Error>,
) {
    match res {
        Ok(ev) => {
            let batch: Vec<String> = ev
                .paths
                .iter()
                .map(|p| p.to_string_lossy().into_owned())
                .collect();
            if batch.is_empty() {
                let _ = tx.send(VaultWatchSignal::Coarse {
                    session_id,
                    reason: format!("notify_event_empty_paths:{backend}"),
                });
            } else {
                let _ = tx.send(VaultWatchSignal::Paths {
                    session_id,
                    backend,
                    paths: batch,
                });
            }
        }
        Err(err) => {
            eprintln!("[vault-watch] {backend} watcher error: {err}");
            let _ = tx.send(VaultWatchSignal::Coarse {
                session_id,
                reason: format!("notify_error:{backend}:{err}"),
            });
        }
    }
}

fn handle_notify_event(
    tx: &std::sync::mpsc::Sender<VaultWatchSignal>,
    session_id: u64,
    backend: &'static str,
    root: &Path,
    poll: &Weak<Mutex<Option<PollWatcher>>>,
    watched_dirs: &Arc<Mutex<HashSet<PathBuf>>>,
    res: Result<Event, notify::Error>,
) {
    match res {
        Ok(ev) => {
            let paths = ev.paths.clone();
            send_notify_event(tx, session_id, backend, Ok(ev));
            let roots = candidate_poll_watch_roots(root, &paths);
            register_poll_watch_roots_lossy(poll, watched_dirs, &roots, tx, session_id);
        }
        Err(err) => {
            send_notify_event(tx, session_id, backend, Err(err));
        }
    }
}

fn notify_coarse(tx: &std::sync::mpsc::Sender<VaultWatchSignal>, session_id: u64, reason: String) {
    eprintln!("[vault-watch] {reason}");
    let _ = tx.send(VaultWatchSignal::Coarse { session_id, reason });
}

fn signal_session_id(signal: &VaultWatchSignal) -> u64 {
    match signal {
        VaultWatchSignal::Paths { session_id, .. }
        | VaultWatchSignal::Coarse { session_id, .. } => *session_id,
    }
}

fn apply_watch_signal(
    signal: VaultWatchSignal,
    acc: &mut HashSet<String>,
    path_backends: &mut PayloadPathBackends,
    coarse_reason: &mut Option<String>,
) {
    match signal {
        VaultWatchSignal::Paths { backend, paths, .. } => {
            for path in paths {
                acc.insert(path.clone());
                path_backends.entry(path).or_default().insert(backend);
            }
        }
        VaultWatchSignal::Coarse { reason, .. } => {
            if coarse_reason.is_none() {
                *coarse_reason = Some(reason);
            }
        }
    }
}

type WatchBackendSet = HashSet<&'static str>;
type PayloadPathBackends = HashMap<String, WatchBackendSet>;

struct DebouncedWatchPayload {
    payload: WatchBatch,
    path_backends: PayloadPathBackends,
}

enum DebouncedPayloadResult {
    Payload(DebouncedWatchPayload),
    DropStale,
    Disconnected,
}

#[derive(Clone, Debug, Eq, PartialEq)]
enum PathFingerprint {
    Exists {
        is_dir: bool,
        len: u64,
        modified: Option<SystemTime>,
    },
    Missing,
}

#[derive(Clone, Debug)]
struct RecentPathEmission {
    emitted_at: Instant,
    fingerprint: PathFingerprint,
    backends: WatchBackendSet,
}

type RecentPathEmissionCache = HashMap<String, RecentPathEmission>;

fn path_fingerprint(path: &str) -> PathFingerprint {
    match fs::metadata(path) {
        Ok(meta) => PathFingerprint::Exists {
            is_dir: meta.is_dir(),
            len: meta.len(),
            modified: meta.modified().ok(),
        },
        Err(_) => PathFingerprint::Missing,
    }
}

fn collect_debounced_payload(
    rx: &std::sync::mpsc::Receiver<VaultWatchSignal>,
    first_signal: VaultWatchSignal,
    active_session_id: &AtomicU64,
    debounce_ms: u64,
    max_batch_ms: u64,
) -> DebouncedPayloadResult {
    let mut session_id = signal_session_id(&first_signal);
    if session_id != active_session_id.load(Ordering::Acquire) {
        return DebouncedPayloadResult::DropStale;
    }
    let mut acc: HashSet<String> = HashSet::new();
    let mut path_backends: PayloadPathBackends = HashMap::new();
    let mut coarse_reason: Option<String> = None;
    let mut started_at = Instant::now();
    apply_watch_signal(
        first_signal,
        &mut acc,
        &mut path_backends,
        &mut coarse_reason,
    );
    loop {
        let elapsed = started_at.elapsed();
        let max_batch = Duration::from_millis(max_batch_ms);
        if elapsed >= max_batch {
            break;
        }
        let remaining = max_batch - elapsed;
        let wait = std::cmp::min(Duration::from_millis(debounce_ms), remaining);
        match rx.recv_timeout(wait) {
            Ok(more) => {
                let more_session_id = signal_session_id(&more);
                if more_session_id == session_id {
                    apply_watch_signal(more, &mut acc, &mut path_backends, &mut coarse_reason);
                } else if more_session_id == active_session_id.load(Ordering::Acquire) {
                    session_id = more_session_id;
                    acc.clear();
                    path_backends.clear();
                    coarse_reason = None;
                    started_at = Instant::now();
                    apply_watch_signal(more, &mut acc, &mut path_backends, &mut coarse_reason);
                }
            }
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => break,
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                return DebouncedPayloadResult::Disconnected;
            }
        }
    }
    if session_id != active_session_id.load(Ordering::Acquire) {
        return DebouncedPayloadResult::DropStale;
    }
    let paths: Vec<String> = acc.into_iter().collect();
    let coarse = coarse_reason.is_some();
    DebouncedPayloadResult::Payload(DebouncedWatchPayload {
        payload: WatchBatch {
            paths,
            coarse,
            coarse_reason,
        },
        path_backends,
    })
}

fn spawn_vault_debouncer(
    on_batch: OnBatch,
    rx: std::sync::mpsc::Receiver<VaultWatchSignal>,
    active_session_id: Arc<AtomicU64>,
) {
    std::thread::spawn(move || {
        let mut recent_emissions = RecentPathEmissionCache::new();
        while let Ok(first_signal) = rx.recv() {
            match collect_debounced_payload(
                &rx,
                first_signal,
                &active_session_id,
                WATCH_DEBOUNCE_MS,
                WATCH_MAX_BATCH_MS,
            ) {
                DebouncedPayloadResult::Payload(payload) => {
                    if let Some(payload) = dedupe_recent_precise_payload(
                        payload.payload,
                        payload.path_backends,
                        &mut recent_emissions,
                        Instant::now(),
                        Duration::from_millis(WATCH_CROSS_BACKEND_DEDUP_MS),
                        path_fingerprint,
                    ) {
                        on_batch(payload);
                    }
                }
                DebouncedPayloadResult::DropStale => {}
                DebouncedPayloadResult::Disconnected => return,
            }
        }
    });
}

fn dedupe_recent_precise_payload(
    mut payload: WatchBatch,
    path_backends: PayloadPathBackends,
    recent: &mut RecentPathEmissionCache,
    now: Instant,
    dedup_window: Duration,
    fingerprint: impl Fn(&str) -> PathFingerprint,
) -> Option<WatchBatch> {
    recent.retain(|_, entry| now.saturating_duration_since(entry.emitted_at) <= dedup_window);

    if payload.coarse {
        for path in &payload.paths {
            recent.insert(
                path.clone(),
                RecentPathEmission {
                    emitted_at: now,
                    fingerprint: fingerprint(path),
                    backends: path_backends.get(path).cloned().unwrap_or_default(),
                },
            );
        }
        return Some(payload);
    }

    let mut filtered_paths = Vec::with_capacity(payload.paths.len());
    for path in payload.paths {
        let current_fingerprint = fingerprint(&path);
        let is_recent_duplicate = recent.get(&path).is_some_and(|entry| {
            let current_backends = path_backends.get(&path);
            entry.fingerprint == current_fingerprint
                && !entry.backends.is_empty()
                && current_backends.is_some_and(|backends| {
                    !backends.is_empty() && backends.is_disjoint(&entry.backends)
                })
        });
        if !is_recent_duplicate {
            filtered_paths.push(path.clone());
            let backends = path_backends.get(&path).cloned().unwrap_or_default();
            recent.insert(
                path,
                RecentPathEmission {
                    emitted_at: now,
                    fingerprint: current_fingerprint,
                    backends,
                },
            );
        }
    }

    if filtered_paths.is_empty() {
        None
    } else {
        payload.paths = filtered_paths;
        Some(payload)
    }
}

#[cfg(test)]
fn collect_poll_watch_directories(root: &Path) -> io::Result<Vec<PathBuf>> {
    let mut dirs = Vec::new();
    collect_poll_watch_directories_inner(root, &mut dirs)?;
    Ok(dirs)
}

#[cfg(test)]
fn collect_poll_watch_directories_inner(dir: &Path, out: &mut Vec<PathBuf>) -> io::Result<()> {
    out.push(dir.to_path_buf());
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if is_vault_tree_ignored_entry_name(&name_str)
            || is_vault_tree_hard_excluded_directory_name(&name_str)
        {
            continue;
        }

        let path = entry.path();
        if entry.file_type()?.is_dir() {
            collect_poll_watch_directories_inner(&path, out)?;
        }
    }
    Ok(())
}

fn collect_poll_watch_directories_lossy(
    root: &Path,
    on_error: &mut impl FnMut(String),
) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    collect_poll_watch_directories_lossy_inner(root, &mut dirs, on_error);
    dirs
}

fn collect_poll_watch_directories_lossy_inner(
    dir: &Path,
    out: &mut Vec<PathBuf>,
    on_error: &mut impl FnMut(String),
) {
    out.push(dir.to_path_buf());
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(err) => {
            on_error(format!("poll_watch_directory_scan:{}:{err}", dir.display()));
            return;
        }
    };

    for entry in entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(err) => {
                on_error(format!(
                    "poll_watch_directory_entry:{}:{err}",
                    dir.display()
                ));
                continue;
            }
        };
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if is_vault_tree_ignored_entry_name(&name_str)
            || is_vault_tree_hard_excluded_directory_name(&name_str)
        {
            continue;
        }

        let path = entry.path();
        match entry.file_type() {
            Ok(file_type) if file_type.is_dir() => {
                collect_poll_watch_directories_lossy_inner(&path, out, on_error);
            }
            Ok(_) => {}
            Err(err) => {
                on_error(format!("poll_watch_file_type:{}:{err}", path.display()));
            }
        }
    }
}

fn path_has_excluded_poll_component(root: &Path, path: &Path) -> bool {
    let relative = path.strip_prefix(root).unwrap_or(path);
    relative.components().any(|component| {
        let name = component.as_os_str().to_string_lossy();
        is_vault_tree_ignored_entry_name(&name) || is_vault_tree_hard_excluded_directory_name(&name)
    })
}

fn candidate_poll_watch_roots(root: &Path, paths: &[PathBuf]) -> Vec<PathBuf> {
    paths
        .iter()
        .filter_map(|path| {
            if path_has_excluded_poll_component(root, path) {
                return None;
            }

            match fs::symlink_metadata(path) {
                Ok(meta) if meta.is_dir() => Some(path.clone()),
                _ => None,
            }
        })
        .collect()
}

fn register_poll_watch_directories(
    poll: &Weak<Mutex<Option<PollWatcher>>>,
    watched_dirs: &Arc<Mutex<HashSet<PathBuf>>>,
    dirs: Vec<PathBuf>,
    tx: &std::sync::mpsc::Sender<VaultWatchSignal>,
    session_id: u64,
) {
    for dir in dirs {
        let should_watch = match watched_dirs.lock() {
            Ok(mut watched) => watched.insert(dir.clone()),
            Err(err) => {
                notify_coarse(tx, session_id, format!("poll_watched_dirs_lock:{err}"));
                return;
            }
        };
        if !should_watch {
            continue;
        }

        let Some(poll) = poll.upgrade() else {
            return;
        };
        let watch_result = match poll.lock() {
            Ok(mut poll) => match poll.as_mut() {
                Some(poll) => poll.watch(&dir, RecursiveMode::NonRecursive),
                None => return,
            },
            Err(err) => {
                notify_coarse(tx, session_id, format!("poll_watcher_lock:{err}"));
                return;
            }
        };

        if let Err(err) = watch_result {
            if let Ok(mut watched) = watched_dirs.lock() {
                watched.remove(&dir);
            }
            notify_coarse(
                tx,
                session_id,
                format!("poll_watch:{}:{err}", dir.display()),
            );
        }
    }
}

fn register_poll_watch_roots_lossy(
    poll: &Weak<Mutex<Option<PollWatcher>>>,
    watched_dirs: &Arc<Mutex<HashSet<PathBuf>>>,
    roots: &[PathBuf],
    tx: &std::sync::mpsc::Sender<VaultWatchSignal>,
    session_id: u64,
) {
    let mut scan_errors = Vec::new();
    let mut dirs = Vec::new();
    for root in roots {
        dirs.extend(collect_poll_watch_directories_lossy(root, &mut |reason| {
            scan_errors.push(reason);
        }));
    }
    register_poll_watch_directories(poll, watched_dirs, dirs, tx, session_id);

    for reason in scan_errors {
        notify_coarse(tx, session_id, reason);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn active_session(id: u64) -> AtomicU64 {
        AtomicU64::new(id)
    }

    fn paths(session_id: u64, paths: Vec<&str>) -> VaultWatchSignal {
        VaultWatchSignal::Paths {
            session_id,
            backend: "recommended",
            paths: paths.into_iter().map(str::to_string).collect(),
        }
    }

    fn coarse(session_id: u64, reason: &str) -> VaultWatchSignal {
        VaultWatchSignal::Coarse {
            session_id,
            reason: reason.to_string(),
        }
    }

    fn payload(result: DebouncedPayloadResult) -> WatchBatch {
        match result {
            DebouncedPayloadResult::Payload(payload) => payload.payload,
            DebouncedPayloadResult::DropStale => panic!("payload was stale"),
            DebouncedPayloadResult::Disconnected => panic!("channel disconnected"),
        }
    }

    fn precise_payload(paths: Vec<&str>) -> WatchBatch {
        WatchBatch {
            paths: paths.into_iter().map(str::to_string).collect(),
            coarse: false,
            coarse_reason: None,
        }
    }

    fn path_backends(paths: Vec<&str>, backend: &'static str) -> PayloadPathBackends {
        paths
            .into_iter()
            .map(|path| {
                let mut backends = WatchBackendSet::new();
                backends.insert(backend);
                (path.to_string(), backends)
            })
            .collect()
    }

    fn test_fingerprint(version: u64) -> PathFingerprint {
        PathFingerprint::Exists {
            is_dir: false,
            len: version,
            modified: None,
        }
    }

    #[test]
    fn dedupe_recent_precise_payload_drops_same_fingerprint_across_batches() {
        let mut recent = RecentPathEmissionCache::new();
        let started = Instant::now();
        let window = Duration::from_millis(WATCH_CROSS_BACKEND_DEDUP_MS);

        let first = dedupe_recent_precise_payload(
            precise_payload(vec!["/vault/Inbox/A.md"]),
            path_backends(vec!["/vault/Inbox/A.md"], "recommended"),
            &mut recent,
            started,
            window,
            |_| test_fingerprint(1),
        )
        .expect("first payload should emit");
        assert_eq!(first.paths, vec!["/vault/Inbox/A.md".to_string()]);

        let duplicate = dedupe_recent_precise_payload(
            precise_payload(vec!["/vault/Inbox/A.md"]),
            path_backends(vec!["/vault/Inbox/A.md"], "poll"),
            &mut recent,
            started + Duration::from_millis(WATCH_POLL_INTERVAL_MS),
            window,
            |_| test_fingerprint(1),
        );
        assert!(duplicate.is_none());
    }

    #[test]
    fn dedupe_recent_precise_payload_keeps_same_path_when_fingerprint_changes() {
        let mut recent = RecentPathEmissionCache::new();
        let started = Instant::now();
        let window = Duration::from_millis(WATCH_CROSS_BACKEND_DEDUP_MS);

        dedupe_recent_precise_payload(
            precise_payload(vec!["/vault/Inbox/A.md"]),
            path_backends(vec!["/vault/Inbox/A.md"], "recommended"),
            &mut recent,
            started,
            window,
            |_| test_fingerprint(1),
        )
        .expect("first payload should emit");

        let changed = dedupe_recent_precise_payload(
            precise_payload(vec!["/vault/Inbox/A.md"]),
            path_backends(vec!["/vault/Inbox/A.md"], "poll"),
            &mut recent,
            started + Duration::from_millis(WATCH_POLL_INTERVAL_MS),
            window,
            |_| test_fingerprint(2),
        )
        .expect("changed same-path payload should emit");
        assert_eq!(changed.paths, vec!["/vault/Inbox/A.md".to_string()]);
    }

    #[test]
    fn dedupe_recent_precise_payload_keeps_same_backend_same_fingerprint_edit() {
        let mut recent = RecentPathEmissionCache::new();
        let started = Instant::now();
        let window = Duration::from_millis(WATCH_CROSS_BACKEND_DEDUP_MS);

        dedupe_recent_precise_payload(
            precise_payload(vec!["/vault/Inbox/A.md"]),
            path_backends(vec!["/vault/Inbox/A.md"], "recommended"),
            &mut recent,
            started,
            window,
            |_| test_fingerprint(1),
        )
        .expect("first payload should emit");

        let second_edit = dedupe_recent_precise_payload(
            precise_payload(vec!["/vault/Inbox/A.md"]),
            path_backends(vec!["/vault/Inbox/A.md"], "recommended"),
            &mut recent,
            started + Duration::from_millis(WATCH_POLL_INTERVAL_MS),
            window,
            |_| test_fingerprint(1),
        )
        .expect("same-backend edit should emit even with unchanged coarse fingerprint");
        assert_eq!(second_edit.paths, vec!["/vault/Inbox/A.md".to_string()]);
    }

    #[test]
    fn dedupe_recent_precise_payload_keeps_same_backend_edit_after_cross_backend_echo() {
        let mut recent = RecentPathEmissionCache::new();
        let started = Instant::now();
        let window = Duration::from_millis(WATCH_CROSS_BACKEND_DEDUP_MS);

        dedupe_recent_precise_payload(
            precise_payload(vec!["/vault/Inbox/A.md"]),
            path_backends(vec!["/vault/Inbox/A.md"], "recommended"),
            &mut recent,
            started,
            window,
            |_| test_fingerprint(1),
        )
        .expect("first payload should emit");

        let duplicate = dedupe_recent_precise_payload(
            precise_payload(vec!["/vault/Inbox/A.md"]),
            path_backends(vec!["/vault/Inbox/A.md"], "poll"),
            &mut recent,
            started + Duration::from_millis(WATCH_POLL_INTERVAL_MS),
            window,
            |_| test_fingerprint(1),
        );
        assert!(duplicate.is_none());

        let second_edit = dedupe_recent_precise_payload(
            precise_payload(vec!["/vault/Inbox/A.md"]),
            path_backends(vec!["/vault/Inbox/A.md"], "recommended"),
            &mut recent,
            started + Duration::from_millis(WATCH_POLL_INTERVAL_MS + 1),
            window,
            |_| test_fingerprint(1),
        )
        .expect("same-backend edit should still emit after suppressed poll echo");
        assert_eq!(second_edit.paths, vec!["/vault/Inbox/A.md".to_string()]);
    }

    #[test]
    fn dedupe_recent_precise_payload_keeps_duplicates_after_window_expires() {
        let mut recent = RecentPathEmissionCache::new();
        let started = Instant::now();
        let window = Duration::from_millis(WATCH_CROSS_BACKEND_DEDUP_MS);

        dedupe_recent_precise_payload(
            precise_payload(vec!["/vault/Inbox/A.md"]),
            path_backends(vec!["/vault/Inbox/A.md"], "recommended"),
            &mut recent,
            started,
            window,
            |_| test_fingerprint(1),
        )
        .expect("first payload should emit");

        let later = dedupe_recent_precise_payload(
            precise_payload(vec!["/vault/Inbox/A.md"]),
            path_backends(vec!["/vault/Inbox/A.md"], "poll"),
            &mut recent,
            started + window + Duration::from_millis(1),
            window,
            |_| test_fingerprint(1),
        )
        .expect("same fingerprint outside dedup window should emit");
        assert_eq!(later.paths, vec!["/vault/Inbox/A.md".to_string()]);
    }

    #[test]
    fn collect_poll_watch_directories_skips_ignored_subtrees() {
        let tmp = tempfile::tempdir().unwrap();
        fs::create_dir_all(tmp.path().join("Inbox/Nested")).unwrap();
        fs::create_dir_all(tmp.path().join(".venv/bin")).unwrap();
        fs::create_dir_all(tmp.path().join("Assets/Attachments")).unwrap();
        fs::create_dir_all(tmp.path().join("_autosync-backup-1")).unwrap();

        let dirs = collect_poll_watch_directories(tmp.path()).unwrap();

        assert!(dirs.iter().any(|p| p == tmp.path()));
        assert!(dirs.iter().any(|p| p.ends_with("Inbox")));
        assert!(dirs.iter().any(|p| p.ends_with("Nested")));
        assert!(dirs.iter().any(|p| p.ends_with("_autosync-backup-1")));
        assert!(!dirs.iter().any(|p| p.ends_with(".venv")));
        assert!(!dirs.iter().any(|p| p.ends_with("bin")));
        assert!(!dirs.iter().any(|p| p.ends_with("Assets")));
        assert!(!dirs.iter().any(|p| p.ends_with("Attachments")));
    }

    #[test]
    fn candidate_poll_watch_roots_skips_paths_under_excluded_subtrees() {
        let tmp = tempfile::tempdir().unwrap();
        let inbox = tmp.path().join("Inbox/NewProject");
        let attachment_album = tmp.path().join("Assets/NewAlbum");
        let ignored_child = tmp.path().join(".venv/src");
        fs::create_dir_all(&inbox).unwrap();
        fs::create_dir_all(&attachment_album).unwrap();
        fs::create_dir_all(&ignored_child).unwrap();

        let roots = candidate_poll_watch_roots(
            tmp.path(),
            &[
                inbox.clone(),
                attachment_album.clone(),
                ignored_child.clone(),
            ],
        );

        assert!(roots.contains(&inbox));
        assert!(!roots.contains(&attachment_album));
        assert!(!roots.contains(&ignored_child));
    }

    #[cfg(unix)]
    #[test]
    fn candidate_poll_watch_roots_skips_symlinked_directories() {
        use std::os::unix::fs::symlink;

        let tmp = tempfile::tempdir().unwrap();
        let external = tempfile::tempdir().unwrap();
        let inbox = tmp.path().join("Inbox");
        let symlinked_dir = inbox.join("ext");
        fs::create_dir_all(&inbox).unwrap();
        symlink(external.path(), &symlinked_dir).unwrap();

        let roots = candidate_poll_watch_roots(tmp.path(), &[symlinked_dir.clone()]);

        assert!(!roots.contains(&symlinked_dir));
    }

    #[test]
    fn collect_debounced_payload_marks_coarse_when_any_coarse_signal_arrives() {
        let (tx, rx) = std::sync::mpsc::channel();
        let active = active_session(1);
        tx.send(paths(1, vec!["/vault/Inbox/A.md"]))
            .expect("send path signal");
        tx.send(coarse(1, "notify_error:recommended:overflow"))
            .expect("send coarse signal");

        let payload = payload(collect_debounced_payload(
            &rx,
            paths(1, vec!["/vault/Inbox/B.md"]),
            &active,
            10,
            50,
        ));
        assert!(payload.coarse);
        assert_eq!(
            payload.coarse_reason.as_deref(),
            Some("notify_error:recommended:overflow")
        );
        assert!(payload.paths.contains(&"/vault/Inbox/A.md".to_string()));
        assert!(payload.paths.contains(&"/vault/Inbox/B.md".to_string()));
    }

    #[test]
    fn collect_debounced_payload_deduplicates_paths_from_dual_backends() {
        let (tx, rx) = std::sync::mpsc::channel();
        let active = active_session(1);
        tx.send(paths(1, vec!["/vault/Inbox/A.md", "/vault/Inbox/B.md"]))
            .expect("send poll paths");

        let payload = payload(collect_debounced_payload(
            &rx,
            paths(1, vec!["/vault/Inbox/A.md", "/vault/Inbox/B.md"]),
            &active,
            10,
            50,
        ));
        assert!(!payload.coarse);
        assert_eq!(payload.paths.len(), 2);
        assert!(payload.paths.contains(&"/vault/Inbox/A.md".to_string()));
        assert!(payload.paths.contains(&"/vault/Inbox/B.md".to_string()));
    }

    #[test]
    fn collect_debounced_payload_drops_stale_session_signal() {
        let (_tx, rx) = std::sync::mpsc::channel();
        let active = active_session(2);

        let result = collect_debounced_payload(
            &rx,
            paths(1, vec!["/old-vault/Inbox/A.md"]),
            &active,
            10,
            50,
        );

        assert!(matches!(result, DebouncedPayloadResult::DropStale));
    }

    #[test]
    fn collect_debounced_payload_switches_to_new_active_session_mid_batch() {
        let (tx, rx) = std::sync::mpsc::channel();
        let _hold_tx_open = tx.clone();
        let active = Arc::new(active_session(1));
        let active_for_thread = Arc::clone(&active);
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(5));
            active_for_thread.store(2, Ordering::Release);
            tx.send(paths(2, vec!["/new-vault/Inbox/New.md"]))
                .expect("send new-session paths");
        });

        let payload = payload(collect_debounced_payload(
            &rx,
            paths(1, vec!["/old-vault/Inbox/Old.md"]),
            &active,
            10,
            50,
        ));

        assert_eq!(payload.paths, vec!["/new-vault/Inbox/New.md".to_string()]);
    }

    #[test]
    fn collect_debounced_payload_respects_max_batch_duration_for_continuous_stream() {
        let (tx, rx) = std::sync::mpsc::channel();
        let active = active_session(1);
        std::thread::spawn(move || {
            for i in 0..200 {
                let _ = tx.send(VaultWatchSignal::Paths {
                    session_id: 1,
                    backend: "recommended",
                    paths: vec![format!("/vault/Inbox/{i}.md")],
                });
                std::thread::sleep(Duration::from_millis(2));
            }
        });

        let started = Instant::now();
        let payload = payload(collect_debounced_payload(
            &rx,
            paths(1, vec!["/vault/Inbox/first.md"]),
            &active,
            20,
            80,
        ));
        let elapsed = started.elapsed();
        assert!(
            elapsed < Duration::from_millis(220),
            "elapsed={elapsed:?} should stay bounded by max batch duration"
        );
        assert!(payload.paths.contains(&"/vault/Inbox/first.md".to_string()));
    }

    #[test]
    fn engine_start_watching_detects_a_real_file_change() {
        use std::sync::mpsc;

        let tmp = tempfile::tempdir().unwrap();
        let (tx, rx) = mpsc::channel::<WatchBatch>();
        let engine = VaultWatchEngine::new(Arc::new(move |batch: WatchBatch| {
            let _ = tx.send(batch);
        }));
        engine.start_watching(tmp.path()).unwrap();

        // Give the watchers a moment to arm, then create a markdown file.
        std::thread::sleep(Duration::from_millis(100));
        let note = tmp.path().join("note.md");
        fs::write(&note, b"@2026-06-06_0900 hi").unwrap();

        // The poll backend ticks at ~750ms; allow a couple of intervals plus
        // the debounce window before giving up.
        let batch = rx
            .recv_timeout(Duration::from_secs(5))
            .expect("a watch batch should arrive after a real file write");
        let touched_note = batch.coarse
            || batch
                .paths
                .iter()
                .any(|p| Path::new(p).ends_with("note.md") || p.contains("note.md"));
        assert!(
            touched_note,
            "batch did not reference the new file: {batch:?}"
        );
    }
}

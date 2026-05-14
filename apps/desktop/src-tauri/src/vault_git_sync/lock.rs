use std::collections::HashSet;
use std::fs::{self, File};
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};

use fs2::FileExt;
use sha2::{Digest, Sha256};

use crate::vault_git_sync::errors::SyncError;

/// In-process guard: prevents same-process re-entry, which flock(2) would otherwise allow
/// when the same PID already owns the lock on a given inode.
static IN_PROCESS_LOCKS: LazyLock<Mutex<HashSet<PathBuf>>> =
    LazyLock::new(|| Mutex::new(HashSet::new()));

/// RAII lock scoped to a single vault sync run.
///
/// The lock file lives in `locks_dir` (outside the vault — typically the Tauri
/// `app_local_data_dir`). Its name is derived from a deterministic hash of the
/// canonicalized vault path so that different vaults get independent lock files.
pub struct VaultSyncLock {
    _file: File,
    canonical_vault_path: PathBuf,
    pub lock_path: PathBuf,
}

impl Drop for VaultSyncLock {
    fn drop(&mut self) {
        // Release the OS flock explicitly before clearing the in-process guard.
        // This removes any window where another thread could pass the in-process check
        // but then race against a not-yet-closed fd still holding the flock.
        let _ = self._file.unlock();
        if let Ok(mut set) = IN_PROCESS_LOCKS.lock() {
            set.remove(&self.canonical_vault_path);
        }
    }
}

impl VaultSyncLock {
    /// Try to acquire the lock non-blockingly. Returns `LockAlreadyHeld` if another
    /// run (in-process or cross-process) already holds it.
    pub fn try_acquire(locks_dir: &Path, vault_path: &Path) -> Result<Self, SyncError> {
        let canonical = vault_path
            .canonicalize()
            .map_err(|e| SyncError::GitCommandFailed {
                command: "canonicalize vault path for lock".into(),
                exit_code: None,
                stderr: e.to_string(),
            })?;

        {
            let mut set = IN_PROCESS_LOCKS.lock().expect("IN_PROCESS_LOCKS poisoned");
            if set.contains(&canonical) {
                return Err(SyncError::LockAlreadyHeld);
            }
            set.insert(canonical.clone());
        }

        match acquire_file_lock(locks_dir, &canonical) {
            Ok((file, lock_path)) => Ok(Self {
                _file: file,
                canonical_vault_path: canonical,
                lock_path,
            }),
            Err(e) => {
                if let Ok(mut set) = IN_PROCESS_LOCKS.lock() {
                    set.remove(&canonical);
                }
                Err(e)
            }
        }
    }
}

fn acquire_file_lock(locks_dir: &Path, canonical: &Path) -> Result<(File, PathBuf), SyncError> {
    fs::create_dir_all(locks_dir).map_err(|e| SyncError::GitCommandFailed {
        command: "create lock directory".into(),
        exit_code: None,
        stderr: e.to_string(),
    })?;
    let lock_path = lock_path_for(locks_dir, canonical);
    let file = File::create(&lock_path).map_err(|e| SyncError::GitCommandFailed {
        command: "create lock file".into(),
        exit_code: None,
        stderr: e.to_string(),
    })?;
    file.try_lock_exclusive()
        .map_err(|_| SyncError::LockAlreadyHeld)?;
    Ok((file, lock_path))
}

/// First 16 hex characters of the SHA-256 hash of the canonical vault path bytes.
/// Matches the plan's `sha256(canonical_vault_path)[..16]` description.
fn vault_path_hash(canonical: &Path) -> String {
    let mut h = Sha256::new();
    h.update(canonical.as_os_str().as_encoded_bytes());
    let digest = h.finalize();
    digest[..8].iter().map(|b| format!("{b:02x}")).collect()
}

pub fn lock_path_for(locks_dir: &Path, canonical_vault_path: &Path) -> PathBuf {
    let hash = vault_path_hash(canonical_vault_path);
    locks_dir.join(format!("git-sync-{hash}.lock"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn acquires_and_releases() {
        let vault = tempdir().unwrap();
        let locks = tempdir().unwrap();
        let lock = VaultSyncLock::try_acquire(locks.path(), vault.path()).unwrap();
        drop(lock);
        // Must be acquirable again after drop.
        VaultSyncLock::try_acquire(locks.path(), vault.path()).unwrap();
    }

    #[test]
    fn prevents_concurrent_in_process_acquisition() {
        let vault = tempdir().unwrap();
        let locks = tempdir().unwrap();
        let _held = VaultSyncLock::try_acquire(locks.path(), vault.path()).unwrap();
        let result = VaultSyncLock::try_acquire(locks.path(), vault.path());
        assert!(
            matches!(result, Err(SyncError::LockAlreadyHeld)),
            "expected LockAlreadyHeld, got {:?}",
            result.err()
        );
    }

    #[test]
    fn lock_file_lives_outside_vault() {
        let vault = tempdir().unwrap();
        let locks = tempdir().unwrap();
        let canonical = vault.path().canonicalize().unwrap();
        let lock_path = lock_path_for(locks.path(), &canonical);
        assert!(
            !lock_path.starts_with(vault.path()),
            "lock file {lock_path:?} must not be inside vault {vault:?}"
        );
    }

    #[test]
    fn lock_file_not_visible_to_git_status() {
        use std::process::Command;

        let vault = tempdir().unwrap();
        let locks = tempdir().unwrap();

        // Initialize a minimal git repo so `git status` works.
        Command::new("git")
            .args([
                "-c",
                "init.defaultBranch=main",
                "init",
                vault.path().to_str().unwrap(),
            ])
            .output()
            .unwrap();

        let _lock = VaultSyncLock::try_acquire(locks.path(), vault.path()).unwrap();

        let status = Command::new("git")
            .args(["status", "--porcelain"])
            .current_dir(vault.path())
            .output()
            .unwrap();
        let output = String::from_utf8_lossy(&status.stdout);
        assert!(
            output.trim().is_empty(),
            "vault git status must be clean while lock is held, got: {output}"
        );
    }

    #[test]
    fn lock_path_is_deterministic() {
        let locks = tempdir().unwrap();
        let vault = tempdir().unwrap();
        let canonical = vault.path().canonicalize().unwrap();
        let p1 = lock_path_for(locks.path(), &canonical);
        let p2 = lock_path_for(locks.path(), &canonical);
        assert_eq!(p1, p2);
    }
}

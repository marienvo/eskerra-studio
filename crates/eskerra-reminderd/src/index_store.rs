//! Load / atomically write the per-vault reminder index file. Thin I/O wrapper
//! over `eskerra_reminder_core`'s schema + `write_atomic`.

use std::path::Path;

use eskerra_reminder_core::{write_atomic, IndexParseError, ReminderIndex};

#[derive(Debug)]
pub enum IndexLoadError {
    /// The file does not exist — a normal first-run / rebuilt-from-scratch case.
    NotFound,
    /// IO error reading the file.
    Io(std::io::Error),
    /// File present but unparseable / wrong schema version → fail safe (the
    /// caller rebuilds from a fresh scan; the note text is the source of truth).
    Parse(IndexParseError),
}

/// Load the index at `path`, distinguishing "absent" (normal) from "corrupt"
/// (fail-safe rebuild). Never panics.
pub fn load_index(path: &Path) -> Result<ReminderIndex, IndexLoadError> {
    let text = match std::fs::read_to_string(path) {
        Ok(text) => text,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return Err(IndexLoadError::NotFound)
        }
        Err(err) => return Err(IndexLoadError::Io(err)),
    };
    ReminderIndex::from_json(&text).map_err(IndexLoadError::Parse)
}

/// Atomically write the index (temp + rename), creating the data dir if needed.
pub fn write_index(path: &Path, index: &ReminderIndex) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let json = index
        .to_json_pretty()
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    write_atomic(path, json.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn load_missing_index_is_not_found() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("abc.json");
        assert!(matches!(load_index(&path), Err(IndexLoadError::NotFound)));
    }

    #[test]
    fn write_then_load_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested/abc.json");
        let index = ReminderIndex::new("abc".to_string(), 123, vec![]);
        write_index(&path, &index).unwrap();
        let loaded = load_index(&path).unwrap();
        assert_eq!(loaded, index);
    }

    #[test]
    fn load_corrupt_index_fails_safe_as_parse_error() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("abc.json");
        std::fs::write(&path, b"{ not valid").unwrap();
        assert!(matches!(load_index(&path), Err(IndexLoadError::Parse(_))));
    }
}

//! Real [`WatchControl`] implementation backing the daemon with the shared
//! `eskerra-vault-watch` engine. Kept out of `daemon` so the state machine has
//! no thread/`notify` dependency and stays unit-testable with a fake.

use std::path::Path;
use std::sync::Arc;

use eskerra_vault_watch::VaultWatchEngine;

use crate::daemon::WatchControl;

pub struct EngineWatchControl {
    engine: Arc<VaultWatchEngine>,
}

impl EngineWatchControl {
    pub fn new(engine: Arc<VaultWatchEngine>) -> Self {
        Self { engine }
    }
}

impl WatchControl for EngineWatchControl {
    fn start_watching(&self, root: &Path) -> Result<(), String> {
        self.engine.start_watching(root)
    }

    fn stop(&self) {
        self.engine.stop();
    }
}

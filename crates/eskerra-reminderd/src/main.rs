//! `eskerra-reminderd` entry point. Phase 2: config + watcher + index
//! production (no notifications yet — that is Phase 3). All logic lives in the
//! `eskerra_reminderd` library; this just starts the run loop.

fn main() {
    if let Err(err) = eskerra_reminderd::run::run() {
        eprintln!("[reminderd] fatal: {err}");
        std::process::exit(1);
    }
}

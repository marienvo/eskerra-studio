//! Vault-tree directory/entry exclusion rules, shared by the watcher, the
//! app's vault search/index/frontmatter walkers, and the daemon's scanner.
//!
//! These were originally `pub(crate)` in the app's `vault_search.rs`; they move
//! here so the watcher (and the daemon, which reuses the same "whole vault,
//! every `.md`, excluding hard-excluded / ignored directories" scope from the
//! plan) share exactly one definition. `vault_search.rs` re-exports them so its
//! existing call sites are unchanged.

/// Dot-prefixed only (parity with `vaultVisibility.ts`); `_autosync-backup-*` etc. stay visible.
pub fn is_vault_tree_ignored_entry_name(name: &str) -> bool {
    name.starts_with('.')
}

pub fn is_vault_tree_hard_excluded_directory_name(name: &str) -> bool {
    matches!(name, "Assets" | "Excalidraw" | "Scripts" | "Templates")
}

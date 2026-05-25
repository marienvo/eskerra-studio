# Main window workspace orchestration

[`useMainWindowWorkspace.ts`](../useMainWindowWorkspace.ts) wires vault session, editor, Today hub, tabs, and command facades. Prefer extracted modules for focused logic.

## Danger zone (do not add logic here)

Note-body cache, autosave/save chain, vault watcher reconcile, `lastPersistedRef` mutation — see [`workspacePersistence/ARCHITECTURE.md`](../workspacePersistence/ARCHITECTURE.md) and [`workspaceVaultWatch/ARCHITECTURE.md`](../workspaceVaultWatch/ARCHITECTURE.md).

## Module map

| Area | Location |
|------|----------|
| Inbox persist / autosave | [`workspacePersistence/`](../workspacePersistence/) |
| Vault FS watch | [`workspaceVaultWatch/`](../workspaceVaultWatch/) |
| Open note routing | [`workspaceOpenMarkdownCommand.ts`](../workspaceOpenMarkdownCommand.ts) |
| Tab strip | [`workspaceTabCommands.ts`](../workspaceTabCommands.ts) |
| Vault tree mutations | [`workspaceTreeCommands.ts`](../workspaceTreeCommands.ts) |
| Compose flows | [`workspaceComposeCommands.ts`](../workspaceComposeCommands.ts) |
| FS reconcile bodies | [`workspaceFsWatchReconcile.ts`](../workspaceFsWatchReconcile.ts) |
| Command context memos | [`workspace/useOpenMarkdownCommandContext.ts`](../workspace/useOpenMarkdownCommandContext.ts), [`workspace/useTabComposeTreeCommandContexts.ts`](../workspace/useTabComposeTreeCommandContexts.ts) |
| Imperative ref bridges | [`workspace/useWorkspaceRefBridges.ts`](../workspace/useWorkspaceRefBridges.ts) |
| Shell model JSON (not note save) | [`workspacePersistenceBridge.ts`](../workspacePersistenceBridge.ts) |

ADR baseline: [`specs/adrs/002-adr-main-window-workspace-decompositie.md`](../../../../specs/adrs/002-adr-main-window-workspace-decompositie.md).

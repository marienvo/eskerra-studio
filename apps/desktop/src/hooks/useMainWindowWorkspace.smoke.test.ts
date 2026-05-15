import {describe, expect, it} from 'vitest';

import {mountHydratedMainWindowWorkspace} from './useMainWindowWorkspace.integration.harness';

const REQUIRED_TOP_LEVEL_KEYS = [
  'vaultRoot',
  'vaultSettings',
  'setVaultSettings',
  'settingsName',
  'busy',
  'fsRefreshNonce',
  'podcastFsNonce',
  'deviceInstanceId',
  'selectionController',
  'notificationsState',
  'conflictController',
  'hydrateVault',
  'persistenceController',
  'linkController',
  'treeController',
  'inboxShellRestored',
  'initialVaultHydrateAttemptDone',
  'workspaceShadowModelForTests',
  'tabsController',
  'todayHubController',
  'frontmatterController',
] as const;

const REQUIRED_CONTROLLER_KEYS = {
  selectionController: [
    'notes',
    'selectedUri',
    'editorBody',
    'setEditorBody',
    'inboxEditorResetNonce',
    'composingNewEntry',
    'startNewEntry',
    'cancelNewEntry',
    'selectNote',
    'selectNoteInNewActiveTab',
    'submitNewEntry',
    'inboxContentByUri',
    'vaultMarkdownRefs',
    'selectedNoteBacklinkUris',
    'inboxEditorShellScrollDirectiveRef',
    'inboxBacklinksDeferNonce',
  ] as const,
  notificationsState: [
    'err',
    'setErr',
    'wikiRenameNotice',
    'renameLinkProgress',
    'pendingWikiLinkAmbiguityRename',
    'confirmPendingWikiLinkAmbiguityRename',
    'cancelPendingWikiLinkAmbiguityRename',
  ] as const,
  conflictController: [
    'diskConflict',
    'resolveDiskConflictReloadFromDisk',
    'resolveDiskConflictKeepLocal',
    'diskConflictSoft',
    'elevateDiskConflictSoftToBlocking',
    'dismissDiskConflictSoft',
    'mergeView',
    'closeMergeView',
    'applyFullBackupFromMerge',
    'keepMyEditsFromMerge',
    'enterDiskConflictMergeView',
    'applyMergedBodyFromMerge',
  ] as const,
  persistenceController: [
    'onInboxSaveShortcut',
    'onCleanNoteInbox',
    'flushInboxSave',
    'saveSettledNonce',
  ] as const,
  linkController: [
    'onWikiLinkActivate',
    'onMarkdownRelativeLinkActivate',
    'onMarkdownExternalLinkOpen',
  ] as const,
  treeController: [
    'deleteNote',
    'renameNote',
    'subtreeMarkdownCache',
    'deleteFolder',
    'renameFolder',
    'moveVaultTreeItem',
    'bulkDeleteVaultTreeItems',
    'bulkMoveVaultTreeItems',
    'vaultTreeSelectionClearNonce',
  ] as const,
  tabsController: [
    'editorHistoryCanGoBack',
    'editorHistoryCanGoForward',
    'editorHistoryGoBack',
    'editorHistoryGoForward',
    'editorWorkspaceTabs',
    'activeEditorTabId',
    'activateOpenTab',
    'closeEditorTab',
    'reorderEditorWorkspaceTabs',
    'closeOtherEditorTabs',
    'closeAllEditorTabs',
    'reopenLastClosedEditorTab',
    'canReopenClosedEditorTab',
  ] as const,
  todayHubController: [
    'showTodayHubCanvas',
    'todayHubSettings',
    'todayHubBridgeRef',
    'todayHubWikiNavParentRef',
    'todayHubCellEditorRef',
    'prehydrateTodayHubRows',
    'persistTodayHubRow',
    'todayHubCleanRowBlocked',
    'todayHubSelectorItems',
    'activeTodayHubUri',
    'persistenceActiveTodayHubUri',
    'persistenceTodayHubWorkspaces',
    'legacyTodayHubWorkspacesForSwitch',
    'todayHubWorkspacesForSave',
    'switchTodayHubWorkspace',
    'focusActiveTodayHubNote',
    'openWorkspaceHomeCurrentInBackgroundTab',
    'workspaceSelectShowsActiveTabPill',
  ] as const,
  frontmatterController: [
    'inboxYamlFrontmatterInner',
    'applyFrontmatterInnerChange',
    'syncFrontmatterStateFromDisk',
  ] as const,
} as const;

describe('useMainWindowWorkspace smoke shape', () => {
  it('exposes the expected controller surface without undefined top-level fields', async () => {
    const {result, unmount} = await mountHydratedMainWindowWorkspace({
      dirs: ['/vault'],
    });

    for (const key of REQUIRED_TOP_LEVEL_KEYS) {
      expect(result.current[key]).not.toBeUndefined();
    }

    for (const [controllerKey, nestedKeys] of Object.entries(REQUIRED_CONTROLLER_KEYS)) {
      const controller = result.current[controllerKey as keyof typeof result.current];
      expect(controller).toBeDefined();
      for (const nestedKey of nestedKeys) {
        expect((controller as Record<string, unknown>)[nestedKey]).not.toBeUndefined();
      }
    }

    unmount();
  });
});

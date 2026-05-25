import {useCallback} from 'react';

import type {UseMainWindowWorkspaceResult} from '../../hooks/useMainWindowWorkspace';
import type {useAppPaletteLayerState} from './useAppPaletteLayerState';

export type AppMainWindowWorkspaceBindings = {
  vaultRoot: string;
  vaultSettings: UseMainWindowWorkspaceResult['vaultSettings'];
  setVaultSettings: UseMainWindowWorkspaceResult['setVaultSettings'];
  busy: boolean;
  fsRefreshNonce: number;
  workspace: UseMainWindowWorkspaceResult;
  selectedUri: string | null;
  composeDraftMarkdown: string;
  composingNewEntry: boolean;
  selectNote: (uri: string) => void;
  vaultMarkdownRefs: UseMainWindowWorkspaceResult['selectionController']['vaultMarkdownRefs'];
  flushInboxSave: () => Promise<void>;
  err: string | null;
  diskConflict: UseMainWindowWorkspaceResult['conflictController']['diskConflict'];
  diskConflictSoft: UseMainWindowWorkspaceResult['conflictController']['diskConflictSoft'];
  resolveDiskConflictReloadFromDisk: UseMainWindowWorkspaceResult['conflictController']['resolveDiskConflictReloadFromDisk'];
  resolveDiskConflictKeepLocal: UseMainWindowWorkspaceResult['conflictController']['resolveDiskConflictKeepLocal'];
  elevateDiskConflictSoftToBlocking: UseMainWindowWorkspaceResult['conflictController']['elevateDiskConflictSoftToBlocking'];
  dismissDiskConflictSoft: UseMainWindowWorkspaceResult['conflictController']['dismissDiskConflictSoft'];
  enterDiskConflictMergeView: UseMainWindowWorkspaceResult['conflictController']['enterDiskConflictMergeView'];
  tabsController: UseMainWindowWorkspaceResult['tabsController'];
  todayHub: UseMainWindowWorkspaceResult['todayHubController'];
  persistenceActiveTodayHubUri: string | null;
  persistenceTodayHubWorkspaces: UseMainWindowWorkspaceResult['todayHubController']['persistenceTodayHubWorkspaces'];
  inboxShellRestored: boolean;
};

export function getAppMainWindowWorkspaceBindings(
  workspace: UseMainWindowWorkspaceResult,
): AppMainWindowWorkspaceBindings {
  const {vaultRoot} = workspace;
  if (vaultRoot == null) {
    throw new Error('useAppMainWindowWorkspaceBindings requires an open vault');
  }
  const {
    vaultSettings,
    setVaultSettings,
    busy,
    fsRefreshNonce,
    inboxShellRestored,
    selectionController: {
      selectedUri,
      composeDraftMarkdown,
      composingNewEntry,
      selectNote,
      vaultMarkdownRefs,
    },
    persistenceController: {flushInboxSave},
    notificationsState: {err},
    conflictController: {
      diskConflict,
      resolveDiskConflictReloadFromDisk,
      resolveDiskConflictKeepLocal,
      diskConflictSoft,
      elevateDiskConflictSoftToBlocking,
      dismissDiskConflictSoft,
      enterDiskConflictMergeView,
    },
    tabsController,
    todayHubController: todayHub,
  } = workspace;

  return {
    vaultRoot,
    vaultSettings,
    setVaultSettings,
    busy,
    fsRefreshNonce,
    workspace,
    selectedUri,
    composeDraftMarkdown,
    composingNewEntry,
    selectNote,
    vaultMarkdownRefs,
    flushInboxSave,
    err,
    diskConflict,
    diskConflictSoft,
    resolveDiskConflictReloadFromDisk,
    resolveDiskConflictKeepLocal,
    elevateDiskConflictSoftToBlocking,
    dismissDiskConflictSoft,
    enterDiskConflictMergeView,
    tabsController,
    todayHub,
    persistenceActiveTodayHubUri: todayHub.persistenceActiveTodayHubUri,
    persistenceTodayHubWorkspaces: todayHub.persistenceTodayHubWorkspaces,
    inboxShellRestored,
  };
}

export function useAppTitleBarVaultActions(args: {
  vaultRoot: string | null;
  busy: boolean;
  composingNewEntry: boolean;
  paletteLayer: ReturnType<typeof useAppPaletteLayerState>;
  selectNoteInNewActiveTab: (
    uri: string,
    options?: {insertAfterActive?: boolean},
  ) => void;
  startNewEntry: (draft: string) => void;
  composeDraftMarkdown: string;
}) {
  const {
    vaultRoot,
    busy,
    composingNewEntry,
    paletteLayer,
    selectNoteInNewActiveTab,
    startNewEntry,
    composeDraftMarkdown,
  } = args;

  const openTodayHubInNewTabAfterActive = useCallback(
    (uri: string) => {
      selectNoteInNewActiveTab(uri, {insertAfterActive: true});
    },
    [selectNoteInNewActiveTab],
  );

  const openAddToInbox = useCallback(() => {
    startNewEntry(composeDraftMarkdown);
  }, [composeDraftMarkdown, startNewEntry]);

  const titleBarTabActionsDisabled = !vaultRoot || busy || composingNewEntry;

  const handleTitleBarQuickOpen = useCallback(() => {
    if (!vaultRoot || busy || composingNewEntry) {
      return;
    }
    if (paletteLayer.quickOpenOpen || paletteLayer.vaultSearchOpen) {
      return;
    }
    paletteLayer.setQuickOpenOpen(true);
  }, [vaultRoot, busy, composingNewEntry, paletteLayer]);

  const handleTitleBarAddToInbox = useCallback(() => {
    if (!vaultRoot || busy || composingNewEntry) {
      return;
    }
    if (paletteLayer.quickOpenOpen || paletteLayer.vaultSearchOpen) {
      return;
    }
    startNewEntry(composeDraftMarkdown);
  }, [vaultRoot, busy, composingNewEntry, paletteLayer, composeDraftMarkdown, startNewEntry]);

  return {
    openTodayHubInNewTabAfterActive,
    openAddToInbox,
    titleBarTabActionsDisabled,
    handleTitleBarQuickOpen,
    handleTitleBarAddToInbox,
  };
}

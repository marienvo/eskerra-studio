import {useEffect} from 'react';

import type {EditorWorkspaceTab} from '../lib/editorWorkspaceTabs';
import {
  buildStoredMainWindowInboxForPersist,
  saveMainWindowUi,
  type StoredMainWindowUi,
  type TodayHubWorkspaceSnapshot,
} from '../lib/mainWindowUiStore';

export type UseAppDebouncedPersistMainWindowUiArgs = {
  vaultRoot: string | null;
  inboxShellRestored: boolean;
  vaultPaneVisible: boolean;
  episodesPaneVisible: boolean;
  inboxPaneVisible: boolean;
  notificationsPanelVisible: boolean;
  composingNewEntry: boolean;
  composeDraftMarkdown: string;
  selectedUri: string | null;
  activeTodayHubUri: string | null;
  persistenceTodayHubWorkspaces: Record<string, TodayHubWorkspaceSnapshot>;
  vaultMarkdownRefs: readonly {uri: string; name: string}[];
  editorWorkspaceTabs: readonly EditorWorkspaceTab[];
  activeEditorTabId: string | null;
};

export function useAppDebouncedPersistMainWindowUi({
  vaultRoot,
  inboxShellRestored,
  vaultPaneVisible,
  episodesPaneVisible,
  inboxPaneVisible,
  notificationsPanelVisible,
  composingNewEntry,
  composeDraftMarkdown,
  selectedUri,
  activeTodayHubUri,
  persistenceTodayHubWorkspaces,
  vaultMarkdownRefs,
  editorWorkspaceTabs,
  activeEditorTabId,
}: UseAppDebouncedPersistMainWindowUiArgs) {
  useEffect(() => {
    if (!vaultRoot || !inboxShellRestored) {
      return;
    }
    const inbox = buildStoredMainWindowInboxForPersist({
      composingNewEntry,
      composeDraftMarkdown,
      selectedUri,
      activeTodayHubUri,
      todayHubWorkspaces: persistenceTodayHubWorkspaces,
      vaultMarkdownRefs,
      editorWorkspaceTabs,
      activeEditorTabId,
    });
    const payload: StoredMainWindowUi = {
      vaultRoot,
      vaultPaneVisible,
      episodesPaneVisible,
      inboxPaneVisible,
      notificationsPanelVisible,
      inbox,
    };
    const t = window.setTimeout(() => {
      void saveMainWindowUi(payload);
    }, 200);
    return () => {
      window.clearTimeout(t);
    };
  }, [
    vaultRoot,
    vaultPaneVisible,
    episodesPaneVisible,
    inboxPaneVisible,
    notificationsPanelVisible,
    selectedUri,
    composingNewEntry,
    composeDraftMarkdown,
    activeTodayHubUri,
    persistenceTodayHubWorkspaces,
    inboxShellRestored,
    vaultMarkdownRefs,
    editorWorkspaceTabs,
    activeEditorTabId,
  ]);
}

import {useEffect} from 'react';

import type {EditorWorkspaceTab} from '../lib/editorWorkspaceTabs';
import {
  buildStoredMainWindowInboxForPersist,
  saveMainWindowUi,
  type StoredMainWindowUi,
  type TodayHubWorkspaceSnapshot,
} from '../lib/mainWindowUiStore';
import type {PaneVisibility} from './usePaneVisibility';

export type UseAppDebouncedPersistMainWindowUiArgs = {
  vaultRoot: string | null;
  inboxShellRestored: boolean;
  paneVisibility: PaneVisibility;
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
  paneVisibility,
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
      vaultPaneVisible: paneVisibility.vault,
      episodesPaneVisible: paneVisibility.episodes,
      inboxPaneVisible: paneVisibility.inbox,
      notificationsPanelVisible: paneVisibility.notifications,
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
    paneVisibility,
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

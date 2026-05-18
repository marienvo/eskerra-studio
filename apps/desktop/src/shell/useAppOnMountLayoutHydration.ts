import {
  useEffect,
  type Dispatch,
  type SetStateAction,
} from 'react';

import {hydrateEmojiUsageFromStore} from '../lib/emojiUsageStore';
import {
  loadStoredLayouts,
  type StoredLayouts,
} from '../lib/layout/layoutStore';
import {
  loadMainWindowUi,
  type TodayHubWorkspaceSnapshot,
} from '../lib/mainWindowUiStore';

export type UseAppOnMountLayoutHydrationArgs = {
  setLayouts: Dispatch<SetStateAction<StoredLayouts>>;
  setLayoutsReady: (ready: boolean) => void;
  setVaultPaneVisible: Dispatch<SetStateAction<boolean>>;
  setEpisodesPaneVisible: Dispatch<SetStateAction<boolean>>;
  setInboxPaneVisible: Dispatch<SetStateAction<boolean>>;
  setNotificationsPanelVisible: Dispatch<SetStateAction<boolean>>;
  setRestoredInboxState: Dispatch<
    SetStateAction<{
      vaultRoot: string;
      composingNewEntry: boolean;
      composeDraftMarkdown?: string;
      selectedUri: string | null;
      openTabUris?: readonly string[];
      editorWorkspaceTabs?: ReadonlyArray<{
        id: string;
        entries: string[];
        index: number;
      }>;
      activeEditorTabId?: string | null;
      activeTodayHubUri?: string | null;
      todayHubWorkspaces?: Record<string, TodayHubWorkspaceSnapshot> | null;
    } | null>
  >;
};

export function useAppOnMountLayoutHydration({
  setLayouts,
  setLayoutsReady,
  setVaultPaneVisible,
  setEpisodesPaneVisible,
  setInboxPaneVisible,
  setNotificationsPanelVisible,
  setRestoredInboxState,
}: UseAppOnMountLayoutHydrationArgs) {
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      loadStoredLayouts(),
      loadMainWindowUi(),
      hydrateEmojiUsageFromStore(),
    ]).then(([loadedLayouts, ui]) => {
      if (cancelled) {
        return;
      }
      setLayouts(loadedLayouts);
      if (ui) {
        setVaultPaneVisible(ui.vaultPaneVisible);
        setEpisodesPaneVisible(ui.episodesPaneVisible);
        setInboxPaneVisible(ui.inboxPaneVisible);
        setNotificationsPanelVisible(ui.notificationsPanelVisible);
        setRestoredInboxState({
          vaultRoot: ui.vaultRoot,
          composingNewEntry: ui.inbox.composingNewEntry,
          composeDraftMarkdown: ui.inbox.composeDraftMarkdown,
          selectedUri: ui.inbox.selectedUri,
          openTabUris: ui.inbox.openTabUris,
          editorWorkspaceTabs: ui.inbox.editorWorkspaceTabs,
          activeEditorTabId: ui.inbox.activeEditorTabId ?? null,
          activeTodayHubUri: ui.inbox.activeTodayHubUri ?? null,
          todayHubWorkspaces: ui.inbox.todayHubWorkspaces ?? null,
        });
      }
      setLayoutsReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [
    setLayouts,
    setLayoutsReady,
    setRestoredInboxState,
    setVaultPaneVisible,
    setEpisodesPaneVisible,
    setInboxPaneVisible,
    setNotificationsPanelVisible,
  ]);
}

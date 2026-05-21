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
  type RestoredInboxState,
} from '../lib/mainWindowUiStore';
import type {PaneVisibility} from './usePaneVisibility';

export type UseAppOnMountLayoutHydrationArgs = {
  setLayouts: Dispatch<SetStateAction<StoredLayouts>>;
  setLayoutsReady: (ready: boolean) => void;
  setPaneVisibility: (partial: Partial<PaneVisibility>) => void;
  setRestoredInboxState: Dispatch<SetStateAction<RestoredInboxState | null>>;
};

export function useAppOnMountLayoutHydration({
  setLayouts,
  setLayoutsReady,
  setPaneVisibility,
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
        setPaneVisibility({
          vault: ui.vaultPaneVisible,
          episodes: ui.episodesPaneVisible,
          inbox: ui.inboxPaneVisible,
          notifications: ui.notificationsPanelVisible,
        });
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
    setPaneVisibility,
  ]);
}

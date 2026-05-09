import {useMemo} from 'react';

import type {WindowTitleBarTodayHubSelect} from '../components/WindowTitleBar';

function noteTitleFromUri(uri: string): string {
  const normalized = uri.replace(/\\/g, '/');
  const fileName = normalized.slice(normalized.lastIndexOf('/') + 1);
  return fileName.replace(/\.md$/i, '') || fileName || uri;
}

export function useAppTitleBarTodayHubSelect(
  vaultRoot: string | null,
  todayHubSelectorItems: ReadonlyArray<{
    todayNoteUri: string;
    label: string;
  }>,
  activeTodayHubUri: string | null,
  selectedUri: string | null,
  activeEditorTabId: string | null,
  workspaceSelectShowsActiveTabPill: boolean,
  focusActiveTodayHubNote: () => void,
  switchTodayHubWorkspace: (uri: string) => void | Promise<void>,
  openTodayHubInNewTabAfterActive: (uri: string) => void,
): WindowTitleBarTodayHubSelect {
  return useMemo((): WindowTitleBarTodayHubSelect => {
    if (
      !vaultRoot
      || todayHubSelectorItems.length === 0
      || activeTodayHubUri == null
    ) {
      return null;
    }
    const activeLabel =
      todayHubSelectorItems.find(i => i.todayNoteUri === activeTodayHubUri)
        ?.label ?? 'Today';
    const subLabel =
      activeEditorTabId == null
      && selectedUri != null
      && selectedUri !== activeTodayHubUri
        ? noteTitleFromUri(selectedUri)
        : undefined;
    return {
      items: todayHubSelectorItems,
      activeTodayNoteUri: activeTodayHubUri,
      activeLabel,
      subLabel,
      mainShowsActiveTabPill: workspaceSelectShowsActiveTabPill,
      onMainActivate: focusActiveTodayHubNote,
      onPickHub: (uri: string) => {
        void switchTodayHubWorkspace(uri);
      },
      onOpenHubInNewTab: openTodayHubInNewTabAfterActive,
    };
  }, [
    vaultRoot,
    todayHubSelectorItems,
    activeTodayHubUri,
    selectedUri,
    activeEditorTabId,
    workspaceSelectShowsActiveTabPill,
    focusActiveTodayHubNote,
    switchTodayHubWorkspace,
    openTodayHubInNewTabAfterActive,
  ]);
}

import {useMemo} from 'react';

import type {WindowTitleBarTodayHubSelect} from '../components/WindowTitleBar';

export function useAppTitleBarTodayHubSelect(
  vaultRoot: string | null,
  todayHubSelectorItems: ReadonlyArray<{
    todayNoteUri: string;
    label: string;
  }>,
  activeTodayHubUri: string | null,
  workspaceSelectorSubLabel: string | undefined,
  workspaceSelectShowsActiveTabPill: boolean,
  focusActiveTodayHubNote: () => void,
  switchTodayHubWorkspace: (uri: string) => void | Promise<void>,
  openTodayHubInNewTabAfterActive: (uri: string) => void,
  openWorkspaceHomeCurrentInBackgroundTab: () => void,
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
    return {
      items: todayHubSelectorItems,
      activeTodayNoteUri: activeTodayHubUri,
      activeLabel,
      subLabel: workspaceSelectorSubLabel,
      mainShowsActiveTabPill: workspaceSelectShowsActiveTabPill,
      onMainActivate: focusActiveTodayHubNote,
      onPickHub: (uri: string) => {
        void switchTodayHubWorkspace(uri);
      },
      onOpenHubInNewTab: openTodayHubInNewTabAfterActive,
      onOpenMainWorkspaceInNewTab: openWorkspaceHomeCurrentInBackgroundTab,
    };
  }, [
    vaultRoot,
    todayHubSelectorItems,
    activeTodayHubUri,
    workspaceSelectorSubLabel,
    workspaceSelectShowsActiveTabPill,
    focusActiveTodayHubNote,
    switchTodayHubWorkspace,
    openTodayHubInNewTabAfterActive,
    openWorkspaceHomeCurrentInBackgroundTab,
  ]);
}

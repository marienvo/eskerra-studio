/**
 * Workspace home selector navigation (open home note, background tab).
 */
import {useCallback, type MutableRefObject} from 'react';

import {
  createWorkspaceHomeState,
  homeCurrentUri,
  homeHubUri,
  type WorkspaceHomeState,
} from '../../lib/workspaceHomeNavigation';
import type {TodayHubOpenMarkdown} from './useTodayHubsStateTypes';

export type UseTodayHubHomeNavigationArgs = {
  activeTodayHubUriRef: MutableRefObject<string | null>;
  homeStatesByHubRef: MutableRefObject<Record<string, WorkspaceHomeState>>;
  activeEditorTabIdRef: MutableRefObject<string | null>;
  selectedUriRef: MutableRefObject<string | null>;
  openMarkdownInEditorRef: MutableRefObject<TodayHubOpenMarkdown>;
  mirrorShadowHomeSurface: (reason: string) => void;
  setHomeStateForHub: (hubUri: string, state: WorkspaceHomeState) => void;
};

export function useTodayHubHomeNavigation({
  activeTodayHubUriRef,
  homeStatesByHubRef,
  activeEditorTabIdRef,
  selectedUriRef,
  openMarkdownInEditorRef,
  mirrorShadowHomeSurface,
  setHomeStateForHub,
}: UseTodayHubHomeNavigationArgs) {
  const selectHomeCurrentNote = useCallback(
    async (todayNoteUri: string) => {
      const homeState =
        homeStatesByHubRef.current[todayNoteUri] ??
        createWorkspaceHomeState(todayNoteUri);
      const uri = homeCurrentUri(homeState) ?? todayNoteUri;
      await openMarkdownInEditorRef.current(uri, {home: true, skipHistory: true});
    },
    [homeStatesByHubRef, openMarkdownInEditorRef],
  );

  const activateWorkspaceHomeSelector = useCallback(() => {
    const hub = activeTodayHubUriRef.current;
    if (!hub) {
      return;
    }
    if (activeEditorTabIdRef.current != null) {
      mirrorShadowHomeSurface('workspace selector home surface');
      selectHomeCurrentNote(hub).catch(() => undefined);
      return;
    }
    const home =
      homeStatesByHubRef.current[hub] ?? createWorkspaceHomeState(hub);
    if (home.history.index <= 0) {
      if (selectedUriRef.current == null) {
        selectHomeCurrentNote(hub).catch(() => undefined);
      }
      return;
    }
    const hubTodayUri = home.history.entries[0];
    if (hubTodayUri == null) {
      return;
    }
    const resetHome: WorkspaceHomeState = {
      ...home,
      history: {...home.history, index: 0},
    };
    setHomeStateForHub(hub, resetHome);
    openMarkdownInEditorRef
      .current(hubTodayUri, {home: true, skipHistory: true})
      .catch(() => undefined);
  }, [
    activeEditorTabIdRef,
    activeTodayHubUriRef,
    homeStatesByHubRef,
    mirrorShadowHomeSurface,
    openMarkdownInEditorRef,
    selectHomeCurrentNote,
    selectedUriRef,
    setHomeStateForHub,
  ]);

  const openWorkspaceHomeCurrentInBackgroundTab = useCallback(() => {
    const hub = activeTodayHubUriRef.current;
    if (!hub) {
      return;
    }
    const home =
      homeStatesByHubRef.current[hub] ?? createWorkspaceHomeState(hub);
    const uri = homeHubUri(home) ?? hub;
    openMarkdownInEditorRef
      .current(uri, {
        newTab: true,
        activateNewTab: false,
        insertAfterActive: true,
      })
      .catch(() => undefined);
  }, [activeTodayHubUriRef, homeStatesByHubRef, openMarkdownInEditorRef]);

  return {
    selectHomeCurrentNote,
    activateWorkspaceHomeSelector,
    openWorkspaceHomeCurrentInBackgroundTab,
  };
}

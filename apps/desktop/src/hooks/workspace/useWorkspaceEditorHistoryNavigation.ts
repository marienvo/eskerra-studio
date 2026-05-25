/**
 * Editor back/forward across workspace home history and per-tab note history.
 */
import {
  useCallback,
  useMemo,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';

import type {EditorWorkspaceTab} from '../../lib/editorWorkspaceTabs';
import {clearInboxYamlFrontmatterEditorRefs} from '../../lib/inboxYamlFrontmatterEditor';
import {
  createWorkspaceHomeState,
  type WorkspaceHomeState,
} from '../../lib/workspaceHomeNavigation';
import type {WorkspaceModel} from '../../lib/workspaceModel';
import {
  computeEditorHistoryCanGoBack,
  computeEditorHistoryCanGoForward,
  deriveActiveTabHistorySnapshot,
  moveHomeHistoryBridge,
  openCurrentHomeAfterComposingBridge,
  runEditorHistoryGoBack,
  runEditorHistoryGoForward,
} from '../workspaceEditorHistoryNavigation';
import type {OpenMarkdownInEditorOptions} from '../workspaceOpenMarkdownCommand';

export type UseWorkspaceEditorHistoryNavigationArgs = {
  busy: boolean;
  composingNewEntry: boolean;
  tabsControllerSurface: readonly [readonly EditorWorkspaceTab[], string | null];
  modelActiveEditorTabId: string | null;
  modelActiveTodayHubUri: string | null;
  modelHomeStatesByHub: Record<string, WorkspaceHomeState>;
  activeTodayHubUriRef: MutableRefObject<string | null>;
  activeEditorTabIdRef: MutableRefObject<string | null>;
  homeStatesByHubRef: MutableRefObject<Record<string, WorkspaceHomeState>>;
  editorWorkspaceTabsRef: MutableRefObject<EditorWorkspaceTab[]>;
  composingNewEntryRef: MutableRefObject<boolean>;
  flushInboxSaveRef: MutableRefObject<() => Promise<void>>;
  dispatchWorkspaceActionSync: (
    reason: string,
    reduce: (model: WorkspaceModel) => WorkspaceModel,
  ) => WorkspaceModel;
  openMarkdownInEditor: (
    uri: string,
    options?: OpenMarkdownInEditorOptions,
  ) => Promise<void>;
  setHomeStateForHub: (hubUri: string, state: WorkspaceHomeState) => void;
  setComposingNewEntry: (value: boolean) => void;
  setEditorBody: (value: string) => void;
  setInboxEditorResetNonce: Dispatch<SetStateAction<number>>;
  setEditorWorkspaceTabs: Dispatch<SetStateAction<EditorWorkspaceTab[]>>;
  inboxYamlFrontmatterInnerRef: MutableRefObject<string | null>;
  inboxEditorYamlLeadingBeforeFrontmatterRef: MutableRefObject<string>;
  setInboxYamlFrontmatterInner: (value: string | null) => void;
  setInboxEditorYamlLeadingBeforeFrontmatter: (value: string) => void;
};

export function useWorkspaceEditorHistoryNavigation({
  busy,
  composingNewEntry,
  tabsControllerSurface,
  modelActiveEditorTabId,
  modelActiveTodayHubUri,
  modelHomeStatesByHub,
  activeTodayHubUriRef,
  activeEditorTabIdRef,
  homeStatesByHubRef,
  editorWorkspaceTabsRef,
  composingNewEntryRef,
  flushInboxSaveRef,
  dispatchWorkspaceActionSync,
  openMarkdownInEditor,
  setHomeStateForHub,
  setComposingNewEntry,
  setEditorBody,
  setInboxEditorResetNonce,
  setEditorWorkspaceTabs,
  inboxYamlFrontmatterInnerRef,
  inboxEditorYamlLeadingBeforeFrontmatterRef,
  setInboxYamlFrontmatterInner,
  setInboxEditorYamlLeadingBeforeFrontmatter,
}: UseWorkspaceEditorHistoryNavigationArgs) {
  const activeTabHistory = useMemo(
    () =>
      deriveActiveTabHistorySnapshot({
        editorWorkspaceTabs: tabsControllerSurface[0],
        activeEditorTabId: tabsControllerSurface[1],
      }),
    [tabsControllerSurface],
  );

  const activeHomeState = useMemo(() => {
    if (modelActiveEditorTabId != null || modelActiveTodayHubUri == null) {
      return null;
    }
    return (
      modelHomeStatesByHub[modelActiveTodayHubUri] ??
      createWorkspaceHomeState(modelActiveTodayHubUri)
    );
  }, [modelActiveEditorTabId, modelActiveTodayHubUri, modelHomeStatesByHub]);

  const editorHistoryCanGoBack = useMemo(
    () =>
      computeEditorHistoryCanGoBack({
        composingNewEntry,
        activeHomeState,
        activeTabHistory,
      }),
    [composingNewEntry, activeHomeState, activeTabHistory],
  );

  const editorHistoryCanGoForward = useMemo(
    () =>
      computeEditorHistoryCanGoForward({
        busy,
        composingNewEntry,
        activeHomeState,
        activeTabHistory,
      }),
    [busy, composingNewEntry, activeHomeState, activeTabHistory],
  );

  const openCurrentHomeAfterComposing = useCallback(
    async (state: WorkspaceHomeState): Promise<boolean> =>
      openCurrentHomeAfterComposingBridge(
        {
          setComposingNewEntry,
          clearFrontmatterRefs: () =>
            clearInboxYamlFrontmatterEditorRefs({
              inner: inboxYamlFrontmatterInnerRef,
              leading: inboxEditorYamlLeadingBeforeFrontmatterRef,
              setInner: setInboxYamlFrontmatterInner,
              setLeading: setInboxEditorYamlLeadingBeforeFrontmatter,
            }),
          setEditorBody,
          setInboxEditorResetNonce,
          openMarkdownInEditor,
        },
        state,
      ),
    [
      openMarkdownInEditor,
      setComposingNewEntry,
      setEditorBody,
      setInboxEditorResetNonce,
      inboxYamlFrontmatterInnerRef,
      inboxEditorYamlLeadingBeforeFrontmatterRef,
      setInboxYamlFrontmatterInner,
      setInboxEditorYamlLeadingBeforeFrontmatter,
    ],
  );

  const moveHomeHistory = useCallback(
    async (
      hubUri: string,
      state: WorkspaceHomeState,
      move: (state: WorkspaceHomeState) => WorkspaceHomeState,
    ): Promise<boolean> =>
      moveHomeHistoryBridge({setHomeStateForHub, openMarkdownInEditor}, hubUri, state, move),
    [openMarkdownInEditor, setHomeStateForHub],
  );

  const editorHistoryGoBack = useCallback(() => {
    void runEditorHistoryGoBack({
      activeTodayHubUriRef,
      activeEditorTabIdRef,
      homeStatesByHubRef,
      editorWorkspaceTabsRef,
      composingNewEntryRef,
      flushInboxSave: () => flushInboxSaveRef.current(),
      dispatchWorkspaceActionSync,
      openMarkdownInEditor,
      openCurrentHomeAfterComposing,
      moveHomeHistory,
      setComposingNewEntry,
      setEditorBody,
      setInboxEditorResetNonce,
      setEditorWorkspaceTabs,
      clearFrontmatterRefs: () =>
        clearInboxYamlFrontmatterEditorRefs({
          inner: inboxYamlFrontmatterInnerRef,
          leading: inboxEditorYamlLeadingBeforeFrontmatterRef,
          setInner: setInboxYamlFrontmatterInner,
          setLeading: setInboxEditorYamlLeadingBeforeFrontmatter,
        }),
    });
  }, [
    dispatchWorkspaceActionSync,
    flushInboxSaveRef,
    openMarkdownInEditor,
    openCurrentHomeAfterComposing,
    moveHomeHistory,
    activeTodayHubUriRef,
    activeEditorTabIdRef,
    homeStatesByHubRef,
    editorWorkspaceTabsRef,
    composingNewEntryRef,
    setComposingNewEntry,
    setEditorBody,
    setInboxEditorResetNonce,
    setEditorWorkspaceTabs,
    inboxYamlFrontmatterInnerRef,
    inboxEditorYamlLeadingBeforeFrontmatterRef,
    setInboxYamlFrontmatterInner,
    setInboxEditorYamlLeadingBeforeFrontmatter,
  ]);

  const editorHistoryGoForward = useCallback(() => {
    void runEditorHistoryGoForward({
      activeTodayHubUriRef,
      activeEditorTabIdRef,
      homeStatesByHubRef,
      editorWorkspaceTabsRef,
      composingNewEntryRef,
      flushInboxSave: () => flushInboxSaveRef.current(),
      dispatchWorkspaceActionSync,
      openMarkdownInEditor,
      moveHomeHistory,
      setEditorWorkspaceTabs,
    });
  }, [
    dispatchWorkspaceActionSync,
    flushInboxSaveRef,
    openMarkdownInEditor,
    moveHomeHistory,
    activeTodayHubUriRef,
    activeEditorTabIdRef,
    homeStatesByHubRef,
    editorWorkspaceTabsRef,
    composingNewEntryRef,
    setEditorWorkspaceTabs,
  ]);

  return {
    editorHistoryCanGoBack,
    editorHistoryCanGoForward,
    editorHistoryGoBack,
    editorHistoryGoForward,
  };
}

/**
 * Main-window vault workspace: orchestration hook (Tauri FS, editor tabs, Today hub, wiki rename).
 *
 * Ownership: wire platform I/O and React state here; prefer extracted modules for focused logic
 * (`useTodayHubsState`, `workspaceComposeCommands`, `workspaceTabCommands`, `workspaceOpenMarkdownCommand`,
 * `workspaceTreeCommands`, `workspaceEditorHistoryNavigation`, `workspaceFsWatchReconcile`, `useVaultBootstrap`,
 * `useDiskConflictState`, `useMergeViewState`, `useWorkspacePersistence`, `useInboxBodyCache`, `useNotesListing`,
 * `useInboxShellRestore`, `workspaceInboxShellRestoreBridge`, `workspaceShadowBridge`).
 *
 * Remaining split candidate: final orchestration cleanup.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
} from 'react';

import {
  normalizeVaultBaseUri,
  SubtreeMarkdownPresenceCache,
  trimTrailingSlashes,
  type EskerraSettings,
  type VaultFilesystem,
  type VaultMarkdownRef,
} from '@eskerra/core';

import type {NoteMarkdownEditorHandle} from '../editor/noteEditor/NoteMarkdownEditor';
import {
  createIdleTodayHubWorkspaceBridge,
  type TodayHubSettings,
  type TodayHubWorkspaceBridge,
} from '../lib/todayHub';
import type {EditorWorkspaceTab} from '../lib/editorWorkspaceTabs';
import type {
  RestoredInboxState,
  TodayHubWorkspaceSnapshot,
} from '../lib/mainWindowUiStore';
import {
  createWorkspaceHomeState,
  type WorkspaceHomeState,
} from '../lib/workspaceHomeNavigation';
import {removeUrisAction, normalizeWorkspaceUri, type WorkspaceModel} from '../lib/workspaceModel';
import type {
  WorkspaceConflictController,
  WorkspaceFrontmatterController,
  WorkspaceLinkController,
  WorkspaceNotificationsState,
  WorkspacePersistenceController,
  WorkspaceSelectionController,
  WorkspaceTabsController,
  WorkspaceTodayHubController,
  WorkspaceTreeController,
} from './workspaceReturnShape';
import {
  computeEditorHistoryCanGoBack,
  computeEditorHistoryCanGoForward,
  deriveActiveTabHistorySnapshot,
  moveHomeHistoryBridge,
  openCurrentHomeAfterComposingBridge,
  runEditorHistoryGoBack,
  runEditorHistoryGoForward,
} from './workspaceEditorHistoryNavigation';
import {
  runBulkDeleteVaultTreeItems,
  runBulkMoveVaultTreeItems,
  runDeleteFolder,
  runDeleteNote,
  runMoveVaultTreeItem,
  runRenameFolder,
  type TreeCommandContext,
} from './workspaceTreeCommands';
import {
  replaceRuntimeActiveHub,
  replaceRuntimeActiveSurfaceTab,
  runActivateOpenTab,
  runCloseAllEditorTabs,
  runCloseEditorTab,
  runCloseOtherEditorTabs,
  runReorderEditorWorkspaceTabs,
  runReopenLastClosedEditorTab,
  runRefocusAfterActiveTabRemoved,
  runSelectNote,
  runSelectNoteInNewActiveTab,
  type TabCommandContext,
} from './workspaceTabCommands';
import {useWorkspaceBacklinks} from './workspaceBacklinks';
import {useWorkspaceLinkRouting} from './workspaceLinkRouting';
import {useWorkspacePersistence} from './workspacePersistence';
import {
  useWorkspaceVaultWatchEffects,
} from './workspaceVaultWatchEffects';
import {useVaultBootstrap} from './useVaultBootstrap';
import {useWorkspaceController} from './useWorkspaceController';
import {useDiskConflictState} from './useDiskConflictState';
import {useMergeViewState} from './useMergeViewState';
import {useInboxEditorState} from './useInboxEditorState';
import {useEditorTabsState} from './useEditorTabsState';
import {useNotesListing} from './useNotesListing';
import {useInboxBodyCache} from './useInboxBodyCache';
import {useInboxShellRestore} from './useInboxShellRestore';
import {
  runOpenMarkdownInEditorCommand,
  type OpenMarkdownInEditorOptions,
} from './workspaceOpenMarkdownCommand';
import {
  runCancelNewEntry,
  runCleanNoteInbox,
  runStartNewEntry,
  runSubmitNewEntry,
} from './workspaceComposeCommands';
import {useTodayHubsState, type TodayHubOpenMarkdown} from './useTodayHubsState';
import {
  createWorkspaceShadowMirrorCallbacks,
} from './workspaceShadowBridge';
import type {InboxAutosaveScheduler} from '../lib/inboxAutosaveScheduler';
import {
  clearInboxYamlFrontmatterEditorRefs,
} from '../lib/inboxYamlFrontmatterEditor';
import {useWorkspaceVaultMarkdownRefsScan} from './workspace/useWorkspaceVaultMarkdownRefsScan';
import {useWorkspaceSelectedNoteHydration} from './workspace/useWorkspaceSelectedNoteHydration';
import {useWorkspaceRenameMaintenanceBinding} from './workspace/useWorkspaceRenameMaintenanceBinding';

export type UseMainWindowWorkspaceResult = {
  vaultRoot: string | null;
  vaultSettings: EskerraSettings | null;
  setVaultSettings: Dispatch<SetStateAction<EskerraSettings | null>>;
  settingsName: string;
  busy: boolean;
  fsRefreshNonce: number;
  /** Increments only when files in `General/` change — used to scope podcast catalog rescans. */
  podcastFsNonce: number;
  deviceInstanceId: string;
  selectionController: WorkspaceSelectionController;
  notificationsState: WorkspaceNotificationsState;
  conflictController: WorkspaceConflictController;
  hydrateVault: (root: string) => Promise<void>;
  persistenceController: WorkspacePersistenceController;
  linkController: WorkspaceLinkController;
  treeController: WorkspaceTreeController;
  /** True once persisted inbox shell state has been considered for the current vault. */
  inboxShellRestored: boolean;
  /** True after the first vault bootstrap attempt from persisted session (success, empty, or error). */
  initialVaultHydrateAttemptDone: boolean;
  tabsController: WorkspaceTabsController;
  todayHubController: WorkspaceTodayHubController;
  frontmatterController: WorkspaceFrontmatterController;
  /** Test-only shadow model for the workspaceModel migration bridge. */
  workspaceShadowModelForTests?: WorkspaceModel;
  /**
   * Vitest only: re-run {@link collectVaultMarkdownRefs} (same trigger as `fsRefreshNonce` bump).
   */
  __bumpVaultMarkdownRefsScanForTests?: () => void;
};

export function useMainWindowWorkspace(options: {
  fs: VaultFilesystem;
  inboxEditorRef: RefObject<NoteMarkdownEditorHandle | null>;
  /** `.note-markdown-editor-scroll`: used to snapshot and restore scroll offsets per note URI. */
  inboxEditorShellScrollRef: RefObject<HTMLDivElement | null>;
  restoredInboxState: RestoredInboxState | null;
  inboxRestoreEnabled: boolean;
}): UseMainWindowWorkspaceResult {
  const {
    fs,
    inboxEditorRef,
    inboxEditorShellScrollRef,
    restoredInboxState,
    inboxRestoreEnabled,
  } = options;
  const {
    notes,
    notesRef,
    refreshNotes,
    fsRefreshNonce,
    setFsRefreshNonce,
    podcastFsNonce,
    setPodcastFsNonce,
    vaultTreeSelectionClearNonce,
    setVaultTreeSelectionClearNonce,
  } = useNotesListing({fs});
  const {
    selectedUri,
    setSelectedUri,
    selectedUriRef,
    editorBody,
    setEditorBody,
    editorBodyRef,
    guardedSetEditorBody,
    inboxEditorResetNonce,
    setInboxEditorResetNonce,
    composeDraftMarkdown,
    setComposeDraftMarkdown,
    composeDraftResetNonce,
    setComposeDraftResetNonce,
    lastInboxEditorActivityAtRef,
    skipRecencyDeferForUriRef,
    composingNewEntry,
    setComposingNewEntry,
    composingNewEntryRef,
    inboxYamlFrontmatterInner,
    setInboxYamlFrontmatterInner,
    inboxYamlFrontmatterInnerRef,
    inboxEditorYamlLeadingBeforeFrontmatter,
    setInboxEditorYamlLeadingBeforeFrontmatter,
    inboxEditorYamlLeadingBeforeFrontmatterRef,
    suppressEditorOnChangeRef,
    eagerEditorLoadUriRef,
    editorShellScrollByUriRef,
    inboxEditorShellScrollDirectiveRef,
    syncFrontmatterStateFromDisk,
    applyFrontmatterInnerChange,
    loadFullMarkdownIntoInboxEditor,
    resetInboxEditorComposeState,
    clearInboxSelection: clearInboxSelectionFromInboxState,
  } = useInboxEditorState({
    inboxEditorRef,
  });
  // showTodayHubCanvas derives from selection; see useMemo below.
  const {
    inboxContentByUri,
    setInboxContentByUri,
    inboxContentByUriRef,
    lastPersistedRef,
    lastPersistedExternalMutationSeqRef,
    writeLastPersistedSnapshotWithoutSeqBump,
    bumpLastPersistedExternalMutationSeq,
    setLastPersistedSnapshot,
    clearLastPersistedSnapshot,
  } = useInboxBodyCache();

  const clearInboxSelection = useCallback(() => {
    clearInboxSelectionFromInboxState();
    clearLastPersistedSnapshot();
  }, [clearInboxSelectionFromInboxState, clearLastPersistedSnapshot]);

  const [inboxShellRestored, setInboxShellRestored] = useState(!inboxRestoreEnabled);
  const {
    model: workspaceShadowModel,
    dispatchWorkspaceAction,
    dispatchWorkspaceActionSync,
  } = useWorkspaceController();

  const {
    replaceShadowHomeStateForHub,
    mirrorShadowActiveHub,
    mirrorShadowHomeSurface,
    mirrorShadowActiveTab,
    mirrorShadowActiveWorkspaceTabs,
  } = useMemo(
    () => createWorkspaceShadowMirrorCallbacks(dispatchWorkspaceAction),
    [dispatchWorkspaceAction],
  );

  const subtreeMarkdownCache = useMemo(() => new SubtreeMarkdownPresenceCache(), []);
  const vaultMarkdownRefsRef = useRef<VaultMarkdownRef[]>([]);
  const vaultRootRef = useRef<string | null>(null);
  const showTodayHubCanvasRef = useRef(false);
  const todayHubBridgeRef = useRef<TodayHubWorkspaceBridge>(
    createIdleTodayHubWorkspaceBridge(),
  );
  const todayHubWikiNavParentRef = useRef<string | null>(null);
  const todayHubCellEditorRef = useRef<NoteMarkdownEditorHandle | null>(null);
  const todayHubRowLastPersistedRef = useRef<Map<string, string>>(new Map());
  const todayHubSettingsRef = useRef<TodayHubSettings | null>(null);
  const submitNewEntryRef = useRef<() => Promise<unknown>>(async () => {});
  const openMarkdownInEditorRef = useRef<TodayHubOpenMarkdown>(async () => {});
  const activateOpenTabRef = useRef<(tabId: string) => void>(() => {});
  const selectNoteRef = useRef<(uri: string) => void>(() => {});
  /** Invalidates in-flight `openMarkdownInEditor` work when a newer open supersedes it. */
  const openMarkdownGenerationRef = useRef(0);
  const flushInboxSaveForHydrateRef = useRef<() => Promise<void>>(async () => {});
  const resetRenameMaintenanceStateRef = useRef<() => void>(() => {});
  const resetWorkspaceStateForHydrateRef = useRef<() => void>(() => {});
  const clearBacklinkDiskBodyCacheForHydrateRef = useRef<() => void>(() => {});
  const clearDiskConflictUiForHydrateRef = useRef<() => void>(() => {});
  const clearMergeViewForOpenRef = useRef<() => void>(() => {});

  const {
    vaultRoot,
    vaultSettings,
    setVaultSettings,
    settingsName,
    deviceInstanceId,
    initialVaultHydrateAttemptDone,
    busy,
    setBusy,
    err,
    setErr,
    hydrateVault,
  } = useVaultBootstrap({
    fs,
    inboxRestoreEnabled,
    flushInboxSaveRef: flushInboxSaveForHydrateRef,
    subtreeMarkdownCache,
    resetRenameMaintenanceStateRef,
    clearBacklinkDiskBodyCacheRef: clearBacklinkDiskBodyCacheForHydrateRef,
    refreshNotes,
    resetWorkspaceStateRef: resetWorkspaceStateForHydrateRef,
    clearDiskConflictUiForHydrateRef,
    setInboxShellRestored,
  });

  const {
    editorWorkspaceTabs,
    setEditorWorkspaceTabs,
    editorWorkspaceTabsRef,
    activeEditorTabId,
    setActiveEditorTabId,
    activeEditorTabIdRef,
    editorClosedTabsStackRef,
    bumpEditorClosedStack,
    canReopenClosedEditorTab,
  } = useEditorTabsState({
    vaultRoot,
    notes,
  });

  const replaceEditorWorkspaceTabs = useCallback(
    (nextTabs: EditorWorkspaceTab[]) => {
      editorWorkspaceTabsRef.current = nextTabs;
      setEditorWorkspaceTabs(nextTabs);
    },
    [editorWorkspaceTabsRef, setEditorWorkspaceTabs],
  );

  useLayoutEffect(() => {
    vaultRootRef.current = vaultRoot;
  }, [vaultRoot]);

  const {
    vaultMarkdownRefs,
    vaultMarkdownRefsReady,
  } = useWorkspaceVaultMarkdownRefsScan({
    vaultRoot,
    fs,
    fsRefreshNonce,
    vaultMarkdownRefsRef,
  });

  const {
    selectedNoteBacklinkUris,
    inboxBacklinksDeferNonce,
    backlinksActiveBodyRef,
    setBacklinksActiveBody,
    scheduleBacklinksDeferOneFrameAfterLoad,
    clearInboxBacklinksDeferAfterLoad,
    clearBacklinkDiskBodyCache,
  } = useWorkspaceBacklinks({
    fs,
    vaultRoot,
    composingNewEntry,
    selectedUri,
    vaultMarkdownRefs,
    inboxContentByUri,
    selectedUriRef,
    vaultMarkdownRefsRef,
    inboxContentByUriRef,
  });

  useLayoutEffect(() => {
    clearBacklinkDiskBodyCacheForHydrateRef.current = clearBacklinkDiskBodyCache;
  }, [clearBacklinkDiskBodyCache]);

  /** Filled in layout after {@link useWorkspacePersistence}; stable identity for sub-hooks' `useCallback` deps. */
  const autosaveSchedulerTargetRef = useRef<MutableRefObject<InboxAutosaveScheduler> | null>(null);
  const cancelAutosave = useCallback(() => {
    autosaveSchedulerTargetRef.current?.current.cancel();
  }, []);

  const {
    diskConflict,
    setDiskConflict,
    diskConflictRef,
    diskConflictSoft,
    setDiskConflictSoft,
    diskConflictSoftRef,
    diskConflictDeferTimerRef,
    clearDiskConflictUiForHydrate,
    resolveDiskConflictReloadFromDisk,
    resolveDiskConflictKeepLocal,
    elevateDiskConflictSoftToBlocking,
    clearBlockingDiskConflictForMergedBody,
    dismissDiskConflictSoft,
    clearStaleDiskConflictsForOpen,
  } = useDiskConflictState({
    loadFullMarkdownIntoInboxEditor,
    scheduleBacklinksDeferOneFrameAfterLoad,
    cancelAutosave,
    selectedUriRef,
    setLastPersistedSnapshot,
    inboxContentByUriRef,
    skipRecencyDeferForUriRef,
    setInboxContentByUri,
    setErr,
  });

  useLayoutEffect(() => {
    clearDiskConflictUiForHydrateRef.current = clearDiskConflictUiForHydrate;
  }, [clearDiskConflictUiForHydrate]);

  const [vaultWriteSettledNonce, setVaultWriteSettledNonce] = useState(0);
  const markVaultWriteSettled = useCallback(() => {
    setVaultWriteSettledNonce(n => n + 1);
  }, []);

  const {
    saveChainRef,
    saveActiveRef,
    autosaveSchedulerRef,
    flushInboxSaveRef: workspacePersistenceFlushInboxSaveRef,
    mergeInboxNoteBodyCacheRefAndState,
    enqueuePersistOutgoingNoteMarkdown,
    flushInboxSave,
    onInboxSaveShortcut,
  } = useWorkspacePersistence({
    fs,
    vaultRoot,
    selectedUri,
    composingNewEntry,
    editorBody,
    inboxYamlFrontmatterInner,
    diskConflict,
    vaultRootRef,
    selectedUriRef,
    composingNewEntryRef,
    diskConflictRef,
    inboxContentByUriRef,
    editorBodyRef,
    lastPersistedRef,
    setLastPersistedSnapshot,
    inboxYamlFrontmatterInnerRef,
    inboxEditorYamlLeadingBeforeFrontmatterRef,
    inboxEditorRef,
    todayHubBridgeRef,
    submitNewEntryRef,
    setErr,
    setInboxContentByUri,
    refreshNotes,
    onVaultWriteSettled: markVaultWriteSettled,
    loadFullMarkdownIntoInboxEditor,
    scheduleBacklinksDeferOneFrameAfterLoad,
  });

  useLayoutEffect(() => {
    autosaveSchedulerTargetRef.current = autosaveSchedulerRef;
    flushInboxSaveForHydrateRef.current = workspacePersistenceFlushInboxSaveRef.current;
  }, [autosaveSchedulerRef, workspacePersistenceFlushInboxSaveRef]);
  const flushInboxSaveRef = workspacePersistenceFlushInboxSaveRef;

  const {
    activeTodayHubUriRef,
    setActiveTodayHubUri,
    homeStatesByHubRef,
    replaceHomeStatesByHub,
    modelActiveTodayHubUri,
    modelActiveEditorTabId,
    modelHomeStatesByHub,
    modelDerivedPersistence,
    todayHubWorkspacesForSwitch,
    tabsControllerSurface,
    showTodayHubCanvas,
    todayHubSettings,
    todayHubSelectorItems,
    workspaceSelectShowsActiveTabPill,
    workspaceSelectorSubLabel,
    projectHomeStatesFromModel,
    remapHomeStatesPrefix,
    removeHomeHistoryUris,
    setHomeStateForHub,
    pushHomeHistoryForHub,
    prehydrateTodayHubRows,
    persistTodayHubRow,
    todayHubCleanRowBlocked,
    syncShadowWorkspaceFromShellRestore,
    switchTodayHubWorkspace,
    focusActiveTodayHubNote,
    selectHomeCurrentNote,
    openWorkspaceHomeCurrentInBackgroundTab,
  } = useTodayHubsState({
    fs,
    vaultRoot,
    selectedUri,
    editorBody,
    composingNewEntry,
    inboxYamlFrontmatterInner,
    inboxEditorYamlLeadingBeforeFrontmatter,
    notes,
    vaultMarkdownRefs,
    vaultMarkdownRefsReady,
    inboxShellRestored,
    workspaceShadowModel,
    dispatchWorkspaceActionSync,
    replaceShadowHomeStateForHub,
    mirrorShadowActiveHub,
    mirrorShadowHomeSurface,
    mirrorShadowActiveTab,
    mirrorShadowActiveWorkspaceTabs,
    vaultRootRef,
    showTodayHubCanvasRef,
    todayHubBridgeRef,
    todayHubWikiNavParentRef,
    todayHubCellEditorRef,
    todayHubRowLastPersistedRef,
    todayHubSettingsRef,
    vaultMarkdownRefsRef,
    selectedUriRef,
    composingNewEntryRef,
    inboxYamlFrontmatterInnerRef,
    inboxEditorYamlLeadingBeforeFrontmatterRef,
    editorWorkspaceTabs,
    activeEditorTabId,
    editorWorkspaceTabsRef,
    activeEditorTabIdRef,
    replaceEditorWorkspaceTabs,
    setEditorWorkspaceTabs,
    setActiveEditorTabId,
    setComposingNewEntry,
    setInboxYamlFrontmatterInner,
    setInboxEditorYamlLeadingBeforeFrontmatter,
    setEditorBody,
    setInboxEditorResetNonce,
    flushInboxSaveRef,
    saveChainRef,
    saveActiveRef,
    inboxContentByUriRef,
    setInboxContentByUri,
    refreshNotes,
    setFsRefreshNonce,
    setErr,
    markVaultWriteSettled,
    subtreeMarkdownCache,
    diskConflictRef,
    openMarkdownInEditorRef,
    activateOpenTabRef,
    selectNoteRef,
  });

  const {
    wikiRenameNotice,
    renameLinkProgress,
    pendingWikiLinkAmbiguityRename,
    renameNote,
    confirmPendingWikiLinkAmbiguityRename,
    cancelPendingWikiLinkAmbiguityRename,
    clearRenameNotice,
    resetRenameMaintenanceState,
  } = useWorkspaceRenameMaintenanceBinding({
    vaultRoot,
    fs,
    autosaveSchedulerRef,
    flushInboxSaveRef,
    refreshNotes,
    subtreeMarkdownCache,
    setBusy,
    setErr,
    setFsRefreshNonce,
    vaultMarkdownRefsRef,
    selectedUriRef,
    inboxEditorRef,
    editorBodyRef,
    composingNewEntryRef,
    inboxYamlFrontmatterInnerRef,
    inboxEditorYamlLeadingBeforeFrontmatterRef,
    inboxContentByUriRef,
    setInboxContentByUri,
    lastPersistedRef,
    setLastPersistedSnapshot,
    setSelectedUri,
    editorShellScrollByUriRef,
    editorWorkspaceTabsRef,
    replaceEditorWorkspaceTabs,
    remapHomeStatesPrefix,
  });

  const openMarkdownCommandContext = useMemo(
    () => ({
      fs,
      openMarkdownGenerationRef,
      clearMergeViewForOpenRef,
      autosaveSchedulerRef,
      todayHubBridgeRef,
      diskConflictDeferTimerRef,
      inboxEditorShellScrollRef,
      selectedUriRef,
      composingNewEntryRef,
      editorShellScrollByUriRef,
      inboxEditorShellScrollDirectiveRef,
      clearStaleDiskConflictsForOpen,
      vaultRootRef,
      inboxContentByUriRef,
      lastPersistedRef,
      setLastPersistedSnapshot,
      eagerEditorLoadUriRef,
      backlinksActiveBodyRef,
      loadFullMarkdownIntoInboxEditor,
      scheduleBacklinksDeferOneFrameAfterLoad,
      setInboxContentByUri,
      setBacklinksActiveBody,
      setComposingNewEntry,
      setSelectedUri,
      inboxEditorRef,
      editorBodyRef,
      inboxYamlFrontmatterInnerRef,
      inboxEditorYamlLeadingBeforeFrontmatterRef,
      mergeInboxNoteBodyCacheRefAndState,
      enqueuePersistOutgoingNoteMarkdown,
      setErr,
      dispatchWorkspaceActionSync,
      mirrorShadowActiveWorkspaceTabs,
      mirrorShadowHomeSurface,
      mirrorShadowActiveTab,
      editorWorkspaceTabsRef,
      activeEditorTabIdRef,
      activeTodayHubUriRef,
      setEditorWorkspaceTabs,
      setActiveEditorTabId,
      pushHomeHistoryForHub,
    }),
    [
      fs,
      autosaveSchedulerRef,
      clearStaleDiskConflictsForOpen,
      loadFullMarkdownIntoInboxEditor,
      scheduleBacklinksDeferOneFrameAfterLoad,
      setBacklinksActiveBody,
      setErr,
      dispatchWorkspaceActionSync,
      mirrorShadowActiveWorkspaceTabs,
      mirrorShadowHomeSurface,
      mirrorShadowActiveTab,
      setEditorWorkspaceTabs,
      setActiveEditorTabId,
      pushHomeHistoryForHub,
      mergeInboxNoteBodyCacheRefAndState,
      enqueuePersistOutgoingNoteMarkdown,
      setComposingNewEntry,
      setSelectedUri,
      inboxEditorRef,
      setLastPersistedSnapshot,
    ],
  );

  const openMarkdownInEditor = useCallback(
    async (
      uri: string,
      options?: OpenMarkdownInEditorOptions,
    ) => {
      await runOpenMarkdownInEditorCommand(openMarkdownCommandContext, uri, options);
    },
    [openMarkdownCommandContext],
  );

  useLayoutEffect(() => {
    openMarkdownInEditorRef.current = openMarkdownInEditor;
  }, [openMarkdownInEditor]);

  const {
    mergeView,
    closeMergeView,
    tryEnterBackupMergeView,
    applyFullBackupFromMerge,
    keepMyEditsFromMerge,
    enterDiskConflictMergeView,
    applyMergedBodyFromMerge,
  } = useMergeViewState({
    fs,
    openMarkdownInEditor,
    selectedUriRef,
    composingNewEntryRef,
    showTodayHubCanvasRef,
    todayHubWikiNavParentRef,
    diskConflictRef,
    diskConflictSoftRef,
    resolveDiskConflictReloadFromDisk,
    resolveDiskConflictKeepLocal,
    elevateDiskConflictSoftToBlocking,
    clearBlockingDiskConflictForMergedBody,
    setErr,
    inboxEditorRef,
    loadFullMarkdownIntoInboxEditor,
    editorBodyRef,
    setEditorBody,
    suppressEditorOnChangeRef,
    inboxYamlFrontmatterInnerRef,
    inboxEditorYamlLeadingBeforeFrontmatterRef,
    inboxContentByUriRef,
    setInboxContentByUri,
    backlinksActiveBodyRef,
    setBacklinksActiveBody,
    enqueuePersistOutgoingNoteMarkdown,
    scheduleBacklinksDeferOneFrameAfterLoad,
  });

  useLayoutEffect(() => {
    clearMergeViewForOpenRef.current = closeMergeView;
  }, [closeMergeView]);

  const tabCommandContext: TabCommandContext = useMemo(
    () => ({
      busy,
      refs: {
        editorWorkspaceTabsRef,
        activeEditorTabIdRef,
        selectedUriRef,
        composingNewEntryRef,
        activeTodayHubUriRef,
        flushInboxSaveRef,
        saveChainRef,
        vaultRootRef,
        notesRef,
        editorClosedTabsStackRef,
        editorShellScrollByUriRef,
        inboxYamlFrontmatterInnerRef,
        inboxEditorYamlLeadingBeforeFrontmatterRef,
      },
      callbacks: {
        bumpEditorClosedStack,
        dispatchWorkspaceActionSync,
        replaceEditorWorkspaceTabs,
        mirrorShadowActiveTab,
        mirrorShadowHomeSurface,
        openMarkdownInEditor,
        selectHomeCurrentNote,
        clearInboxSelection,
      },
      setters: {
        setActiveEditorTabId,
        setSelectedUri,
        setComposingNewEntry,
        setEditorBody,
        setInboxYamlFrontmatterInner,
        setInboxEditorYamlLeadingBeforeFrontmatter,
        setInboxEditorResetNonce,
        clearLastPersistedSnapshot,
      },
    }),
    [
      busy,
      bumpEditorClosedStack,
      dispatchWorkspaceActionSync,
      replaceEditorWorkspaceTabs,
      mirrorShadowActiveTab,
      mirrorShadowHomeSurface,
      openMarkdownInEditor,
      selectHomeCurrentNote,
      clearInboxSelection,
      setActiveEditorTabId,
      setSelectedUri,
      setComposingNewEntry,
      setEditorBody,
      setInboxYamlFrontmatterInner,
      setInboxEditorYamlLeadingBeforeFrontmatter,
      setInboxEditorResetNonce,
      clearLastPersistedSnapshot,
    ],
  );

  const activateOpenTab = useCallback(
    (tabId: string) => {
      runActivateOpenTab(tabCommandContext, tabId);
    },
    [tabCommandContext],
  );

  useLayoutEffect(() => {
    activateOpenTabRef.current = activateOpenTab;
  }, [activateOpenTab]);

  const reorderEditorWorkspaceTabs = useCallback(
    (fromIndex: number, insertBeforeIndex: number) => {
      runReorderEditorWorkspaceTabs(tabCommandContext, fromIndex, insertBeforeIndex);
    },
    [tabCommandContext],
  );

  const closeEditorTab = useCallback(
    (tabId: string) => {
      runCloseEditorTab(tabCommandContext, tabId);
    },
    [tabCommandContext],
  );

  const closeOtherEditorTabs = useCallback(
    (keepTabId: string) => {
      runCloseOtherEditorTabs(tabCommandContext, keepTabId);
    },
    [tabCommandContext],
  );

  const closeAllEditorTabs = useCallback(() => {
    runCloseAllEditorTabs(tabCommandContext);
  }, [tabCommandContext]);

  const reopenLastClosedEditorTab = useCallback(() => {
    runReopenLastClosedEditorTab(tabCommandContext);
  }, [tabCommandContext]);

  const resetWorkspaceStateForHydrate = useCallback(() => {
    editorShellScrollByUriRef.current = new Map();
    inboxEditorShellScrollDirectiveRef.current = null;
    setDiskConflict(null);
    diskConflictRef.current = null;
    setDiskConflictSoft(null);
    diskConflictSoftRef.current = null;
    replaceEditorWorkspaceTabs([]);
    replaceRuntimeActiveSurfaceTab(
      null,
      activeEditorTabIdRef,
      setActiveEditorTabId,
    );
    replaceRuntimeActiveHub(null, activeTodayHubUriRef, setActiveTodayHubUri);
    mirrorShadowActiveHub(null, 'hydrate reset active hub');
    editorClosedTabsStackRef.current = [];
    bumpEditorClosedStack();
    setSelectedUri(null);
    setComposingNewEntry(false);
    closeMergeView();
    clearInboxYamlFrontmatterEditorRefs({
      inner: inboxYamlFrontmatterInnerRef,
      leading: inboxEditorYamlLeadingBeforeFrontmatterRef,
      setInner: setInboxYamlFrontmatterInner,
      setLeading: setInboxEditorYamlLeadingBeforeFrontmatter,
    });
    setEditorBody('');
    clearLastPersistedSnapshot();
    setInboxEditorResetNonce(n => n + 1);
  }, [bumpEditorClosedStack, clearLastPersistedSnapshot, closeMergeView, mirrorShadowActiveHub]);

  useLayoutEffect(() => {
    resetWorkspaceStateForHydrateRef.current = resetWorkspaceStateForHydrate;
  }, [resetWorkspaceStateForHydrate]);

  useLayoutEffect(() => {
    resetRenameMaintenanceStateRef.current = resetRenameMaintenanceState;
  }, [resetRenameMaintenanceState]);

  const syncWorkspaceModelRemoveOpenTabUri = useCallback(
    (markdownUri: string) => {
      const target = normalizeWorkspaceUri(markdownUri);
      const nextModel = dispatchWorkspaceActionSync(
        'vault watch removed open note',
        m => removeUrisAction(m, u => u === target),
      );
      projectHomeStatesFromModel(nextModel);
    },
    [dispatchWorkspaceActionSync, projectHomeStatesFromModel],
  );

  useWorkspaceVaultWatchEffects({
    vaultRoot,
    fs,
    refreshNotes,
    inboxEditorRef,
    openMarkdownInEditor,
    loadFullMarkdownIntoInboxEditor,
    scheduleBacklinksDeferOneFrameAfterLoad,
    clearBacklinkDiskBodyCache,
    subtreeMarkdownCache,
    vaultRootRef,
    editorWorkspaceTabsRef,
    selectedUriRef,
    activeEditorTabIdRef,
    composingNewEntryRef,
    diskConflictRef,
    diskConflictSoftRef,
    inboxContentByUriRef,
    lastPersistedRef,
    lastPersistedExternalMutationSeqRef,
    writeLastPersistedSnapshotWithoutSeqBump,
    bumpLastPersistedExternalMutationSeq,
    editorBodyRef,
    inboxYamlFrontmatterInnerRef,
    inboxEditorYamlLeadingBeforeFrontmatterRef,
    editorShellScrollByUriRef,
    skipRecencyDeferForUriRef,
    diskConflictDeferTimerRef,
    lastInboxEditorActivityAtRef,
    autosaveSchedulerRef,
    todayHubRowLastPersistedRef,
    todayHubSettingsRef,
    todayHubBridgeRef,
    setEditorWorkspaceTabs,
    setActiveEditorTabId,
    setDiskConflict,
    setDiskConflictSoft,
    setInboxContentByUri,
    setSelectedUri,
    setComposingNewEntry,
    setEditorBody,
    setInboxEditorResetNonce,
    setInboxYamlFrontmatterInner,
    setInboxEditorYamlLeadingBeforeFrontmatter,
    setFsRefreshNonce,
    setPodcastFsNonce,
    setVaultSettings,
    syncWorkspaceModelRemoveOpenTabUri,
  });

  useWorkspaceSelectedNoteHydration({
    vaultRoot,
    selectedUri,
    composingNewEntry,
    editorBody,
    inboxYamlFrontmatterInner,
    fs,
    inboxEditorRef,
    eagerEditorLoadUriRef,
    inboxContentByUriRef,
    lastPersistedRef,
    setInboxContentByUri,
    setLastPersistedSnapshot,
    clearLastPersistedSnapshot,
    loadFullMarkdownIntoInboxEditor,
    scheduleBacklinksDeferOneFrameAfterLoad,
    clearInboxBacklinksDeferAfterLoad,
    inboxYamlFrontmatterInnerRef,
    inboxEditorYamlLeadingBeforeFrontmatterRef,
    setInboxYamlFrontmatterInner,
    setInboxEditorYamlLeadingBeforeFrontmatter,
    setEditorBody,
    backlinksActiveBodyRef,
    setBacklinksActiveBody,
    composingNewEntryRef,
    editorBodyRef,
    setErr,
  });

  const composeCommandsContext = useMemo(
    () => ({
      fs,
      vaultRoot,
      subtreeMarkdownCache,
      markVaultWriteSettled,
      refreshNotes,
      flushInboxSave: () => flushInboxSaveRef.current(),
      scheduleBacklinksDeferOneFrameAfterLoad,
      loadFullMarkdownIntoInboxEditor,
      resetInboxEditorComposeState,
      todayHubCleanRowBlocked,
      showTodayHubCanvasRef,
      todayHubBridgeRef,
      inboxEditorRef,
      refs: {
        selectedUriRef,
        composingNewEntryRef,
        inboxEditorShellScrollDirectiveRef,
        diskConflictRef,
        diskConflictSoftRef,
        lastPersistedRef,
        editorBodyRef,
        inboxYamlFrontmatterInnerRef,
        inboxEditorYamlLeadingBeforeFrontmatterRef,
        inboxContentByUriRef,
      },
      setters: {
        setBusy,
        setErr,
        setFsRefreshNonce,
        setEditorBody,
        setComposeDraftMarkdown,
        setComposeDraftResetNonce,
        setComposingNewEntry,
        setSelectedUri,
        setDiskConflict,
        setDiskConflictSoft,
        setInboxContentByUri,
        clearLastPersistedSnapshot,
      },
      openMarkdownInEditor: (uri: string) => openMarkdownInEditor(uri),
    }),
    [
      fs,
      vaultRoot,
      subtreeMarkdownCache,
      markVaultWriteSettled,
      refreshNotes,
      flushInboxSaveRef,
      scheduleBacklinksDeferOneFrameAfterLoad,
      loadFullMarkdownIntoInboxEditor,
      resetInboxEditorComposeState,
      todayHubCleanRowBlocked,
      showTodayHubCanvasRef,
      todayHubBridgeRef,
      inboxEditorRef,
      selectedUriRef,
      composingNewEntryRef,
      inboxEditorShellScrollDirectiveRef,
      diskConflictRef,
      diskConflictSoftRef,
      lastPersistedRef,
      editorBodyRef,
      inboxYamlFrontmatterInnerRef,
      inboxEditorYamlLeadingBeforeFrontmatterRef,
      inboxContentByUriRef,
      setBusy,
      setErr,
      setFsRefreshNonce,
      setEditorBody,
      setComposeDraftMarkdown,
      setComposeDraftResetNonce,
      setComposingNewEntry,
      setSelectedUri,
      setDiskConflict,
      setDiskConflictSoft,
      setInboxContentByUri,
      clearLastPersistedSnapshot,
      openMarkdownInEditor,
    ],
  );

  const startNewEntry = useCallback((draftMarkdown?: string) => {
    runStartNewEntry(composeCommandsContext, draftMarkdown);
  }, [composeCommandsContext]);

  const cancelNewEntry = useCallback(() => {
    runCancelNewEntry(composeCommandsContext);
  }, [composeCommandsContext]);

  /** Pick where to refocus after the active tab is closed: surviving tab → workspace shell hub → empty. */
  const refocusAfterActiveTabRemoved = useCallback(
    (
      closedNorm: string,
      nextTabs: readonly EditorWorkspaceTab[],
      nextActive: string | null,
      options?: {wasOnHomeNoActiveTab?: boolean},
    ) =>
      runRefocusAfterActiveTabRemoved(tabCommandContext, closedNorm, nextTabs, nextActive, options),
    [tabCommandContext],
  );

  const treeCommandContext = useMemo((): TreeCommandContext => {
    return {
      vaultRoot,
      fs,
      subtreeMarkdownCache,
      refs: {
        autosaveSchedulerRef,
        saveChainRef,
        editorWorkspaceTabsRef,
        activeEditorTabIdRef,
        selectedUriRef,
        composingNewEntryRef,
        editorShellScrollByUriRef,
        inboxYamlFrontmatterInnerRef,
        inboxEditorYamlLeadingBeforeFrontmatterRef,
        lastPersistedRef,
      },
      setters: {
        setEditorWorkspaceTabs,
        setActiveEditorTabId,
        setInboxContentByUri,
        setBusy,
        setErr,
        setFsRefreshNonce,
        setSelectedUri,
        setComposingNewEntry,
        setEditorBody,
        setInboxYamlFrontmatterInner,
        setInboxEditorYamlLeadingBeforeFrontmatter,
        setInboxEditorResetNonce,
        setLastPersistedSnapshot,
        clearLastPersistedSnapshot,
      },
      mirrorShadowHomeSurface,
      mirrorShadowActiveTab,
      removeHomeHistoryUris,
      markVaultWriteSettled,
      refreshNotes,
      refocusAfterActiveTabRemoved,
      openMarkdownInEditor,
      flushInboxSaveRef,
      clearRenameNotice,
      replaceEditorWorkspaceTabs,
      remapHomeStatesPrefix,
      clearInboxSelection,
      setVaultTreeSelectionClearNonce,
    };
  }, [
    vaultRoot,
    fs,
    subtreeMarkdownCache,
    setEditorWorkspaceTabs,
    setActiveEditorTabId,
    setInboxContentByUri,
    setBusy,
    setErr,
    setFsRefreshNonce,
    setSelectedUri,
    setComposingNewEntry,
    setEditorBody,
    setInboxYamlFrontmatterInner,
    setInboxEditorYamlLeadingBeforeFrontmatter,
    setInboxEditorResetNonce,
    setLastPersistedSnapshot,
    clearLastPersistedSnapshot,
    mirrorShadowHomeSurface,
    mirrorShadowActiveTab,
    removeHomeHistoryUris,
    markVaultWriteSettled,
    refreshNotes,
    refocusAfterActiveTabRemoved,
    openMarkdownInEditor,
    flushInboxSaveRef,
    clearRenameNotice,
    replaceEditorWorkspaceTabs,
    remapHomeStatesPrefix,
    clearInboxSelection,
    setVaultTreeSelectionClearNonce,
  ]);

  const selectNote = useCallback(
    (uri: string) => {
      runSelectNote(tabCommandContext, uri);
    },
    [tabCommandContext],
  );

  useLayoutEffect(() => {
    selectNoteRef.current = selectNote;
  }, [selectNote]);

  const selectNoteInNewActiveTab = useCallback(
    (uri: string, opts?: {insertAfterActive?: boolean}) => {
      runSelectNoteInNewActiveTab(tabCommandContext, uri, opts);
    },
    [tabCommandContext],
  );

  const submitNewEntry = useCallback((liveComposeMarkdown?: string) =>
    runSubmitNewEntry(composeCommandsContext, composeDraftMarkdown, liveComposeMarkdown),
  [composeCommandsContext, composeDraftMarkdown]);

  useLayoutEffect(() => {
    submitNewEntryRef.current = submitNewEntry;
  }, [submitNewEntry]);

  const onCleanNoteInbox = useCallback(() => {
    runCleanNoteInbox(composeCommandsContext);
  }, [composeCommandsContext]);

  const deleteNote = useCallback(
    (uri: string) => runDeleteNote(treeCommandContext, uri),
    [treeCommandContext],
  );

  const linkController = useWorkspaceLinkRouting({
    vaultRoot,
    fs,
    flushInboxSaveRef,
    vaultMarkdownRefsRef,
    selectedUriRef,
    composingNewEntryRef,
    showTodayHubCanvasRef,
    todayHubWikiNavParentRef,
    todayHubCellEditorRef,
    activeTodayHubUriRef,
    activeEditorTabIdRef,
    editorWorkspaceTabsRef,
    inboxEditorRef,
    openMarkdownInEditor,
    activateOpenTab,
    tryEnterBackupMergeView,
    refreshNotes,
    setErr,
    setFsRefreshNonce,
    subtreeMarkdownCache,
  });

  const deleteFolder = useCallback(
    (directoryUri: string) => runDeleteFolder(treeCommandContext, directoryUri),
    [treeCommandContext],
  );

  const renameFolder = useCallback(
    (directoryUri: string, nextDisplayName: string) =>
      runRenameFolder(treeCommandContext, directoryUri, nextDisplayName),
    [treeCommandContext],
  );

  const moveVaultTreeItem = useCallback(
    (sourceUri: string, sourceKind: 'folder' | 'article', targetDirectoryUri: string) =>
      runMoveVaultTreeItem(treeCommandContext, sourceUri, sourceKind, targetDirectoryUri),
    [treeCommandContext],
  );

  const bulkDeleteVaultTreeItems = useCallback(
    (items: Parameters<typeof runBulkDeleteVaultTreeItems>[1]) =>
      runBulkDeleteVaultTreeItems(treeCommandContext, items),
    [treeCommandContext],
  );

  const bulkMoveVaultTreeItems = useCallback(
    (items: Parameters<typeof runBulkMoveVaultTreeItems>[1], targetDirectoryUri: string) =>
      runBulkMoveVaultTreeItems(treeCommandContext, items, targetDirectoryUri),
    [treeCommandContext],
  );

  const activeTabHistory = useMemo(
    () =>
      deriveActiveTabHistorySnapshot({
        editorWorkspaceTabs: tabsControllerSurface[0],
        activeEditorTabId: tabsControllerSurface[1],
      }),
    [tabsControllerSurface],
  );

  const activeHomeState = useMemo(
    () => {
      if (modelActiveEditorTabId != null || modelActiveTodayHubUri == null) {
        return null;
      }
      return (
        modelHomeStatesByHub[modelActiveTodayHubUri] ??
        createWorkspaceHomeState(modelActiveTodayHubUri)
      );
    },
    [modelActiveEditorTabId, modelActiveTodayHubUri, modelHomeStatesByHub],
  );

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
    [openMarkdownInEditor],
  );

  const moveHomeHistory = useCallback(
    async (
      hubUri: string,
      state: WorkspaceHomeState,
      move: (state: WorkspaceHomeState) => WorkspaceHomeState,
    ): Promise<boolean> =>
      moveHomeHistoryBridge(
        {setHomeStateForHub, openMarkdownInEditor},
        hubUri,
        state,
        move,
      ),
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
  ]);

  useInboxShellRestore({
    vaultRoot,
    inboxRestoreEnabled,
    inboxShellRestored,
    setInboxShellRestored,
    restoredInboxState,
    notes,
    notesRef,
    vaultMarkdownRefs,
    editorWorkspaceTabsRef,
    activeEditorTabIdRef,
    activeTodayHubUriRef,
    setEditorWorkspaceTabs,
    setActiveEditorTabId,
    setActiveTodayHubUri,
    replaceHomeStatesByHub,
    mirrorShadowActiveHub,
    mirrorShadowActiveWorkspaceTabs,
    mirrorShadowActiveTab,
    mirrorShadowHomeSurface,
    syncShadowWorkspaceFromShellRestore,
    startNewEntry,
    selectNote,
    selectHomeCurrentNote,
  });

  useEffect(() => {
    if (!vaultRoot || restoredInboxState == null) {
      return;
    }
    if (typeof restoredInboxState.composeDraftMarkdown !== 'string') {
      return;
    }
    const openRoot = trimTrailingSlashes(normalizeVaultBaseUri(vaultRoot).replace(/\\/g, '/'));
    const restoredRoot = trimTrailingSlashes(
      normalizeVaultBaseUri(restoredInboxState.vaultRoot).replace(/\\/g, '/'),
    );
    if (openRoot !== restoredRoot) {
      return;
    }
    setComposeDraftMarkdown(restoredInboxState.composeDraftMarkdown);
  }, [restoredInboxState, setComposeDraftMarkdown, vaultRoot]);

  return {
    vaultRoot,
    vaultSettings,
    setVaultSettings,
    settingsName,
    busy,
    fsRefreshNonce,
    podcastFsNonce,
    deviceInstanceId,
    selectionController: {
      notes,
      selectedUri,
      editorBody,
      setEditorBody: guardedSetEditorBody,
      inboxEditorResetNonce,
      composeDraftMarkdown,
      composeDraftResetNonce,
      setComposeDraftMarkdown,
      composingNewEntry,
      startNewEntry,
      cancelNewEntry,
      selectNote,
      selectNoteInNewActiveTab,
      submitNewEntry,
      inboxContentByUri,
      vaultMarkdownRefs,
      selectedNoteBacklinkUris,
      inboxEditorShellScrollDirectiveRef,
      inboxBacklinksDeferNonce,
    },
    notificationsState: {
      err, setErr, wikiRenameNotice, renameLinkProgress, pendingWikiLinkAmbiguityRename,
      confirmPendingWikiLinkAmbiguityRename, cancelPendingWikiLinkAmbiguityRename,
    },
    conflictController: {
      diskConflict,
      resolveDiskConflictReloadFromDisk,
      resolveDiskConflictKeepLocal,
      diskConflictSoft,
      elevateDiskConflictSoftToBlocking,
      dismissDiskConflictSoft,
      mergeView,
      closeMergeView,
      applyFullBackupFromMerge,
      keepMyEditsFromMerge,
      enterDiskConflictMergeView,
      applyMergedBodyFromMerge,
    },
    hydrateVault,
    persistenceController: {
      onInboxSaveShortcut,
      onCleanNoteInbox,
      flushInboxSave,
      saveSettledNonce: vaultWriteSettledNonce,
    },
    linkController,
    treeController: {
      deleteNote,
      renameNote,
      subtreeMarkdownCache,
      deleteFolder,
      renameFolder,
      moveVaultTreeItem,
      bulkDeleteVaultTreeItems,
      bulkMoveVaultTreeItems,
      vaultTreeSelectionClearNonce,
    },
    inboxShellRestored,
    initialVaultHydrateAttemptDone,
    tabsController: {
      editorHistoryCanGoBack, editorHistoryCanGoForward, editorHistoryGoBack, editorHistoryGoForward,
      editorWorkspaceTabs: tabsControllerSurface[0],
      activeEditorTabId: tabsControllerSurface[1],
      activateOpenTab, closeEditorTab, reorderEditorWorkspaceTabs,
      closeOtherEditorTabs, closeAllEditorTabs, reopenLastClosedEditorTab, canReopenClosedEditorTab,
    },
    todayHubController: {
      showTodayHubCanvas,
      todayHubSettings,
      todayHubBridgeRef,
      todayHubWikiNavParentRef,
      todayHubCellEditorRef,
      prehydrateTodayHubRows,
      persistTodayHubRow,
      todayHubCleanRowBlocked,
      todayHubSelectorItems,
      activeTodayHubUri: modelActiveTodayHubUri,
      persistenceActiveTodayHubUri: modelDerivedPersistence.activeTodayHubUri,
      persistenceTodayHubWorkspaces: modelDerivedPersistence.todayHubWorkspaces as Record<
        string,
        TodayHubWorkspaceSnapshot
      >,
      legacyTodayHubWorkspacesForSwitch: todayHubWorkspacesForSwitch,
      // serializeWorkspaceModelToPersistence always writes a non-null homeHistory,
      // so the null branch of TodayHubWorkspaceSnapshotPersisted.homeHistory never fires here.
      todayHubWorkspacesForSave: modelDerivedPersistence.todayHubWorkspaces as Record<
        string,
        TodayHubWorkspaceSnapshot
      >,
      switchTodayHubWorkspace,
      focusActiveTodayHubNote,
      workspaceSelectorSubLabel,
      openWorkspaceHomeCurrentInBackgroundTab,
      workspaceSelectShowsActiveTabPill,
    },
    frontmatterController: {
      inboxYamlFrontmatterInner,
      applyFrontmatterInnerChange,
      syncFrontmatterStateFromDisk,
    },
    workspaceShadowModelForTests:
      import.meta.env.MODE === 'test' ? workspaceShadowModel : undefined,
    ...(import.meta.env.MODE === 'test'
      ? {
          __bumpVaultMarkdownRefsScanForTests: () => {
            setFsRefreshNonce(n => n + 1);
          },
        }
      : {}),
  };
}

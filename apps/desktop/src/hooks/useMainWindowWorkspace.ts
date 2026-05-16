/**
 * Main-window vault workspace: orchestration hook (Tauri FS, editor tabs, Today hub, wiki rename).
 *
 * Ownership: wire platform I/O and React state here; prefer extracted modules for focused logic
 * (`useTodayHubsState`, `useInboxShellRestore`, `workspaceComposeCommands`,
 * `workspaceOpenMarkdownCommand`, `workspaceTreeCommands`, `workspaceEditorHistoryNavigation`,
 * `workspaceFsWatchReconcile`, `useVaultBootstrap`, `useDiskConflictState`,
 * `useMergeViewState`, `useWorkspacePersistence`, `useInboxBodyCache`, `useNotesListing`).
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
  collectVaultMarkdownRefs,
  SubtreeMarkdownPresenceCache,
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
import {vaultUriIsTodayMarkdownFile} from '../lib/vaultTreeLoadChildren';
import {
  normalizeEditorDocUri,
} from '../lib/editorDocumentHistory';
import {popNextReopenableClosedTabRecord} from '../lib/editorClosedTabStack';
import {
  findTabById,
  findTabIdWithCurrentUri,
  firstSurvivorUriFromTabs,
  pickNeighborTabIdAfterRemovingTab,
  pushClosedWorkspaceTabsFromCloseAll,
  pushClosedWorkspaceTabsFromCloseOther,
  remapAllTabsUriPrefix,
  reorderEditorWorkspaceTabsInArray,
  tabCurrentUri,
  type EditorWorkspaceTab,
} from '../lib/editorWorkspaceTabs';
import type {TodayHubWorkspaceSnapshot} from '../lib/mainWindowUiStore';
import {
  selectNoteActiveHubTodayOpen,
  isOnWorkspaceHome,
} from '../lib/workspaceShellToday';
import {
  createWorkspaceHomeState,
  type WorkspaceHomeState,
} from '../lib/workspaceHomeNavigation';
import {
  closeAllTabsAction,
  closeOtherTabsAction,
  closeTabAction,
  removeUrisAction,
  reorderTabsAction,
  normalizeWorkspaceUri,
  type WorkspaceModel,
} from '../lib/workspaceModel';
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
import {
  runOpenMarkdownInEditorCommand,
  type OpenMarkdownInEditorOptions,
} from './workspaceOpenMarkdownCommand';
import {
  runAddNote,
  runCancelNewEntry,
  runCleanNoteInbox,
  runStartNewEntry,
  runSubmitNewEntry,
} from './workspaceComposeCommands';
import {useTodayHubsState, type TodayHubOpenMarkdown} from './useTodayHubsState';
import {useInboxShellRestore} from './useInboxShellRestore';
import {
  createWorkspaceShadowMirrorCallbacks,
} from './workspaceShadowBridge';
import {
  editorWorkspaceTabsFromModelTabEntries,
  resolveModelBackedLegacyTabStrip,
} from './workspaceRuntimeProjection';
import {
  useWorkspaceRenameMaintenance,
  type WorkspaceRenameMaintenanceCommitArgs,
  type WorkspaceRenameMaintenanceSnapshot,
} from './workspaceRenameMaintenance';
import {remapEditorShellScrollMapExact} from './workspaceEditorScrollMap';
import type {InboxAutosaveScheduler} from '../lib/inboxAutosaveScheduler';
import {
  clearInboxYamlFrontmatterEditorRefs,
  inboxEditorSliceToFullMarkdown,
} from '../lib/inboxYamlFrontmatterEditor';
import {
  loadVaultMarkdownBodiesWithSeed,
  mergeInboxNoteBodyIntoCache,
  resolveInboxCachedBodyForEditor,
  normalizeVaultMarkdownDiskRead,
} from './inboxNoteBodyCache';

/** Debounce scan of the active note body for backlinks (full vault scan is too heavy per keystroke). */
const INBOX_BACKLINK_BODY_DEBOUNCE_MS = 200;

function replaceRuntimeActiveHub(
  hubUri: string | null,
  ref: MutableRefObject<string | null>,
  setActiveTodayHubUri: Dispatch<SetStateAction<string | null>>,
): void {
  ref.current = hubUri;
  setActiveTodayHubUri(hubUri);
}

function replaceRuntimeActiveSurfaceTab(
  tabId: string | null,
  ref: MutableRefObject<string | null>,
  setActiveEditorTabId: Dispatch<SetStateAction<string | null>>,
): void {
  ref.current = tabId;
  setActiveEditorTabId(tabId);
}

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
  restoredInboxState: {
    vaultRoot: string;
    composingNewEntry: boolean;
    selectedUri: string | null;
    openTabUris?: readonly string[] | null;
    editorWorkspaceTabs?: ReadonlyArray<{
      id: string;
      entries: string[];
      index: number;
    }> | null;
    activeEditorTabId?: string | null;
    activeTodayHubUri?: string | null;
    todayHubWorkspaces?: Record<string, TodayHubWorkspaceSnapshot> | null;
  } | null;
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
  } = useInboxBodyCache();
  const [vaultMarkdownRefs, setVaultMarkdownRefs] = useState<VaultMarkdownRef[]>([]);
  /**
   * False while `vaultMarkdownRefs` for the current `{vaultRoot, fsRefreshNonce}` fetch has not
   * completed. `vaultMarkdownRefs` stays `[]` until the async scan finishes, so without this flag
   * {@link syncHubWorkspacesToVaultTodayRefsAction} could prune restored hub state on an empty URI
   * list during startup.
   */
  const [vaultMarkdownRefsReady, setVaultMarkdownRefsReady] = useState(false);
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
  const vaultRefsBuildGenRef = useRef(0);
  const vaultMarkdownRefsFetchKeyRef = useRef<{
    root: string | null;
    nonce: number;
  } | null>(null);
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
  const submitNewEntryRef = useRef<() => Promise<void>>(async () => {});
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

  useLayoutEffect(() => {
    const prev = vaultMarkdownRefsFetchKeyRef.current;
    const next = {root: vaultRoot, nonce: fsRefreshNonce};
    if (
      prev == null ||
      prev.root !== next.root ||
      prev.nonce !== next.nonce
    ) {
      vaultMarkdownRefsFetchKeyRef.current = next;
      setVaultMarkdownRefsReady(vaultRoot == null);
    }
  }, [vaultRoot, fsRefreshNonce]);

  useEffect(() => {
    vaultMarkdownRefsRef.current = vaultMarkdownRefs;
  }, [vaultMarkdownRefs]);

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
    lastPersistedRef,
    lastPersistedExternalMutationSeqRef,
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
    lastPersistedExternalMutationSeqRef,
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

  const getRenameMaintenanceSnapshot =
    useCallback(async (): Promise<WorkspaceRenameMaintenanceSnapshot> => {
      const wikiRefs = vaultMarkdownRefsRef.current.map(r => ({name: r.name, uri: r.uri}));
      const activeUri = selectedUriRef.current;
      const activeBody =
        activeUri != null
          ? inboxEditorSliceToFullMarkdown(
              inboxEditorRef.current?.getMarkdown() ?? editorBodyRef.current,
              activeUri,
              composingNewEntryRef.current,
              inboxYamlFrontmatterInnerRef.current,
              inboxEditorYamlLeadingBeforeFrontmatterRef.current,
            )
          : '';
      const expandedContent = await loadVaultMarkdownBodiesWithSeed(
        fs,
        wikiRefs,
        inboxContentByUriRef.current,
        activeUri,
        activeBody,
      );
      return {wikiRefs, activeUri, activeBody, expandedContent};
    }, [fs, inboxEditorRef]);

  const commitRenameMaintenanceResult = useCallback(
    ({
      oldUri,
      nextUri,
      rewritePlan,
      applyResult,
    }: WorkspaceRenameMaintenanceCommitArgs) => {
      const succeededWriteUris = new Set(applyResult.succeededUris);
      const plannedContentByWriteUri = new Map<string, string>();
      for (const update of rewritePlan.updates) {
        const writeUri = update.uri === oldUri ? nextUri : update.uri;
        plannedContentByWriteUri.set(writeUri, update.markdown);
      }
      setInboxContentByUri(prev => {
        const next = {...prev};
        if (nextUri !== oldUri && prev[oldUri] !== undefined) {
          next[nextUri] = prev[oldUri];
          delete next[oldUri];
        }
        for (const [writeUri, markdown] of plannedContentByWriteUri) {
          if (succeededWriteUris.has(writeUri)) {
            next[writeUri] = markdown;
          }
        }
        return next;
      });
      if (selectedUriRef.current === oldUri) {
        selectedUriRef.current = nextUri;
        setSelectedUri(nextUri);
        const previousPersisted = lastPersistedRef.current;
        if (previousPersisted && previousPersisted.uri === oldUri) {
          lastPersistedRef.current = {uri: nextUri, markdown: previousPersisted.markdown};
          lastPersistedExternalMutationSeqRef.current += 1;
        }
      }
      if (nextUri !== oldUri) {
        remapEditorShellScrollMapExact(editorShellScrollByUriRef.current, oldUri, nextUri);
        const remappedRenameTabs = remapAllTabsUriPrefix(
          editorWorkspaceTabsRef.current,
          oldUri,
          nextUri,
        );
        replaceEditorWorkspaceTabs(remappedRenameTabs);
        remapHomeStatesPrefix(oldUri, nextUri);
      }
    },
    [remapHomeStatesPrefix],
  );

  const {
    wikiRenameNotice,
    renameLinkProgress,
    pendingWikiLinkAmbiguityRename,
    renameNote,
    confirmPendingWikiLinkAmbiguityRename,
    cancelPendingWikiLinkAmbiguityRename,
    clearRenameNotice,
    resetRenameMaintenanceState,
  } = useWorkspaceRenameMaintenance({
    vaultRoot,
    fs,
    autosaveSchedulerRef,
    flushInboxSaveRef,
    getSnapshot: getRenameMaintenanceSnapshot,
    commitRenameResult: commitRenameMaintenanceResult,
    refreshNotes,
    subtreeMarkdownCache,
    setBusy,
    setErr,
    setFsRefreshNonce,
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
      lastPersistedExternalMutationSeqRef,
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

  const activateOpenTab = useCallback(
    (tabId: string) => {
      const tab = findTabById(editorWorkspaceTabsRef.current, tabId);
      const u = tab ? tabCurrentUri(tab) : null;
      if (!u) {
        return;
      }
      replaceRuntimeActiveSurfaceTab(
        tabId,
        activeEditorTabIdRef,
        setActiveEditorTabId,
      );
      mirrorShadowActiveTab(tabId, 'activate open tab');
      void openMarkdownInEditor(u, {skipHistory: true});
    },
    [mirrorShadowActiveTab, openMarkdownInEditor],
  );

  useLayoutEffect(() => {
    activateOpenTabRef.current = activateOpenTab;
  }, [activateOpenTab]);

  const reorderEditorWorkspaceTabs = useCallback(
    (fromIndex: number, insertBeforeIndex: number) => {
      if (busy) {
        return;
      }
      const tabs = editorWorkspaceTabsRef.current;
      const preview = reorderEditorWorkspaceTabsInArray(tabs, fromIndex, insertBeforeIndex);
      let sameOrder = true;
      for (let i = 0; i < preview.length; i++) {
        if (preview[i]!.id !== tabs[i]!.id) {
          sameOrder = false;
          break;
        }
      }
      if (sameOrder) {
        return;
      }
      // Model-led: apply reorder on the shadow workspace, then sync legacy tab strip from TabEntry[].
      const nextModel = dispatchWorkspaceActionSync('reorder tabs', m =>
        reorderTabsAction(m, fromIndex, insertBeforeIndex),
      );
      const hub = nextModel.activeHub;
      if (hub == null) {
        return;
      }
      const ws = nextModel.workspaces[hub];
      if (ws == null) {
        return;
      }
      const nextTabs = editorWorkspaceTabsFromModelTabEntries(ws.tabs);
      replaceEditorWorkspaceTabs(nextTabs);
    },
    [busy, dispatchWorkspaceActionSync],
  );

  /** Drop the active inbox selection entirely — clear refs, state, and editor. */
  const clearInboxSelection = useCallback(() => {
    clearInboxSelectionFromInboxState();
    lastPersistedRef.current = null;
    lastPersistedExternalMutationSeqRef.current += 1;
  }, [clearInboxSelectionFromInboxState]);

  const recordClosedTabAndPruneScroll = useCallback(
    (tabsBefore: readonly EditorWorkspaceTab[], tabId: string, tabClosing: EditorWorkspaceTab | undefined) => {
      const closedUri = tabClosing ? tabCurrentUri(tabClosing) : null;
      if (closedUri) {
        const closedIndex = tabsBefore.findIndex(t => t.id === tabId);
        editorClosedTabsStackRef.current.push({
          uri: closedUri,
          index: closedIndex >= 0 ? closedIndex : tabsBefore.length - 1,
        });
      }
      bumpEditorClosedStack();
      if (tabClosing) {
        for (const u of tabClosing.history.entries) {
          editorShellScrollByUriRef.current.delete(normalizeEditorDocUri(u));
        }
      }
    },
    [bumpEditorClosedStack],
  );

  const refocusAfterClosingActiveTab = useCallback(
    async (nextTabId: string | null, nextTabs: readonly EditorWorkspaceTab[]) => {
      if (nextTabId) {
        replaceRuntimeActiveSurfaceTab(
          nextTabId,
          activeEditorTabIdRef,
          setActiveEditorTabId,
        );
        mirrorShadowActiveTab(nextTabId, 'close tab refocus neighbor');
      }
      const neighbor = nextTabId ? findTabById(nextTabs, nextTabId) : undefined;
      const nextUri = neighbor ? tabCurrentUri(neighbor) : null;
      if (nextUri) {
        await openMarkdownInEditor(nextUri, {skipHistory: true});
        return;
      }
      const shellHub = activeTodayHubUriRef.current;
      if (shellHub) {
        await selectHomeCurrentNote(shellHub);
        return;
      }
      if (!nextTabId) {
        replaceRuntimeActiveSurfaceTab(
          null,
          activeEditorTabIdRef,
          setActiveEditorTabId,
        );
        mirrorShadowHomeSurface('close tab home surface');
      }
      clearInboxSelection();
    },
    [
      openMarkdownInEditor,
      clearInboxSelection,
      mirrorShadowActiveTab,
      mirrorShadowHomeSurface,
      selectHomeCurrentNote,
    ],
  );

  const closeEditorTab = useCallback(
    (tabId: string) => {
      void (async () => {
        const tabsBefore = editorWorkspaceTabsRef.current;
        const tabClosing = findTabById(tabsBefore, tabId);
        const wasActive = activeEditorTabIdRef.current === tabId;

        if (wasActive) {
          await flushInboxSaveRef.current();
        } else {
          await saveChainRef.current.catch(() => undefined);
        }

        recordClosedTabAndPruneScroll(tabsBefore, tabId, tabClosing);

        const nextTabId = pickNeighborTabIdAfterRemovingTab(tabsBefore, tabId);
        const nextTabsLegacy = tabsBefore.filter(t => t.id !== tabId);

        const nextModel = dispatchWorkspaceActionSync('close tab', m =>
          closeTabAction(m, tabId),
        );
        const {nextTabs, mismatch: tabStripMismatch} = resolveModelBackedLegacyTabStrip(
          nextModel,
          nextTabsLegacy,
          'ids',
        );
        if (tabStripMismatch?.kind === 'ids') {
          const warn =
            typeof process !== 'undefined' && process.env.NODE_ENV !== 'production';
          if (warn) {
            const {legacyIds, derivedIds} = tabStripMismatch;
            console.warn(
              '[workspaceModel] closeEditorTab: model strip mismatch vs legacy filter; using legacy strip',
              {tabId, legacyIds, derivedIds},
            );
          }
        }

        replaceEditorWorkspaceTabs(nextTabs);

        if (!wasActive) {
          return;
        }
        await refocusAfterClosingActiveTab(nextTabId, nextTabs);
      })();
    },
    [
      dispatchWorkspaceActionSync,
      flushInboxSaveRef,
      recordClosedTabAndPruneScroll,
      refocusAfterClosingActiveTab,
      saveChainRef,
    ],
  );

  const closeOtherEditorTabs = useCallback(
    (keepTabId: string) => {
      void (async () => {
        const prevTabs = [...editorWorkspaceTabsRef.current];
        const keepTab = findTabById(prevTabs, keepTabId);
        const keepUri = keepTab ? tabCurrentUri(keepTab) : null;
        if (keepUri == null) {
          return;
        }
        await saveChainRef.current.catch(() => undefined);
        if (activeEditorTabIdRef.current !== keepTabId) {
          replaceRuntimeActiveSurfaceTab(
            keepTabId,
            activeEditorTabIdRef,
            setActiveEditorTabId,
          );
          mirrorShadowActiveTab(keepTabId, 'close other tabs activate kept tab');
          await openMarkdownInEditor(keepUri, {skipHistory: true});
        } else {
          await flushInboxSaveRef.current();
        }
        pushClosedWorkspaceTabsFromCloseOther(
          editorClosedTabsStackRef.current,
          prevTabs,
          keepTabId,
        );
        bumpEditorClosedStack();
        for (const t of prevTabs) {
          if (t.id === keepTabId) {
            continue;
          }
          for (const u of t.history.entries) {
            editorShellScrollByUriRef.current.delete(normalizeEditorDocUri(u));
          }
        }
        const nextModel = dispatchWorkspaceActionSync('close other tabs', m =>
          closeOtherTabsAction(m, keepTabId),
        );
        const hub = nextModel.activeHub;
        const derived =
          hub != null && nextModel.workspaces[hub] != null
            ? editorWorkspaceTabsFromModelTabEntries(nextModel.workspaces[hub].tabs)
            : null;
        const nextTabs =
          derived != null &&
          derived.length === 1 &&
          derived[0]!.id === keepTabId
            ? derived
            : prevTabs.filter(t => t.id === keepTabId);
        replaceEditorWorkspaceTabs(nextTabs);
      })();
    },
    [
      bumpEditorClosedStack,
      dispatchWorkspaceActionSync,
      flushInboxSaveRef,
      mirrorShadowActiveTab,
      openMarkdownInEditor,
      saveChainRef,
    ],
  );

  const closeAllEditorTabs = useCallback(() => {
    void (async () => {
      await flushInboxSaveRef.current();
      const tabs = [...editorWorkspaceTabsRef.current];
      if (tabs.length === 0) {
        return;
      }
      pushClosedWorkspaceTabsFromCloseAll(
        editorClosedTabsStackRef.current,
        tabs,
        activeEditorTabIdRef.current,
      );
      bumpEditorClosedStack();
      for (const t of tabs) {
        for (const u of t.history.entries) {
          editorShellScrollByUriRef.current.delete(normalizeEditorDocUri(u));
        }
      }
      const nextModel = dispatchWorkspaceActionSync('close all tabs', closeAllTabsAction);
      const hub = nextModel.activeHub;
      const nextTabs =
        hub != null && nextModel.workspaces[hub] != null
          ? editorWorkspaceTabsFromModelTabEntries(nextModel.workspaces[hub].tabs)
          : [];
      replaceEditorWorkspaceTabs(nextTabs);
      replaceRuntimeActiveSurfaceTab(
        null,
        activeEditorTabIdRef,
        setActiveEditorTabId,
      );
      mirrorShadowHomeSurface('close all tabs home surface');
      const shellHubAll = activeTodayHubUriRef.current;
      if (shellHubAll) {
        await selectHomeCurrentNote(shellHubAll);
        return;
      }
      selectedUriRef.current = null;
      composingNewEntryRef.current = false;
      lastPersistedRef.current = null;
      lastPersistedExternalMutationSeqRef.current += 1;
      setSelectedUri(null);
      setComposingNewEntry(false);
      clearInboxYamlFrontmatterEditorRefs({
        inner: inboxYamlFrontmatterInnerRef,
        leading: inboxEditorYamlLeadingBeforeFrontmatterRef,
        setInner: setInboxYamlFrontmatterInner,
        setLeading: setInboxEditorYamlLeadingBeforeFrontmatter,
      });
      setEditorBody('');
      setInboxEditorResetNonce(n => n + 1);
    })();
  }, [
    bumpEditorClosedStack,
    dispatchWorkspaceActionSync,
    flushInboxSaveRef,
    mirrorShadowHomeSurface,
    selectHomeCurrentNote,
  ]);

  const reopenLastClosedEditorTab = useCallback(() => {
    void (async () => {
      const root = vaultRootRef.current;
      const stack = editorClosedTabsStackRef.current;
      const noteSet = new Set(
        notesRef.current.map(n => n.uri.replace(/\\/g, '/')),
      );
      const {record, popped} = popNextReopenableClosedTabRecord(stack, root, noteSet);
      if (popped > 0) {
        bumpEditorClosedStack();
      }
      if (record) {
        await openMarkdownInEditor(record.uri, {
          newTab: true,
          activateNewTab: true,
          insertAtIndex: record.index,
        });
      }
    })();
  }, [openMarkdownInEditor, bumpEditorClosedStack]);

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
    lastPersistedRef.current = null;
    lastPersistedExternalMutationSeqRef.current += 1;
    setInboxEditorResetNonce(n => n + 1);
  }, [bumpEditorClosedStack, closeMergeView, mirrorShadowActiveHub]);

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

  useEffect(() => {
    if (!vaultRoot) {
      queueMicrotask(() => {
        setVaultMarkdownRefs([]);
      });
      return;
    }
    const gen = ++vaultRefsBuildGenRef.current;
    const ac = new AbortController();
    void (async () => {
      try {
        const refs = await collectVaultMarkdownRefs(vaultRoot, fs, {signal: ac.signal});
        if (gen !== vaultRefsBuildGenRef.current) {
          return;
        }
        setVaultMarkdownRefs(refs);
        setVaultMarkdownRefsReady(true);
      } catch (e) {
        if (ac.signal.aborted) {
          return;
        }
        console.warn('[vaultMarkdownRefs]', e);
      }
    })();
    return () => {
      ac.abort();
    };
  }, [vaultRoot, fs, fsRefreshNonce]);

  useLayoutEffect(() => {
    if (!vaultRoot || !selectedUri) {
      clearInboxBacklinksDeferAfterLoad();
      return;
    }
    if (eagerEditorLoadUriRef.current === selectedUri) {
      eagerEditorLoadUriRef.current = null;
      return;
    }
    const cached = inboxContentByUriRef.current[selectedUri];
    if (cached !== undefined) {
      const {markdown: body, healedCache} = resolveInboxCachedBodyForEditor(
        selectedUri,
        cached,
        lastPersistedRef.current,
      );
      if (healedCache) {
        const healed = mergeInboxNoteBodyIntoCache(
          inboxContentByUriRef.current,
          selectedUri,
          body,
        );
        if (healed) {
          inboxContentByUriRef.current = healed;
          setInboxContentByUri(prev =>
            mergeInboxNoteBodyIntoCache(prev, selectedUri, body) ?? prev,
          );
        }
      }
      lastPersistedRef.current = {uri: selectedUri, markdown: body};
      lastPersistedExternalMutationSeqRef.current += 1;
      loadFullMarkdownIntoInboxEditor(body, selectedUri, 'start');
      scheduleBacklinksDeferOneFrameAfterLoad();
    } else {
      clearInboxBacklinksDeferAfterLoad();
      clearInboxYamlFrontmatterEditorRefs({
        inner: inboxYamlFrontmatterInnerRef,
        leading: inboxEditorYamlLeadingBeforeFrontmatterRef,
        setInner: setInboxYamlFrontmatterInner,
        setLeading: setInboxEditorYamlLeadingBeforeFrontmatter,
      });
      setEditorBody('');
      lastPersistedRef.current = null;
      lastPersistedExternalMutationSeqRef.current += 1;
    }
  }, [
    vaultRoot,
    selectedUri,
    inboxEditorRef,
    clearInboxBacklinksDeferAfterLoad,
    loadFullMarkdownIntoInboxEditor,
    scheduleBacklinksDeferOneFrameAfterLoad,
  ]);

  /**
   * Clear the open note in CodeMirror when the shell has no cached body yet.
   * Runs after `NoteMarkdownEditor`'s mount effect creates the view (parent layout is too early).
   */
  useEffect(() => {
    if (!vaultRoot || !selectedUri) {
      return;
    }
    if (inboxContentByUriRef.current[selectedUri] !== undefined) {
      return;
    }
    inboxYamlFrontmatterInnerRef.current = null;
    inboxEditorYamlLeadingBeforeFrontmatterRef.current = '';
    queueMicrotask(() => {
      setInboxYamlFrontmatterInner(null);
      setInboxEditorYamlLeadingBeforeFrontmatter('');
    });
    inboxEditorRef.current?.loadMarkdown('', {selection: 'start'});
    scheduleBacklinksDeferOneFrameAfterLoad();
  }, [vaultRoot, selectedUri, inboxEditorRef, scheduleBacklinksDeferOneFrameAfterLoad]);


  useLayoutEffect(() => {
    if (composingNewEntry || !selectedUri) {
      if (backlinksActiveBodyRef.current !== '') {
        queueMicrotask(() => {
          setBacklinksActiveBody('');
        });
      }
      return;
    }
    const snap = inboxContentByUriRef.current[selectedUri] ?? '';
    if (backlinksActiveBodyRef.current === snap) {
      return;
    }
    queueMicrotask(() => {
      setBacklinksActiveBody(snap);
    });
  }, [
    backlinksActiveBodyRef,
    composingNewEntry,
    selectedUri,
    setBacklinksActiveBody,
    vaultRoot,
  ]);

  useEffect(() => {
    if (composingNewEntry || !selectedUri) {
      return;
    }
    const id = window.setTimeout(() => {
      const liveFull = inboxEditorSliceToFullMarkdown(
        editorBody,
        selectedUri,
        composingNewEntry,
        inboxYamlFrontmatterInnerRef.current,
        inboxEditorYamlLeadingBeforeFrontmatterRef.current,
      );
      if (backlinksActiveBodyRef.current === liveFull) {
        return;
      }
      setBacklinksActiveBody(liveFull);
    }, INBOX_BACKLINK_BODY_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [
    backlinksActiveBodyRef,
    composingNewEntry,
    editorBody,
    inboxYamlFrontmatterInner,
    selectedUri,
    setBacklinksActiveBody,
  ]);

  useEffect(() => {
    if (!vaultRoot || !selectedUri) {
      return;
    }
    if (inboxContentByUriRef.current[selectedUri] !== undefined) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const raw = await fs.readFile(selectedUri, {encoding: 'utf8'});
        if (!cancelled) {
          const normalized = normalizeVaultMarkdownDiskRead(raw);
          lastPersistedRef.current = {uri: selectedUri, markdown: normalized};
          lastPersistedExternalMutationSeqRef.current += 1;
          setInboxContentByUri(prev => {
            if (prev[selectedUri] === normalized) {
              return prev;
            }
            return {...prev, [selectedUri]: normalized};
          });
          const currentFull = inboxEditorSliceToFullMarkdown(
            editorBodyRef.current,
            selectedUri,
            composingNewEntryRef.current,
            inboxYamlFrontmatterInnerRef.current,
            inboxEditorYamlLeadingBeforeFrontmatterRef.current,
          );
          if (normalized !== currentFull) {
            loadFullMarkdownIntoInboxEditor(normalized, selectedUri, 'start');
            scheduleBacklinksDeferOneFrameAfterLoad();
          }
        }
      } catch (e) {
        if (!cancelled) {
          setErr(e instanceof Error ? e.message : String(e));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    vaultRoot,
    selectedUri,
    fs,
    inboxEditorRef,
    loadFullMarkdownIntoInboxEditor,
    scheduleBacklinksDeferOneFrameAfterLoad,
  ]);

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
        lastPersistedExternalMutationSeqRef,
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
        setComposingNewEntry,
        setSelectedUri,
        setDiskConflict,
        setDiskConflictSoft,
        setInboxContentByUri,
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
      lastPersistedExternalMutationSeqRef,
      editorBodyRef,
      inboxYamlFrontmatterInnerRef,
      inboxEditorYamlLeadingBeforeFrontmatterRef,
      inboxContentByUriRef,
      setBusy,
      setErr,
      setFsRefreshNonce,
      setEditorBody,
      setComposingNewEntry,
      setSelectedUri,
      setDiskConflict,
      setDiskConflictSoft,
      setInboxContentByUri,
      openMarkdownInEditor,
    ],
  );

  const startNewEntry = useCallback(() => {
    runStartNewEntry(composeCommandsContext);
  }, [composeCommandsContext]);

  const cancelNewEntry = useCallback(() => {
    runCancelNewEntry(composeCommandsContext);
  }, [composeCommandsContext]);

  /** Pick where to refocus after the active tab is closed: surviving tab → workspace shell hub → empty. */
  const refocusAfterActiveTabRemoved = useCallback(
    async (
      closedNorm: string,
      nextTabs: readonly EditorWorkspaceTab[],
      nextActive: string | null,
    ) => {
      const activeTab = nextActive ? findTabById(nextTabs, nextActive) : undefined;
      const nextAfterRemove =
        (activeTab ? tabCurrentUri(activeTab) : null)
        ?? firstSurvivorUriFromTabs(nextTabs);
      if (nextAfterRemove) {
        await openMarkdownInEditor(nextAfterRemove, {skipHistory: true});
        return;
      }
      const shellHub = activeTodayHubUriRef.current;
      if (shellHub && shellHub !== closedNorm) {
        await selectHomeCurrentNote(shellHub);
        return;
      }
      clearInboxSelection();
    },
    [openMarkdownInEditor, clearInboxSelection, selectHomeCurrentNote],
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
        lastPersistedExternalMutationSeqRef,
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
      const existingId = findTabIdWithCurrentUri(editorWorkspaceTabsRef.current, uri);
      if (existingId != null) {
        activateOpenTab(existingId);
        return;
      }
      const norm = normalizeEditorDocUri(uri) ?? '';
      const hubTodayOpen = selectNoteActiveHubTodayOpen({
        uri,
        activeTodayHubUri: activeTodayHubUriRef.current,
        uriIsTodayMarkdownFile: vaultUriIsTodayMarkdownFile(norm),
        editorWorkspaceTabCount: editorWorkspaceTabsRef.current.length,
      });
      if (hubTodayOpen === 'home') {
        void openMarkdownInEditor(uri, {home: true});
        return;
      }
      if (
        isOnWorkspaceHome({
          composingNewEntry: composingNewEntryRef.current,
          activeTodayHubUri: activeTodayHubUriRef.current,
          selectedUri: selectedUriRef.current,
          activeEditorTabId: activeEditorTabIdRef.current,
        })
      ) {
        void openMarkdownInEditor(uri, {home: true});
        return;
      }
      void openMarkdownInEditor(uri);
    },
    [activateOpenTab, openMarkdownInEditor],
  );

  useLayoutEffect(() => {
    selectNoteRef.current = selectNote;
  }, [selectNote]);

  const selectNoteInNewActiveTab = useCallback(
    (uri: string, opts?: {insertAfterActive?: boolean}) => {
      const existingId = findTabIdWithCurrentUri(editorWorkspaceTabsRef.current, uri);
      if (existingId != null) {
        activateOpenTab(existingId);
        return;
      }
      void openMarkdownInEditor(uri, {
        newTab: true,
        activateNewTab: true,
        insertAfterActive: opts?.insertAfterActive === true,
      });
    },
    [activateOpenTab, openMarkdownInEditor],
  );

  const submitNewEntry = useCallback(async () => {
    await runSubmitNewEntry(composeCommandsContext, editorBody);
  }, [composeCommandsContext, editorBody]);

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

/**
 * Today Hub workspace state: orchestrates home history, shadow sync, row persist, and hub switch.
 *
 * Ownership: composition only; logic lives under `hooks/todayHub/`.
 */
import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {sortedTodayHubNoteUrisFromRefs} from '@eskerra/core';

import {normalizeEditorDocUri} from '../lib/editorDocumentHistory';
import type {TodayHubWorkspaceSnapshot} from '../lib/mainWindowUiStore';
import type {TodayHubSettings} from '../lib/todayHub';
import {deriveModelDerivedPersistencePayload} from './workspacePersistenceBridge';
import {
  activeEditorWorkspaceTabsFromWorkspaceModel,
  activeSurfaceTabIdFromWorkspaceModel,
  tabsControllerEditorSurface,
  workspaceHomeStatesFromWorkspaceModel,
} from './workspaceRuntimeProjection';
import {reduceWorkspaceModelForHubSwitch} from './todayHub/syncWorkspaceModelForHubSwitch';
import {restoreShadowWorkspaceModelFromInboxState} from './workspaceShellRestoreModel';
import {
  workspaceSelectorMainShowsActiveTabPill,
  workspaceSelectorSubLabelText,
} from '../lib/workspaceShellToday';
import {
  deriveTodayHubSelectorItems,
  deriveTodayHubSettings,
  deriveTodayHubShowCanvas,
} from './workspaceTodayHubDerived';
import {useWorkspaceTodayHubSwitch} from './workspaceTodayHubSwitch';
import type {EditorWorkspaceTab} from '../lib/editorWorkspaceTabs';
import type {ShellRestoreProjectionSyncArgs} from './workspaceInboxShellRestoreBridge';
import {useTodayHubDefaultActiveHubEffect} from './todayHub/useTodayHubDefaultActiveHubEffect';
import {useTodayHubHomeNavigation} from './todayHub/useTodayHubHomeNavigation';
import {useTodayHubHomeState} from './todayHub/useTodayHubHomeState';
import {useTodayHubLegacyProjectionSync} from './todayHub/useTodayHubLegacyProjectionSync';
import {
  enqueuePersistTodayHubRowOnSaveChain,
  prehydrateTodayHubRowsFromDisk,
  type TodayHubRowPersistDeps,
} from './todayHub/todayHubRowPersist';
import type {
  TodayHubOpenMarkdown,
  UseTodayHubsStateArgs,
  UseTodayHubsStateResult,
} from './todayHub/useTodayHubsStateTypes';

export type {TodayHubOpenMarkdown, UseTodayHubsStateArgs, UseTodayHubsStateResult};

export function useTodayHubsState(args: UseTodayHubsStateArgs): UseTodayHubsStateResult {
  const {
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
    workspace: {workspaceShadowModel, dispatchWorkspaceActionSync, mirror},
    editorTabs: {
      editorWorkspaceTabs,
      activeEditorTabId,
      replaceEditorWorkspaceTabs,
      setEditorWorkspaceTabs,
      setActiveEditorTabId,
      setComposingNewEntry,
      setInboxYamlFrontmatterInner,
      setInboxEditorYamlLeadingBeforeFrontmatter,
      setEditorBody,
      setInboxEditorResetNonce,
      setInboxContentByUri,
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
      editorWorkspaceTabsRef,
      activeEditorTabIdRef,
      flushInboxSaveRef,
      saveChainRef,
      saveActiveRef,
      inboxContentByUriRef,
      diskConflictRef,
      openMarkdownInEditorRef,
      activateOpenTabRef,
      selectNoteRef,
    },
    refreshNotes,
    setFsRefreshNonce,
    setErr,
    markVaultWriteSettled,
    subtreeMarkdownCache,
  } = args;

  const {
    replaceShadowHomeStateForHub,
    mirrorShadowActiveHub,
    mirrorShadowHomeSurface,
    mirrorShadowActiveTab,
    mirrorShadowActiveWorkspaceTabs,
  } = mirror;

  const [activeTodayHubUri, setActiveTodayHubUri] = useState<string | null>(null);
  const activeTodayHubUriRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    activeTodayHubUriRef.current = activeTodayHubUri;
  }, [activeTodayHubUri]);

  const homeState = useTodayHubHomeState({
    dispatchWorkspaceActionSync,
    replaceShadowHomeStateForHub,
  });

  const {
    homeStatesByHubRef,
    replaceHomeStatesByHub,
    projectHomeStatesFromModel,
    remapHomeStatesPrefix,
    removeHomeHistoryUris,
    setHomeStateForHub,
    pushHomeHistoryForHub,
  } = homeState;

  const todayHubSelectorItems = useMemo(
    () => deriveTodayHubSelectorItems(vaultMarkdownRefs, notes),
    [vaultMarkdownRefs, notes],
  );

  const workspaceModelHubUris = useMemo(
    () => sortedTodayHubNoteUrisFromRefs(vaultMarkdownRefs),
    [vaultMarkdownRefs],
  );

  const modelDerivedPersistence = useMemo(
    () => deriveModelDerivedPersistencePayload(workspaceShadowModel),
    [workspaceShadowModel],
  );

  const modelActiveTodayHubUri = workspaceShadowModel.activeHub;
  const modelActiveEditorTabId = useMemo(
    () => activeSurfaceTabIdFromWorkspaceModel(workspaceShadowModel),
    [workspaceShadowModel],
  );
  const modelEditorWorkspaceTabs = useMemo(
    () => activeEditorWorkspaceTabsFromWorkspaceModel(workspaceShadowModel),
    [workspaceShadowModel],
  );
  const tabsControllerSurface = useMemo(
    () =>
      tabsControllerEditorSurface(
        modelActiveTodayHubUri,
        modelEditorWorkspaceTabs,
        modelActiveEditorTabId,
        editorWorkspaceTabs,
        activeEditorTabId,
      ),
    [
      modelActiveTodayHubUri,
      modelEditorWorkspaceTabs,
      modelActiveEditorTabId,
      editorWorkspaceTabs,
      activeEditorTabId,
    ],
  );
  const modelHomeStatesByHub = useMemo(
    () => workspaceHomeStatesFromWorkspaceModel(workspaceShadowModel),
    [workspaceShadowModel],
  );
  const todayHubWorkspacesForSwitch = modelDerivedPersistence.todayHubWorkspaces as Record<
    string,
    TodayHubWorkspaceSnapshot
  >;

  useTodayHubLegacyProjectionSync({
    inboxShellRestored,
    vaultRoot,
    vaultMarkdownRefsReady,
    workspaceModelHubUris,
    workspaceShadowModel,
    dispatchWorkspaceActionSync,
    activeTodayHubUriRef,
    setActiveTodayHubUri,
    modelActiveTodayHubUri,
    modelActiveEditorTabId,
    modelEditorWorkspaceTabs,
    modelHomeStatesByHub,
    editorWorkspaceTabsRef,
    activeEditorTabIdRef,
    replaceEditorWorkspaceTabs,
    setActiveEditorTabId,
    homeStatesByHubRef,
    replaceHomeStatesByHub,
  });

  const workspaceSelectShowsActiveTabPill = useMemo(
    () =>
      workspaceSelectorMainShowsActiveTabPill({
        composingNewEntry,
        activeTodayHubUri: modelActiveTodayHubUri,
        activeEditorTabId: modelActiveEditorTabId,
        homeState:
          modelActiveTodayHubUri != null
            ? modelHomeStatesByHub[modelActiveTodayHubUri]
            : undefined,
      }),
    [
      composingNewEntry,
      modelActiveTodayHubUri,
      modelActiveEditorTabId,
      modelHomeStatesByHub,
    ],
  );

  const workspaceSelectorSubLabel = useMemo(
    () =>
      workspaceSelectorSubLabelText({
        activeTodayHubUri: modelActiveTodayHubUri,
        homeState:
          modelActiveTodayHubUri != null
            ? modelHomeStatesByHub[modelActiveTodayHubUri]
            : undefined,
      }),
    [modelActiveTodayHubUri, modelHomeStatesByHub],
  );

  const showTodayHubCanvas = useMemo(
    () => deriveTodayHubShowCanvas(vaultRoot, selectedUri, composingNewEntry),
    [vaultRoot, selectedUri, composingNewEntry],
  );

  useLayoutEffect(() => {
    showTodayHubCanvasRef.current = showTodayHubCanvas;
  }, [showTodayHubCanvas, showTodayHubCanvasRef]);

  const todayHubSettings = useMemo(
    (): TodayHubSettings | null =>
      deriveTodayHubSettings({
        showTodayHubCanvas,
        selectedUri,
        editorBody,
        composingNewEntry,
        inboxYamlFrontmatterInner,
        inboxEditorYamlLeadingBeforeFrontmatter,
      }),
    [
      showTodayHubCanvas,
      selectedUri,
      editorBody,
      composingNewEntry,
      inboxYamlFrontmatterInner,
      inboxEditorYamlLeadingBeforeFrontmatter,
    ],
  );

  useLayoutEffect(() => {
    todayHubSettingsRef.current = todayHubSettings;
  }, [todayHubSettings, todayHubSettingsRef]);

  const rowPersistDeps = useMemo(
    (): TodayHubRowPersistDeps => ({
      fs,
      vaultRootRef,
      saveChainRef,
      inboxContentByUriRef,
      setInboxContentByUri,
      todayHubRowLastPersistedRef,
      setErr,
      markVaultWriteSettled,
      subtreeMarkdownCache,
      refreshNotes,
      setFsRefreshNonce,
    }),
    [
      fs,
      vaultRootRef,
      saveChainRef,
      inboxContentByUriRef,
      setInboxContentByUri,
      todayHubRowLastPersistedRef,
      setErr,
      markVaultWriteSettled,
      subtreeMarkdownCache,
      refreshNotes,
      setFsRefreshNonce,
    ],
  );

  const prehydrateTodayHubRows = useCallback(
    async (uris: readonly string[]) => prehydrateTodayHubRowsFromDisk(uris, rowPersistDeps),
    [rowPersistDeps],
  );

  const persistTodayHubRow = useCallback(
    async (rowUri: string, merged: string, columnCount: number) =>
      enqueuePersistTodayHubRowOnSaveChain(rowUri, merged, columnCount, {
        ...rowPersistDeps,
        saveActiveRef,
        saveChainRef,
      }),
    [rowPersistDeps, saveActiveRef, saveChainRef],
  );

  const {
    selectHomeCurrentNote,
    activateWorkspaceHomeSelector,
    openWorkspaceHomeCurrentInBackgroundTab,
  } = useTodayHubHomeNavigation({
    activeTodayHubUriRef,
    homeStatesByHubRef,
    activeEditorTabIdRef,
    selectedUriRef,
    openMarkdownInEditorRef,
    mirrorShadowHomeSurface,
    setHomeStateForHub,
  });

  const syncWorkspaceModelForIncomingHub = useCallback(
    (payload: Parameters<typeof reduceWorkspaceModelForHubSwitch>[1]) => {
      dispatchWorkspaceActionSync('today hub switch', m =>
        reduceWorkspaceModelForHubSwitch(m, payload, homeStatesByHubRef.current),
      );
    },
    [dispatchWorkspaceActionSync, homeStatesByHubRef],
  );

  const syncShadowWorkspaceFromShellRestore = useCallback(
    (projection: ShellRestoreProjectionSyncArgs) => {
      dispatchWorkspaceActionSync('restore shell workspace projection', () =>
        restoreShadowWorkspaceModelFromInboxState({
          hubUris: projection.hubUris,
          activeTodayHubUri: projection.activeTodayHubUri,
          todayHubWorkspaces: projection.todayHubWorkspaces,
          editorWorkspaceTabs: editorWorkspaceTabsRef.current,
          activeEditorTabId: activeEditorTabIdRef.current,
          homeStatesByHub: projection.homeStatesByHub,
        }),
      );
    },
    [activeEditorTabIdRef, dispatchWorkspaceActionSync, editorWorkspaceTabsRef],
  );

  const {switchTodayHubWorkspace, focusActiveTodayHubNote} =
    useWorkspaceTodayHubSwitch({
      state: {legacyTodayHubWorkspacesForSwitch: todayHubWorkspacesForSwitch},
      refs: {
        vaultMarkdownRefsRef,
        activeTodayHubUriRef,
        flushInboxSaveRef,
        composingNewEntryRef,
        inboxYamlFrontmatterInnerRef,
        inboxEditorYamlLeadingBeforeFrontmatterRef,
        editorWorkspaceTabsRef,
        activeEditorTabIdRef,
        homeStatesByHubRef,
      },
      setters: {
        setComposingNewEntry,
        setInboxYamlFrontmatterInner,
        setInboxEditorYamlLeadingBeforeFrontmatter,
        setEditorBody,
        setInboxEditorResetNonce,
        setEditorWorkspaceTabs,
        setActiveEditorTabId,
        setActiveTodayHubUri,
      },
      callbacks: {
        selectNote: uri => selectNoteRef.current(uri),
        selectHomeCurrentNote,
        activateOpenTab: tabId => activateOpenTabRef.current(tabId),
        activateWorkspaceHomeSelector,
        mirrorShadowActiveHub,
        mirrorShadowHomeSurface,
        mirrorShadowActiveTab,
        mirrorShadowActiveWorkspaceTabs,
        syncWorkspaceModelForIncomingHub,
      },
    });

  const todayHubCleanRowBlocked = useCallback((rowUri: string) => {
    const dc = diskConflictRef.current;
    return (
      !!dc &&
      normalizeEditorDocUri(dc.uri) === normalizeEditorDocUri(rowUri)
    );
  }, [diskConflictRef]);

  useTodayHubDefaultActiveHubEffect({
    vaultRoot,
    inboxShellRestored,
    vaultMarkdownRefs,
    modelActiveTodayHubUri,
    activeTodayHubUriRef,
    setActiveTodayHubUri,
    selectedUriRef,
    editorWorkspaceTabsRef,
    activeEditorTabIdRef,
    mirrorShadowActiveHub,
    mirrorShadowActiveWorkspaceTabs,
    switchTodayHubWorkspace,
  });

  return {
    activeTodayHubUriRef,
    setActiveTodayHubUri,
    homeStatesByHubRef,
    replaceHomeStatesByHub,
    modelActiveTodayHubUri,
    modelActiveEditorTabId,
    modelEditorWorkspaceTabs,
    modelHomeStatesByHub,
    modelDerivedPersistence,
    todayHubWorkspacesForSwitch,
    tabsControllerSurface,
    showTodayHubCanvas,
    showTodayHubCanvasRef,
    todayHubSettings,
    todayHubSettingsRef,
    todayHubBridgeRef,
    todayHubWikiNavParentRef,
    todayHubCellEditorRef,
    todayHubRowLastPersistedRef,
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
    activateWorkspaceHomeSelector,
    openWorkspaceHomeCurrentInBackgroundTab,
  };
}

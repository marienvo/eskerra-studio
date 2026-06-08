/**
 * Desktop app root: window chrome, global shortcuts, vault session, and shell around `VaultTab`.
 *
 * Ownership: app-level orchestration and Tauri window integration; vault editing behavior is in `VaultTab` / workspace hook.
 */
import {useCallback, useMemo, useRef, useState} from 'react';

import type {NoteMarkdownEditorHandle} from './editor/noteEditor/NoteMarkdownEditor';
import {useAppPodcastPlayback} from './hooks/useAppPodcastPlayback';
import {useDesktopPlaylistR2EtagPollingForMainWindow} from './hooks/useDesktopPlaylistR2EtagPolling';
import {useTauriWindowMaximized} from './hooks/useTauriWindowMaximized';
import {useTauriWindowTiling} from './hooks/useTauriWindowTiling';
import {useEditorHistoryMouseButtons} from './hooks/useEditorHistoryMouseButtons';
import {useMainWindowWorkspace} from './hooks/useMainWindowWorkspace';
import {usePreventMiddleClickPaste} from './hooks/usePreventMiddleClickPaste';
import {
  DEFAULT_LAYOUTS,
  type StoredLayouts,
} from './lib/layout/layoutStore';
import type {RestoredInboxState} from './lib/mainWindowUiStore';
import {useLiveRef} from './hooks/useLiveRef';
import {createTauriVaultFilesystem} from './lib/tauriVault';
import {useAppLayoutWidthPersisters} from './shell/useAppLayoutWidthPersisters';
import {useAppMediaControlDesktopPlayback} from './shell/useAppMediaControlDesktopPlayback';
import {useAppOnMountLayoutHydration} from './shell/useAppOnMountLayoutHydration';
import {useAppRootClassName} from './shell/useAppRootClassName';
import {useAppTauriCloseAndFocusSave} from './shell/useAppTauriCloseAndFocusSave';
import {useAppTauriDocumentChrome} from './shell/useAppTauriDocumentChrome';
import {useAppTitleBarTodayHubSelect} from './shell/useAppTitleBarTodayHubSelect';
import {useAppDebouncedPersistMainWindowUi} from './shell/useAppDebouncedPersistMainWindowUi';
import {useAppPickFolder} from './shell/useAppPickFolder';
import {usePaneVisibility} from './shell/usePaneVisibility';
import {
  useOpenReminderNavigation,
  navigateToReminder,
  type TodayHubReminderBridge,
} from './hooks/useOpenReminderNavigation';
import {useReminderPane} from './hooks/useReminderPane';
import {AppLayoutsLoadingScreen} from './shell/mainWindow/AppLayoutsLoadingScreen';
import {AppNoVaultSetupScreen} from './shell/mainWindow/AppNoVaultSetupScreen';
import {AppVaultReadyRoot} from './shell/mainWindow/AppVaultReadyRoot';
import {useLinkSnippetSettingsWriter} from './shell/mainWindow/useLinkSnippetSettingsWriter';
import {useAppMainWindowChromeSession} from './shell/mainWindow/useAppMainWindowChromeSession';
import {useAppPaletteLayerState} from './shell/mainWindow/useAppPaletteLayerState';
import {
  getAppMainWindowWorkspaceBindings,
  useAppTitleBarVaultActions,
} from './shell/mainWindow/useAppMainWindowWorkspaceBindings';

import './App.css';

type AppPage = 'vault' | 'settings';

export default function App() {
  const {maximized} = useTauriWindowMaximized();
  const {tiling, tilingDebug} = useTauriWindowTiling();

  const appRootRef = useRef<HTMLDivElement>(null);
  const fs = useMemo(() => createTauriVaultFilesystem(), []);
  const inboxEditorRef = useRef<NoteMarkdownEditorHandle | null>(null);
  const inboxEditorShellScrollRef = useRef<HTMLDivElement | null>(null);
  const [layoutsReady, setLayoutsReady] = useState(false);
  const [activePage, setActivePage] = useState<AppPage>('vault');
  const [restoredInboxState, setRestoredInboxState] = useState<RestoredInboxState | null>(null);
  const workspace = useMainWindowWorkspace({
    fs,
    inboxEditorRef,
    inboxEditorShellScrollRef,
    restoredInboxState,
    inboxRestoreEnabled: layoutsReady,
  });

  const paletteLayer = useAppPaletteLayerState();
  const paneVisibility = usePaneVisibility();
  const {visibility: paneVisibilityState, setVisibility: setPaneVisibility} =
    paneVisibility;
  const [titleBarEditorTabsHost, setTitleBarEditorTabsHost] = useState<HTMLDivElement | null>(
    null,
  );
  const [layouts, setLayouts] = useState<StoredLayouts>(DEFAULT_LAYOUTS);

  const {
    vaultRoot,
    vaultSettings,
    setVaultSettings,
    settingsName,
    busy,
    podcastFsNonce,
    deviceInstanceId,
    hydrateVault,
    inboxShellRestored,
    selectionController: {
      selectedUri,
      composeDraftMarkdown,
      composingNewEntry,
      startNewEntry,
      selectNoteInNewActiveTab,
      vaultMarkdownRefs,
    },
    persistenceController: {onCleanNoteInbox, flushInboxSave, saveSettledNonce},
    notificationsState: {err, setErr, wikiRenameNotice, renameLinkProgress},
    conflictController: {
      diskConflict,
      diskConflictSoft,
    },
    tabsController,
    todayHubController,
    openMarkdownInEditor,
    initialVaultHydrateAttemptDone,
  } = workspace;

  const hubTodayNoteUris = useMemo(
    () => todayHubController.todayHubSelectorItems.map(i => i.todayNoteUri),
    [todayHubController.todayHubSelectorItems],
  );

  const todayHubReminderBridge = useMemo<TodayHubReminderBridge>(
    () => ({
      hubTodayNoteUris: () => hubTodayNoteUris,
      switchTodayHubWorkspace: todayHubController.switchTodayHubWorkspace,
      bridgeRef: todayHubController.todayHubBridgeRef,
    }),
    [
      hubTodayNoteUris,
      todayHubController.switchTodayHubWorkspace,
      todayHubController.todayHubBridgeRef,
    ],
  );

  useOpenReminderNavigation({
    openMarkdownInEditor,
    inboxEditorRef,
    initialVaultHydrateAttemptDone,
    hubBridge: todayHubReminderBridge,
  });

  const reminderPane = useReminderPane(vaultRoot ?? null, hubTodayNoteUris);

  const onOpenReminder = useCallback(
    (noteUri: string, reminderId: string, uiCaretHint?: number) => {
      void navigateToReminder(
        {noteUri, reminderId, uiCaretHint},
        openMarkdownInEditor,
        inboxEditorRef,
        todayHubReminderBridge,
      );
    },
    [openMarkdownInEditor, inboxEditorRef, todayHubReminderBridge],
  );

  const titleBarActions = useAppTitleBarVaultActions({
    vaultRoot,
    busy,
    composingNewEntry,
    paletteLayer,
    selectNoteInNewActiveTab,
    startNewEntry,
    composeDraftMarkdown,
  });

  const handleMuteLinkSnippetDomain = useLinkSnippetSettingsWriter({
    vaultRoot,
    vaultSettings,
    fs,
    setVaultSettings,
  });

  const appRootClassName = useAppRootClassName(
    vaultRoot,
    layoutsReady,
    maximized,
    tiling,
    tilingDebug,
  );

  const titleBarTodayHubSelect = useAppTitleBarTodayHubSelect({
    vaultRoot,
    todayHubSelectorItems: todayHubController.todayHubSelectorItems,
    activeTodayHubUri: todayHubController.activeTodayHubUri,
    workspaceSelectorSubLabel: todayHubController.workspaceSelectorSubLabel,
    workspaceSelectShowsActiveTabPill: todayHubController.workspaceSelectShowsActiveTabPill,
    focusActiveTodayHubNote: todayHubController.focusActiveTodayHubNote,
    switchTodayHubWorkspace: todayHubController.switchTodayHubWorkspace,
    openTodayHubInNewTabAfterActive: titleBarActions.openTodayHubInNewTabAfterActive,
    openWorkspaceHomeCurrentInBackgroundTab:
      todayHubController.openWorkspaceHomeCurrentInBackgroundTab,
  });

  useEditorHistoryMouseButtons({
    vaultRoot,
    busy,
    editorHistoryCanGoBack: tabsController.editorHistoryCanGoBack,
    editorHistoryCanGoForward: tabsController.editorHistoryCanGoForward,
    editorHistoryGoBack: tabsController.editorHistoryGoBack,
    editorHistoryGoForward: tabsController.editorHistoryGoForward,
  });
  usePreventMiddleClickPaste();

  const podcastPlayback = useAppPodcastPlayback({
    vaultRoot,
    fs,
    podcastFsNonce,
    setErr,
    deviceInstanceId,
    vaultSettings,
    err,
    diskConflict,
    diskConflictSoft,
    renameLinkProgress,
    wikiRenameNotice,
  });

  useAppTauriDocumentChrome(maximized, tiling);

  useDesktopPlaylistR2EtagPollingForMainWindow({
    allowPolling: !podcastPlayback.desktopPlayback.localPlaybackActive,
    deviceInstanceId,
    onRemotePlaylistChanged: podcastPlayback.bumpPlaylistDiskRevision,
    onRemotePlaylistCleared: podcastPlayback.bumpPlaylistDiskRevision,
    vaultRoot,
    vaultSettings,
  });

  useAppOnMountLayoutHydration({
    setLayouts,
    setLayoutsReady,
    setPaneVisibility,
    setRestoredInboxState,
  });

  const desktopPlaybackRef = useLiveRef(podcastPlayback.desktopPlayback);
  useAppMediaControlDesktopPlayback(desktopPlaybackRef);

  useAppDebouncedPersistMainWindowUi({
    vaultRoot,
    inboxShellRestored,
    paneVisibility: paneVisibilityState,
    composingNewEntry,
    composeDraftMarkdown,
    selectedUri,
    activeTodayHubUri: todayHubController.persistenceActiveTodayHubUri,
    persistenceTodayHubWorkspaces: todayHubController.persistenceTodayHubWorkspaces,
    vaultMarkdownRefs,
    editorWorkspaceTabs: tabsController.editorWorkspaceTabs,
    activeEditorTabId: tabsController.activeEditorTabId,
  });

  const pickFolder = useAppPickFolder({
    setErr,
    hydrateVault,
    setActivePage,
  });

  const {
    persistMainLeftWidthPx,
    persistVaultEpisodesStackTopHeightPx,
    persistNotificationsInboxStackTopHeightPx,
    persistNotificationsWidthPx,
  } = useAppLayoutWidthPersisters(setLayouts);

  useAppTauriCloseAndFocusSave(flushInboxSave);

  const chromeSession = useAppMainWindowChromeSession({
    vaultRoot,
    busy,
    canReopenClosedEditorTab: tabsController.canReopenClosedEditorTab,
    reopenLastClosedEditorTab: tabsController.reopenLastClosedEditorTab,
    composingNewEntry,
    selectedUri,
    onCleanNoteInbox,
    quickOpenOpen: paletteLayer.quickOpenOpen,
    setQuickOpenOpen: paletteLayer.setQuickOpenOpen,
    vaultSearchOpen: paletteLayer.vaultSearchOpen,
    setVaultSearchOpen: paletteLayer.setVaultSearchOpen,
    onAddEntry: titleBarActions.openAddToInbox,
    err,
    diskConflict,
    diskConflictSoft: diskConflictSoft as {uri: string} | null,
    statusBarCenter: podcastPlayback.statusBarCenter,
    renameLinkProgress,
    saveSettledNonce,
    desktopPlaybackRef,
    flushInboxSave,
    setPaneVisibility,
  });

  if (!vaultRoot) {
    return (
      <AppNoVaultSetupScreen
        appRootRef={appRootRef}
        appRootClassName={appRootClassName}
        vaultSettings={vaultSettings}
        setVaultSettings={setVaultSettings}
        fs={fs}
        tiling={tiling}
        closeSyncing={chromeSession.gitSync.manualGitSync.running}
        onCloseRequest={chromeSession.gitSync.handleWindowCloseRequest}
        closeSyncInProgress={chromeSession.gitSync.closeSyncInProgress}
        notificationItems={chromeSession.notifications.items}
        onDismissNotification={chromeSession.notifications.dismissItem}
        settingsName={settingsName}
        busy={busy}
        err={err}
        onPickFolder={pickFolder}
      />
    );
  }

  if (!layoutsReady) {
    return (
      <AppLayoutsLoadingScreen
        appRootRef={appRootRef}
        appRootClassName={appRootClassName}
        vaultRoot={vaultRoot}
        vaultSettings={vaultSettings}
        setVaultSettings={setVaultSettings}
        fs={fs}
        tiling={tiling}
        closeSyncing={chromeSession.gitSync.manualGitSync.running}
        onCloseRequest={chromeSession.gitSync.handleWindowCloseRequest}
        closeSyncInProgress={chromeSession.gitSync.closeSyncInProgress}
        notificationItems={chromeSession.notifications.items}
        onDismissNotification={chromeSession.notifications.dismissItem}
      />
    );
  }

  const ws = getAppMainWindowWorkspaceBindings(workspace);

  return (
    <AppVaultReadyRoot
      appRootRef={appRootRef}
      appRootClassName={appRootClassName}
      vaultRoot={ws.vaultRoot}
      vaultSettings={ws.vaultSettings}
      setVaultSettings={ws.setVaultSettings}
      fs={fs}
      fsRefreshNonce={ws.fsRefreshNonce}
      inboxEditorRef={inboxEditorRef}
      inboxEditorShellScrollRef={inboxEditorShellScrollRef}
      workspace={ws.workspace}
      paneVisibility={paneVisibility}
      layouts={layouts}
      persistMainLeftWidthPx={persistMainLeftWidthPx}
      persistVaultEpisodesStackTopHeightPx={persistVaultEpisodesStackTopHeightPx}
      persistNotificationsInboxStackTopHeightPx={persistNotificationsInboxStackTopHeightPx}
      persistNotificationsWidthPx={persistNotificationsWidthPx}
      activePage={activePage}
      setActivePage={setActivePage}
      pickFolder={pickFolder}
      tiling={tiling}
      titleBarTodayHubSelect={titleBarTodayHubSelect}
      titleBarEditorTabsHost={titleBarEditorTabsHost}
      setTitleBarEditorTabsHost={setTitleBarEditorTabsHost}
      onTitleBarQuickOpen={titleBarActions.handleTitleBarQuickOpen}
      onTitleBarAddToInbox={titleBarActions.handleTitleBarAddToInbox}
      titleBarTabActionsDisabled={titleBarActions.titleBarTabActionsDisabled}
      openAddToInbox={titleBarActions.openAddToInbox}
      busy={ws.busy}
      chromeSession={chromeSession}
      podcastPlayback={podcastPlayback}
      paletteLayer={paletteLayer}
      vaultMarkdownRefs={ws.vaultMarkdownRefs}
      onPickNoteQuickOpen={uri =>
        ws.selectNoteInNewActiveTab(uri, {insertAfterActive: true})
      }
      onPickNoteVaultSearch={ws.selectNote}
      selectedUri={ws.selectedUri}
      err={ws.err}
      diskConflict={ws.diskConflict}
      diskConflictSoft={ws.diskConflictSoft}
      resolveDiskConflictReloadFromDisk={ws.resolveDiskConflictReloadFromDisk}
      resolveDiskConflictKeepLocal={ws.resolveDiskConflictKeepLocal}
      elevateDiskConflictSoftToBlocking={ws.elevateDiskConflictSoftToBlocking}
      dismissDiskConflictSoft={ws.dismissDiskConflictSoft}
      enterDiskConflictMergeView={ws.enterDiskConflictMergeView}
      onMuteLinkSnippetDomain={handleMuteLinkSnippetDomain}
      reminderItems={reminderPane.rows}
      reminders={reminderPane.reminders}
      hasDueReminders={reminderPane.hasDueReminders}
      onOpenReminder={onOpenReminder}
      onRemoveReminder={reminderPane.removeReminder}
      onSnoozeReminder={reminderPane.snoozeReminder}
    />
  );
}

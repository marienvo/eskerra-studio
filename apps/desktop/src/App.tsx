/**
 * Desktop app root: window chrome, global shortcuts, vault session, and shell around `VaultTab`.
 *
 * Ownership: app-level orchestration and Tauri window integration; vault editing behavior is in `VaultTab` / workspace hook.
 */
import {useCallback, useMemo, useState, useRef} from 'react';

import type {NoteMarkdownEditorHandle} from './editor/noteEditor/NoteMarkdownEditor';
import {WindowTitleBar} from './components/WindowTitleBar';
import {useAppPodcastPlayback} from './hooks/useAppPodcastPlayback';
import {useDesktopPlaylistR2EtagPollingForMainWindow} from './hooks/useDesktopPlaylistR2EtagPolling';
import {useTauriWindowMaximized} from './hooks/useTauriWindowMaximized';
import {useTauriWindowTiling} from './hooks/useTauriWindowTiling';
import {useEditorHistoryMouseButtons} from './hooks/useEditorHistoryMouseButtons';
import {useMainWindowWorkspace} from './hooks/useMainWindowWorkspace';
import {usePreventMiddleClickPaste} from './hooks/usePreventMiddleClickPaste';
import {ThemedChromeBackground} from './theme/ThemedChromeBackground';
import {
  DEFAULT_LAYOUTS,
  type StoredLayouts,
} from './lib/layout/layoutStore';
import type {RestoredInboxState} from './lib/mainWindowUiStore';
import {useLiveRef} from './hooks/useLiveRef';
import {createTauriVaultFilesystem} from './lib/tauriVault';
import {AppThemeShell} from './shell/AppThemeShell';
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
import {AppChromeOverlays} from './shell/mainWindow/AppChromeOverlays';
import {AppStatusBarSection} from './shell/mainWindow/AppStatusBarSection';
import {AppLayoutsLoadingScreen} from './shell/mainWindow/AppLayoutsLoadingScreen';
import {AppNoVaultSetupScreen} from './shell/mainWindow/AppNoVaultSetupScreen';
import {useLinkSnippetSettingsWriter} from './shell/mainWindow/useLinkSnippetSettingsWriter';
import {AppMainStage} from './shell/mainWindow/AppMainStage';
import {MainWindowVaultTab} from './shell/mainWindow/MainWindowVaultTab';
import {useAppMainWindowChromeSession} from './shell/mainWindow/useAppMainWindowChromeSession';
import {AppPaletteLayer} from './shell/mainWindow/AppPaletteLayer';
import {useAppPaletteLayerState} from './shell/mainWindow/useAppPaletteLayerState';

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
  const {
    vaultRoot,
    vaultSettings,
    setVaultSettings,
    settingsName,
    busy,
    fsRefreshNonce,
    podcastFsNonce,
    deviceInstanceId,
    hydrateVault,
    inboxShellRestored,
    selectionController: {
      selectedUri,
      composeDraftMarkdown,
      composingNewEntry,
      startNewEntry,
      selectNote,
      selectNoteInNewActiveTab,
      vaultMarkdownRefs,
    },
    persistenceController: {
      onCleanNoteInbox,
      flushInboxSave,
      saveSettledNonce,
    },
    notificationsState: {
      err,
      setErr,
      wikiRenameNotice,
      renameLinkProgress,
    },
    conflictController: {
      diskConflict,
      resolveDiskConflictReloadFromDisk,
      resolveDiskConflictKeepLocal,
      diskConflictSoft,
      elevateDiskConflictSoftToBlocking,
      dismissDiskConflictSoft,
      enterDiskConflictMergeView,
    },
    tabsController,
    todayHubController: {
      todayHubSelectorItems,
      activeTodayHubUri,
      persistenceActiveTodayHubUri,
      persistenceTodayHubWorkspaces,
      switchTodayHubWorkspace,
      focusActiveTodayHubNote,
      workspaceSelectorSubLabel,
      workspaceSelectShowsActiveTabPill,
      openWorkspaceHomeCurrentInBackgroundTab,
    },
  } = workspace;

  const openTodayHubInNewTabAfterActive = useCallback(
    (uri: string) => {
      selectNoteInNewActiveTab(uri, {insertAfterActive: true});
    },
    [selectNoteInNewActiveTab],
  );

  const openAddToInbox = useCallback(() => {
    startNewEntry(composeDraftMarkdown);
  }, [composeDraftMarkdown, startNewEntry]);

  const paletteLayer = useAppPaletteLayerState();

  const titleBarTabActionsDisabled = !vaultRoot || busy || composingNewEntry;

  const handleTitleBarQuickOpen = useCallback(() => {
    if (!vaultRoot || busy || composingNewEntry) {
      return;
    }
    if (paletteLayer.quickOpenOpen || paletteLayer.vaultSearchOpen) {
      return;
    }
    paletteLayer.setQuickOpenOpen(true);
  }, [vaultRoot, busy, composingNewEntry, paletteLayer]);

  const handleTitleBarAddToInbox = useCallback(() => {
    if (!vaultRoot || busy || composingNewEntry) {
      return;
    }
    if (paletteLayer.quickOpenOpen || paletteLayer.vaultSearchOpen) {
      return;
    }
    openAddToInbox();
  }, [vaultRoot, busy, composingNewEntry, paletteLayer, openAddToInbox]);

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
    todayHubSelectorItems,
    activeTodayHubUri,
    workspaceSelectorSubLabel,
    workspaceSelectShowsActiveTabPill,
    focusActiveTodayHubNote,
    switchTodayHubWorkspace,
    openTodayHubInNewTabAfterActive,
    openWorkspaceHomeCurrentInBackgroundTab,
  });

  const paneVisibility = usePaneVisibility();
  const {visibility: paneVisibilityState, setVisibility: setPaneVisibility} =
    paneVisibility;
  const [titleBarEditorTabsHost, setTitleBarEditorTabsHost] = useState<HTMLDivElement | null>(
    null,
  );
  useEditorHistoryMouseButtons({
    vaultRoot,
    busy,
    editorHistoryCanGoBack: tabsController.editorHistoryCanGoBack,
    editorHistoryCanGoForward: tabsController.editorHistoryCanGoForward,
    editorHistoryGoBack: tabsController.editorHistoryGoBack,
    editorHistoryGoForward: tabsController.editorHistoryGoForward,
  });
  usePreventMiddleClickPaste();

  const [layouts, setLayouts] = useState<StoredLayouts>(DEFAULT_LAYOUTS);

  const {
    podcastCatalog,
    rssSyncing,
    rssSyncPercent,
    handleEpisodesRssSync,
    desktopPlayback,
    toolbarNowPlaying,
    playbackTransport,
    statusBarCenter,
    bumpPlaylistDiskRevision,
  } = useAppPodcastPlayback({
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
    allowPolling: !desktopPlayback.localPlaybackActive,
    deviceInstanceId,
    onRemotePlaylistChanged: bumpPlaylistDiskRevision,
    onRemotePlaylistCleared: bumpPlaylistDiskRevision,
    vaultRoot,
    vaultSettings,
  });

  useAppOnMountLayoutHydration({
    setLayouts,
    setLayoutsReady,
    setPaneVisibility,
    setRestoredInboxState,
  });

  const desktopPlaybackRef = useLiveRef(desktopPlayback);

  useAppMediaControlDesktopPlayback(desktopPlaybackRef);

  useAppDebouncedPersistMainWindowUi({
    vaultRoot,
    inboxShellRestored,
    paneVisibility: paneVisibilityState,
    composingNewEntry,
    composeDraftMarkdown,
    selectedUri,
    activeTodayHubUri: persistenceActiveTodayHubUri,
    persistenceTodayHubWorkspaces,
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

  const {
    notifications: {
      items: notificationItems,
      dismissItem: dismissNotification,
      clearAll: clearAllNotifications,
      highlightId: notificationHighlightId,
    },
    gitSync: {
      manualGitSync,
      manualSyncUnavailable,
      manualSyncLabel,
      gitStatusForDisplay,
      gitAutosyncCountdownTime,
      transientGitStatus,
      currentGitBranchLoading,
      gitStatusLoading,
      currentGitDetachedHead,
      currentGitBranchError,
      gitStatusError,
      handleWindowCloseRequest,
      closeSyncInProgress,
    },
  } = useAppMainWindowChromeSession({
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
    onAddEntry: openAddToInbox,
    err,
    diskConflict,
    diskConflictSoft: diskConflictSoft as {uri: string} | null,
    statusBarCenter,
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
        closeSyncing={manualGitSync.running}
        onCloseRequest={handleWindowCloseRequest}
        closeSyncInProgress={closeSyncInProgress}
        notificationItems={notificationItems}
        onDismissNotification={dismissNotification}
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
        closeSyncing={manualGitSync.running}
        onCloseRequest={handleWindowCloseRequest}
        closeSyncInProgress={closeSyncInProgress}
        notificationItems={notificationItems}
        onDismissNotification={dismissNotification}
      />
    );
  }

  return (
    <AppThemeShell
      vaultRoot={vaultRoot}
      vaultSettings={vaultSettings}
      setVaultSettings={setVaultSettings}
      fs={fs}>
      <div ref={appRootRef} className={appRootClassName}>
        <ThemedChromeBackground />
        <AppChromeOverlays placement="closeSync" closeSyncInProgress={closeSyncInProgress} />
        <div className="app-root-chrome">
          <WindowTitleBar
            tiling={tiling}
            onEditorTabsHostRef={setTitleBarEditorTabsHost}
            todayHubSelect={titleBarTodayHubSelect}
            closeSyncing={manualGitSync.running}
            onCloseRequest={handleWindowCloseRequest}
          />

          <AppMainStage
            activePage={activePage}
            onCloseSettings={() => setActivePage('vault')}
            settingsPageProps={{
              vaultRoot,
              fs,
              vaultSettings,
              setVaultSettings,
              onChangeVaultFolder: pickFolder,
            }}
          >
            <MainWindowVaultTab
              vaultRoot={vaultRoot}
              vaultSettings={vaultSettings}
              fs={fs}
              fsRefreshNonce={fsRefreshNonce}
              inboxEditorRef={inboxEditorRef}
              inboxEditorShellScrollRef={inboxEditorShellScrollRef}
              workspace={workspace}
              paneVisibility={paneVisibility}
              layouts={layouts}
              persistMainLeftWidthPx={persistMainLeftWidthPx}
              persistVaultEpisodesStackTopHeightPx={persistVaultEpisodesStackTopHeightPx}
              persistNotificationsInboxStackTopHeightPx={persistNotificationsInboxStackTopHeightPx}
              persistNotificationsWidthPx={persistNotificationsWidthPx}
              titleBarEditorTabsHost={titleBarEditorTabsHost}
              onTitleBarQuickOpen={handleTitleBarQuickOpen}
              onTitleBarAddToInbox={handleTitleBarAddToInbox}
              titleBarTabActionsDisabled={titleBarTabActionsDisabled}
              onAddEntry={openAddToInbox}
              busy={busy}
              notificationItems={notificationItems}
              notificationHighlightId={notificationHighlightId}
              dismissNotification={dismissNotification}
              clearAllNotifications={clearAllNotifications}
              playbackTransport={playbackTransport}
              toolbarNowPlaying={toolbarNowPlaying}
              podcastCatalog={podcastCatalog}
              desktopPlayback={desktopPlayback}
              handleEpisodesRssSync={handleEpisodesRssSync}
              rssSyncing={rssSyncing}
              rssSyncPercent={rssSyncPercent}
              onMuteLinkSnippetDomain={handleMuteLinkSnippetDomain}
            />
          </AppMainStage>

          <AppChromeOverlays
            placement="stage"
            err={err}
            diskConflict={diskConflict}
            diskConflictSoft={diskConflictSoft as {uri: string} | null}
            selectedUri={selectedUri}
            enterDiskConflictMergeView={enterDiskConflictMergeView}
            resolveDiskConflictReloadFromDisk={resolveDiskConflictReloadFromDisk}
            resolveDiskConflictKeepLocal={resolveDiskConflictKeepLocal}
            elevateDiskConflictSoftToBlocking={elevateDiskConflictSoftToBlocking}
            dismissDiskConflictSoft={dismissDiskConflictSoft}
            notificationItems={notificationItems}
            onDismissNotification={dismissNotification}
          />

          <AppStatusBarSection
            onOpenSettings={() => setActivePage('settings')}
            onManualSync={() => {
              manualGitSync.run().catch(() => undefined);
            }}
            manualSyncBusy={manualGitSync.running}
            manualSyncDisabled={manualSyncUnavailable}
            manualSyncLabel={manualSyncLabel}
            gitStatus={gitStatusForDisplay}
            gitStatusLoading={gitStatusLoading}
            currentGitBranchLoading={currentGitBranchLoading}
            currentGitDetachedHead={currentGitDetachedHead}
            gitStatusError={gitStatusError}
            currentGitBranchError={currentGitBranchError}
            transientGitStatus={transientGitStatus}
            gitAutosyncCountdownTime={gitAutosyncCountdownTime}
          />
          <AppPaletteLayer
            vaultRoot={vaultRoot}
            vaultMarkdownRefs={vaultMarkdownRefs}
            onPickNote={selectNote}
            {...paletteLayer}
          />
        </div>
      </div>
    </AppThemeShell>
  );
}

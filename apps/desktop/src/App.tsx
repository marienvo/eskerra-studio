/**
 * Desktop app root: window chrome, global shortcuts, vault session, and shell around `VaultTab`.
 *
 * Ownership: app-level orchestration and Tauri window integration; vault editing behavior is in `VaultTab` / workspace hook.
 */
import {isTauri} from '@tauri-apps/api/core';
import {open} from '@tauri-apps/plugin-dialog';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {SettingsPage} from './components/SettingsPage';
import {DesktopStartupSplash} from './components/DesktopStartupSplash';
import {QuickOpenNotePalette} from './components/QuickOpenNotePalette';
import {VaultSearchPalette} from './components/VaultSearchPalette';
import {VaultTab} from './components/VaultTab.tsx';
import type {NoteMarkdownEditorHandle} from './editor/noteEditor/NoteMarkdownEditor';
import {EpisodesPane} from './components/EpisodesPane';
import {
  APP_SHELL_TAGLINE,
  AppSetupTagline,
  AppStatusBar,
} from './components/AppStatusBar';
import {ToastStack} from './components/ToastStack';
import type {PlaybackTransportProps} from './components/PlaybackTransport';
import {WindowTitleBar} from './components/WindowTitleBar';
import {useDesktopPlaylistR2EtagPollingForMainWindow} from './hooks/useDesktopPlaylistR2EtagPolling';
import {useDesktopPodcastCatalog} from './hooks/useDesktopPodcastCatalog';
import {useDesktopPodcastPlayback} from './hooks/useDesktopPodcastPlayback';
import {clearPodcastMarkdownFileContentCache} from './lib/podcasts/podcastPhase1Desktop';
import {runDesktopPodcastRssSync} from './lib/podcasts/podcastRssSyncDesktop';
import {useTauriWindowMaximized} from './hooks/useTauriWindowMaximized';
import {useTauriWindowTiling} from './hooks/useTauriWindowTiling';
import {useEditorHistoryMouseButtons} from './hooks/useEditorHistoryMouseButtons';
import {useMainWindowWorkspace} from './hooks/useMainWindowWorkspace';
import {usePreventMiddleClickPaste} from './hooks/usePreventMiddleClickPaste';
import {ThemedChromeBackground} from './theme/ThemedChromeBackground';
import {
  defaultEskerraSettings,
  isVaultR2PlaylistConfigured,
  type EskerraSettings,
} from '@eskerra/core';

import {
  tabCurrentUri,
  tabsToStored,
  type EditorWorkspaceTab,
} from './lib/editorWorkspaceTabs';
import {
  DEFAULT_LAYOUTS,
  type StoredLayouts,
} from './lib/layoutStore';
import {formatPlaybackMs} from './lib/formatPlaybackMs';
import {
  DEFAULT_MAIN_WINDOW_PANE_VISIBILITY,
  saveMainWindowUi,
  type StoredMainWindowInbox,
  type StoredMainWindowUi,
  type TodayHubWorkspaceSnapshot,
} from './lib/mainWindowUiStore';
import {
  resolveAppStatusBarCenter,
} from './lib/resolveAppStatusBarCenter';
import {createTauriVaultFilesystem} from './lib/tauriVault';
import {writeVaultSettings} from './lib/vaultBootstrap';
import {AppThemeShell} from './shell/AppThemeShell';
import {useAppLayoutWidthPersisters} from './shell/useAppLayoutWidthPersisters';
import {useAppMainWindowKeyboardEffects} from './shell/useAppMainWindowKeyboardEffects';
import {useAppMediaControlDesktopPlayback} from './shell/useAppMediaControlDesktopPlayback';
import {useAppNotificationSession} from './shell/useAppNotificationSession';
import {useAppOnMountLayoutHydration} from './shell/useAppOnMountLayoutHydration';
import {useAppRootClassName} from './shell/useAppRootClassName';
import {
  useAppStartupSplashPhases,
  type StartupSplashPhase,
} from './shell/useAppStartupSplashPhases';
import {useAppTauriCloseAndFocusSave} from './shell/useAppTauriCloseAndFocusSave';
import {useAppTauriDocumentChrome} from './shell/useAppTauriDocumentChrome';
import {useAppTitleBarTodayHubSelect} from './shell/useAppTitleBarTodayHubSelect';
import {AppDiskConflictBanners} from './shell/AppDiskConflictBanners';

import './App.css';

type AppPage = 'vault' | 'settings';

const PLAYBACK_SKIP_MS = 10_000;

type AppPodcastPlaybackRegionArgs = {
  vaultRoot: string | null;
  fs: ReturnType<typeof createTauriVaultFilesystem>;
  podcastFsNonce: number;
  setErr: (err: string | null) => void;
  deviceInstanceId: string | null;
  vaultSettings: EskerraSettings | null;
  err: string | null;
  diskConflict: unknown;
  diskConflictSoft: unknown;
  renameLinkProgress: {done: number; total: number} | null;
  wikiRenameNotice: string | null;
};

function useAppPodcastPlaybackRegion({
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
}: AppPodcastPlaybackRegionArgs) {
  const [playlistDiskRevision, setPlaylistDiskRevision] = useState(0);
  const bumpPlaylistDiskRevision = useCallback(() => {
    setPlaylistDiskRevision(r => r + 1);
  }, []);

  const podcastCatalog = useDesktopPodcastCatalog({
    vaultRoot,
    fs,
    fsRefreshNonce: podcastFsNonce,
    onError: setErr,
  });

  const rssSyncingRef = useRef(false);
  const [rssSyncing, setRssSyncing] = useState(false);
  const [rssSyncPercent, setRssSyncPercent] = useState<number | null>(null);

  const handleEpisodesRssSync = useCallback(async () => {
    if (vaultRoot == null || rssSyncingRef.current) {
      return;
    }
    rssSyncingRef.current = true;
    setRssSyncing(true);
    setRssSyncPercent(null);
    try {
      await runDesktopPodcastRssSync(vaultRoot, fs, {
        onProgress: payload => {
          const n = payload.percent;
          if (Number.isFinite(n) && n >= 0 && n <= 100) {
            setRssSyncPercent(n);
          }
        },
      });
      clearPodcastMarkdownFileContentCache();
      await podcastCatalog.refreshPodcasts(true);
    } catch {
      // Errors per-file are already logged inside runDesktopPodcastRssSync.
    } finally {
      rssSyncingRef.current = false;
      setRssSyncing(false);
      setRssSyncPercent(null);
    }
  }, [vaultRoot, fs, podcastCatalog]);

  const consumeCatalogReady = Boolean(vaultRoot) && !podcastCatalog.catalogLoading;

  const desktopPlayback = useDesktopPodcastPlayback({
    consumeCatalogReady,
    consumeEpisodes: podcastCatalog.episodes,
    deviceInstanceId: deviceInstanceId ?? '',
    fs,
    onCatalogRefresh: () => podcastCatalog.refreshPodcasts(false),
    onError: setErr,
    onPlaylistDiskUpdated: bumpPlaylistDiskRevision,
    playlistRevision: playlistDiskRevision,
    r2PlaylistConfigured: isVaultR2PlaylistConfigured(
      vaultSettings ?? defaultEskerraSettings,
    ),
    vaultRoot,
  });

  const toolbarNowPlaying = useMemo(() => {
    if (desktopPlayback.activeEpisode == null) {
      return null;
    }
    return {
      episodeTitle: desktopPlayback.activeEpisode.title,
      seriesName: desktopPlayback.activeEpisode.seriesName,
    };
  }, [desktopPlayback.activeEpisode]);

  const playbackTransport = useMemo((): PlaybackTransportProps | undefined => {
    if (desktopPlayback.activeEpisode == null) {
      return undefined;
    }
    const seek = desktopPlayback.seekBy;
    return {
      positionLabel: formatPlaybackMs(desktopPlayback.positionMs),
      durationLabel: formatPlaybackMs(desktopPlayback.durationMs),
      seekDisabled: desktopPlayback.seekDisabled,
      playControl: desktopPlayback.playbackTransportPlayControl,
      onSeekBack: () => void seek(-PLAYBACK_SKIP_MS),
      onSeekForward: () => void seek(PLAYBACK_SKIP_MS),
      onTogglePlay: () => desktopPlayback.togglePause(),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- granular playback fields below; hook return object is unstable
  }, [
    desktopPlayback.activeEpisode,
    desktopPlayback.durationMs,
    desktopPlayback.playbackTransportPlayControl,
    desktopPlayback.positionMs,
    desktopPlayback.seekBy,
    desktopPlayback.seekDisabled,
    desktopPlayback.togglePause,
  ]);

  const statusBarCenter = useMemo(
    () =>
      resolveAppStatusBarCenter({
        err,
        diskConflict: diskConflict != null,
        diskConflictSoft: diskConflictSoft != null,
        renameLinkProgress,
        wikiRenameNotice,
        playerLabel: desktopPlayback.playerLabel,
        activeEpisode: desktopPlayback.activeEpisode,
        tagline: APP_SHELL_TAGLINE,
      }),
    [
      err,
      diskConflict,
      diskConflictSoft,
      renameLinkProgress,
      wikiRenameNotice,
      desktopPlayback.playerLabel,
      desktopPlayback.activeEpisode,
    ],
  );

  return {
    podcastCatalog,
    rssSyncing,
    rssSyncPercent,
    handleEpisodesRssSync,
    desktopPlayback,
    toolbarNowPlaying,
    playbackTransport,
    statusBarCenter,
    bumpPlaylistDiskRevision,
  };
}

type UseAppDebouncedPersistMainWindowUiArgs = {
  vaultRoot: string | null;
  inboxShellRestored: boolean;
  vaultPaneVisible: boolean;
  episodesPaneVisible: boolean;
  inboxPaneVisible: boolean;
  notificationsPanelVisible: boolean;
  composingNewEntry: boolean;
  selectedUri: string | null;
  editorWorkspaceTabs: readonly EditorWorkspaceTab[];
  activeEditorTabId: string | null;
  activeTodayHubUri: string | null;
  todayHubWorkspacesForSave: Record<string, TodayHubWorkspaceSnapshot> | null;
};

function useAppDebouncedPersistMainWindowUi({
  vaultRoot,
  inboxShellRestored,
  vaultPaneVisible,
  episodesPaneVisible,
  inboxPaneVisible,
  notificationsPanelVisible,
  composingNewEntry,
  selectedUri,
  editorWorkspaceTabs,
  activeEditorTabId,
  activeTodayHubUri,
  todayHubWorkspacesForSave,
}: UseAppDebouncedPersistMainWindowUiArgs) {
  useEffect(() => {
    if (!vaultRoot || !inboxShellRestored) {
      return;
    }
    const inbox: StoredMainWindowInbox = {
      composingNewEntry,
      selectedUri,
      openTabUris: editorWorkspaceTabs
        .map(t => tabCurrentUri(t))
        .filter((u): u is string => u != null),
      editorWorkspaceTabs: tabsToStored(editorWorkspaceTabs),
      activeEditorTabId,
      activeTodayHubUri,
    };
    if (todayHubWorkspacesForSave != null) {
      inbox.todayHubWorkspaces = todayHubWorkspacesForSave;
    }
    const payload: StoredMainWindowUi = {
      vaultRoot,
      vaultPaneVisible,
      episodesPaneVisible,
      inboxPaneVisible,
      notificationsPanelVisible,
      inbox,
    };
    const t = window.setTimeout(() => {
      void saveMainWindowUi(payload);
    }, 200);
    return () => {
      window.clearTimeout(t);
    };
  }, [
    vaultRoot,
    vaultPaneVisible,
    episodesPaneVisible,
    inboxPaneVisible,
    notificationsPanelVisible,
    selectedUri,
    composingNewEntry,
    editorWorkspaceTabs,
    activeEditorTabId,
    activeTodayHubUri,
    todayHubWorkspacesForSave,
    inboxShellRestored,
  ]);
}

export default function App() {
  const {maximized} = useTauriWindowMaximized();
  const {tiling, tilingDebug} = useTauriWindowTiling();

  const appRootRef = useRef<HTMLDivElement>(null);
  const fs = useMemo(() => createTauriVaultFilesystem(), []);
  const inboxEditorRef = useRef<NoteMarkdownEditorHandle | null>(null);
  const inboxEditorShellScrollRef = useRef<HTMLDivElement | null>(null);
  const [layoutsReady, setLayoutsReady] = useState(false);
  const [activePage, setActivePage] = useState<AppPage>('vault');
  const [restoredInboxState, setRestoredInboxState] = useState<{
    vaultRoot: string;
    composingNewEntry: boolean;
    selectedUri: string | null;
    openTabUris?: readonly string[];
    editorWorkspaceTabs?: ReadonlyArray<{
      id: string;
      entries: string[];
      index: number;
    }>;
    activeEditorTabId?: string | null;
    activeTodayHubUri?: string | null;
    todayHubWorkspaces?: Record<string, TodayHubWorkspaceSnapshot> | null;
  } | null>(null);
  const {
    vaultRoot,
    vaultSettings,
    setVaultSettings,
    settingsName,
    busy,
    selectionController: workspaceSelectionController,
    frontmatterController: workspaceFrontmatterController,
    notificationsState: workspaceNotificationsState,
    conflictController: workspaceConflictController,
    fsRefreshNonce,
    podcastFsNonce,
    deviceInstanceId,
    hydrateVault,
    persistenceController: workspacePersistenceController,
    linkController: workspaceLinkController,
    treeController: workspaceTreeController,
    inboxShellRestored,
    initialVaultHydrateAttemptDone,
    tabsController: workspaceTabsController,
    todayHubController: workspaceTodayHubController,
  } = useMainWindowWorkspace({
    fs,
    inboxEditorRef,
    inboxEditorShellScrollRef,
    restoredInboxState,
    inboxRestoreEnabled: layoutsReady,
  });
  const {
    notes,
    selectedUri,
    editorBody,
    setEditorBody,
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
  } = workspaceSelectionController;
  const {
    inboxYamlFrontmatterInner,
    applyFrontmatterInnerChange,
  } = workspaceFrontmatterController;
  const {
    deleteNote,
    renameNote,
    deleteFolder,
    renameFolder,
    moveVaultTreeItem,
    bulkDeleteVaultTreeItems,
    bulkMoveVaultTreeItems,
    vaultTreeSelectionClearNonce,
  } = workspaceTreeController;
  const {
    onInboxSaveShortcut,
    onCleanNoteInbox,
    flushInboxSave,
  } = workspacePersistenceController;
  const {
    err,
    setErr,
    wikiRenameNotice,
    renameLinkProgress,
    pendingWikiLinkAmbiguityRename,
    confirmPendingWikiLinkAmbiguityRename,
    cancelPendingWikiLinkAmbiguityRename,
  } = workspaceNotificationsState;
  const {
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
  } = workspaceConflictController;
  const {
    showTodayHubCanvas,
    todayHubSettings,
    todayHubBridgeRef,
    todayHubWikiNavParentRef,
    todayHubCellEditorRef,
    prehydrateTodayHubRows,
    persistTodayHubRow,
    todayHubCleanRowBlocked,
    todayHubSelectorItems,
    activeTodayHubUri,
    todayHubWorkspacesForSave,
    switchTodayHubWorkspace,
    focusActiveTodayHubNote,
    workspaceSelectShowsActiveTabPill,
  } = workspaceTodayHubController;

  const openTodayHubInNewTabAfterActive = useCallback(
    (uri: string) => {
      selectNoteInNewActiveTab(uri, {insertAfterActive: true});
    },
    [selectNoteInNewActiveTab],
  );

  const handleMuteLinkSnippetDomain = useCallback(
    async (domain: string) => {
      if (!vaultRoot || !vaultSettings) return;
      const current = new Set(vaultSettings.linkSnippetBlockedDomains ?? []);
      if (current.has(domain)) return;
      current.add(domain);
      const next = {...vaultSettings, linkSnippetBlockedDomains: [...current]};
      setVaultSettings(next);
      await writeVaultSettings(vaultRoot, fs, next);
    },
    [vaultRoot, vaultSettings, fs, setVaultSettings],
  );

  const appRootClassName = useAppRootClassName(
    vaultRoot,
    layoutsReady,
    maximized,
    tiling,
    tilingDebug,
  );

  const titleBarTodayHubSelect = useAppTitleBarTodayHubSelect(
    vaultRoot,
    todayHubSelectorItems,
    activeTodayHubUri,
    workspaceSelectShowsActiveTabPill,
    focusActiveTodayHubNote,
    switchTodayHubWorkspace,
    openTodayHubInNewTabAfterActive,
  );

  const [vaultPaneVisible, setVaultPaneVisible] = useState(
    DEFAULT_MAIN_WINDOW_PANE_VISIBILITY.vaultPaneVisible,
  );
  const [episodesPaneVisible, setEpisodesPaneVisible] = useState(
    DEFAULT_MAIN_WINDOW_PANE_VISIBILITY.episodesPaneVisible,
  );
  const [inboxPaneVisible, setInboxPaneVisible] = useState(
    DEFAULT_MAIN_WINDOW_PANE_VISIBILITY.inboxPaneVisible,
  );
  const [titleBarEditorTabsHost, setTitleBarEditorTabsHost] = useState<HTMLDivElement | null>(
    null,
  );
  useEditorHistoryMouseButtons({
    vaultRoot,
    busy,
    editorHistoryCanGoBack: workspaceTabsController.editorHistoryCanGoBack,
    editorHistoryCanGoForward: workspaceTabsController.editorHistoryCanGoForward,
    editorHistoryGoBack: workspaceTabsController.editorHistoryGoBack,
    editorHistoryGoForward: workspaceTabsController.editorHistoryGoForward,
  });
  usePreventMiddleClickPaste();

  const [quickOpenOpen, setQuickOpenOpen] = useState(false);
  const [vaultSearchOpen, setVaultSearchOpen] = useState(false);

  useAppMainWindowKeyboardEffects({
    vaultRoot,
    busy,
    canReopenClosedEditorTab: workspaceTabsController.canReopenClosedEditorTab,
    reopenLastClosedEditorTab: workspaceTabsController.reopenLastClosedEditorTab,
    composingNewEntry,
    selectedUri,
    onCleanNoteInbox,
    quickOpenOpen,
    setQuickOpenOpen,
    vaultSearchOpen,
    setVaultSearchOpen,
  });

  const [layouts, setLayouts] = useState<StoredLayouts>(DEFAULT_LAYOUTS);
  const [notificationsPanelVisible, setNotificationsPanelVisible] = useState(true);
  const [startupSplashPhase, setStartupSplashPhase] = useState<StartupSplashPhase>(
    () => (!isTauri() ? 'done' : 'artwork'),
  );
  const [themeReady, setThemeReady] = useState(!isTauri());
  const onThemeReady = useCallback(() => setThemeReady(true), []);

  const appStartupReady = useMemo(
    () =>
      initialVaultHydrateAttemptDone &&
      layoutsReady &&
      themeReady &&
      (vaultRoot ? inboxShellRestored : true),
    [
      initialVaultHydrateAttemptDone,
      layoutsReady,
      themeReady,
      vaultRoot,
      inboxShellRestored,
    ],
  );

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
  } = useAppPodcastPlaybackRegion({
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
    setVaultPaneVisible,
    setEpisodesPaneVisible,
    setInboxPaneVisible,
    setNotificationsPanelVisible,
    setRestoredInboxState,
  });

  const desktopPlaybackRef = useRef(desktopPlayback);
  useLayoutEffect(() => {
    desktopPlaybackRef.current = desktopPlayback;
  }, [desktopPlayback]);

  useAppMediaControlDesktopPlayback(desktopPlaybackRef);

  useAppDebouncedPersistMainWindowUi({
    vaultRoot,
    inboxShellRestored,
    vaultPaneVisible,
    episodesPaneVisible,
    inboxPaneVisible,
    notificationsPanelVisible,
    composingNewEntry,
    selectedUri,
    editorWorkspaceTabs: workspaceTabsController.editorWorkspaceTabs,
    activeEditorTabId: workspaceTabsController.activeEditorTabId,
    activeTodayHubUri,
    todayHubWorkspacesForSave,
  });

  useAppStartupSplashPhases({
    appStartupReady,
    startupSplashPhase,
    setStartupSplashPhase,
  });

  const pickFolder = async () => {
    setErr(null);
    const dir = await open({directory: true, multiple: false});
    if (dir === null || Array.isArray(dir)) {
      return;
    }
    await hydrateVault(dir);
    setActivePage('vault');
  };

  const {
    persistMainLeftWidthPx,
    persistVaultEpisodesStackTopHeightPx,
    persistNotificationsInboxStackTopHeightPx,
    persistNotificationsWidthPx,
  } = useAppLayoutWidthPersisters(setLayouts);

  useAppTauriCloseAndFocusSave(desktopPlaybackRef, flushInboxSave);

  const {
    items: notificationItems,
    dismissItem: dismissNotification,
    clearAll: clearAllNotifications,
    highlightId: notificationHighlightId,
  } = useAppNotificationSession({
    err,
    diskConflict,
    diskConflictSoft: diskConflictSoft as {uri: string} | null,
    selectedUri,
    statusBarCenter,
    renameLinkProgress,
    setNotificationsPanelVisible,
  });

  const startupOverlay =
    isTauri() && startupSplashPhase !== 'done' ? (
      <DesktopStartupSplash
        phase={startupSplashPhase === 'artwork' ? 'artwork' : 'scrim'}
      />
    ) : null;

  if (!vaultRoot) {
    return (
      <AppThemeShell
        vaultRoot={vaultRoot}
        vaultSettings={vaultSettings}
        setVaultSettings={setVaultSettings}
        fs={fs}
        onThemeReady={onThemeReady}>
        {startupOverlay}
        <div ref={appRootRef} className={appRootClassName}>
          <ThemedChromeBackground />
          <div className="app-root-chrome">
            <WindowTitleBar tiling={tiling} />
            <div className="shell setup-shell">
              <h1>{settingsName}</h1>
              <p className="muted">Choose your notes folder (vault root). Settings are stored in `.eskerra/` inside it.</p>
              <button type="button" className="primary" onClick={() => void pickFolder()} disabled={busy}>
                Choose folder…
              </button>
              {err ? <p className="error">{err}</p> : null}
            </div>
            <AppSetupTagline />
          </div>
        </div>
      </AppThemeShell>
    );
  }

  if (!layoutsReady) {
    return (
      <AppThemeShell
        vaultRoot={vaultRoot}
        vaultSettings={vaultSettings}
        setVaultSettings={setVaultSettings}
        fs={fs}
        onThemeReady={onThemeReady}>
        {startupOverlay}
        <div ref={appRootRef} className={appRootClassName}>
          <ThemedChromeBackground />
          <div className="app-root-chrome">
            <WindowTitleBar tiling={tiling} />
            <div className="shell setup-shell">
              <p className="muted">Loading…</p>
            </div>
            <AppSetupTagline />
          </div>
        </div>
      </AppThemeShell>
    );
  }

  return (
    <AppThemeShell
      vaultRoot={vaultRoot}
      vaultSettings={vaultSettings}
      setVaultSettings={setVaultSettings}
      fs={fs}
      onThemeReady={onThemeReady}>
      {startupOverlay}
      <div ref={appRootRef} className={appRootClassName}>
        <ThemedChromeBackground />
        <div className="app-root-chrome">
          <WindowTitleBar
            tiling={tiling}
            onEditorTabsHostRef={setTitleBarEditorTabsHost}
            todayHubSelect={titleBarTodayHubSelect}
          />

          <div className="app-body">
            <div className="main-shell-stage panel-group fill">
              <div className="main-column">
                <main className="main-stage">
                  {activePage === 'settings' && vaultSettings ? (
                    <SettingsPage
                      onClose={() => setActivePage('vault')}
                      vaultRoot={vaultRoot}
                      fs={fs}
                      vaultSettings={vaultSettings}
                      setVaultSettings={setVaultSettings}
                      onChangeVaultFolder={async () => {
                        await pickFolder();
                      }}
                    />
                  ) : (
                    <VaultTab
                      key={vaultRoot}
                      environment={{
                        vaultRoot,
                        vaultSettings,
                        fs,
                        fsRefreshNonce,
                        vaultMarkdownRefs,
                      }}
                      frontmatterController={{
                        inboxYamlFrontmatterInner,
                        applyFrontmatterInnerChange,
                        diskConflict,
                      }}
                      editorController={{
                        inboxEditorRef,
                        inboxEditorShellScrollRef,
                        inboxEditorShellScrollDirectiveRef,
                        inboxContentByUri,
                        backlinkUris: selectedNoteBacklinkUris,
                        selectedUri,
                        onSelectNote: selectNote,
                        onSelectNoteInNewActiveTab: selectNoteInNewActiveTab,
                        onAddEntry: startNewEntry,
                        composingNewEntry,
                        onCancelNewEntry: cancelNewEntry,
                        onCreateNewEntry: () => void submitNewEntry(),
                        editorBody,
                        onEditorChange: setEditorBody,
                        inboxEditorResetNonce,
                        onEditorError: setErr,
                        onSaveShortcut: onInboxSaveShortcut,
                        onCleanNote:
                          !composingNewEntry && selectedUri
                            ? onCleanNoteInbox
                            : undefined,
                        busy,
                        inboxBacklinksDeferNonce,
                      }}
                      vaultPaneVisible={vaultPaneVisible}
                      onToggleVault={() => setVaultPaneVisible(v => !v)}
                      episodesPaneVisible={episodesPaneVisible}
                      onToggleEpisodes={() => setEpisodesPaneVisible(v => !v)}
                      inboxPaneVisible={inboxPaneVisible}
                      onToggleInboxPane={() => setInboxPaneVisible(v => !v)}
                      onOpenInboxPane={() => setInboxPaneVisible(true)}
                      onCloseInboxPane={() => setInboxPaneVisible(false)}
                      notificationsInboxStackTopHeightPx={
                        layouts.notificationsInboxStack.topHeightPx
                      }
                      onNotificationsInboxStackTopHeightPxChanged={
                        persistNotificationsInboxStackTopHeightPx
                      }
                      playbackController={{
                        playbackTransport,
                        toolbarNowPlaying,
                        episodesPane: episodesPaneVisible ? (
                          <EpisodesPane
                            sections={podcastCatalog.sections}
                            catalogLoading={podcastCatalog.catalogLoading}
                            playEpisode={desktopPlayback.playEpisode}
                            markEpisodePlayed={desktopPlayback.markEpisodePlayed}
                            openPodcastNote={selectNote}
                            activeEpisodeId={desktopPlayback.activeEpisodeId}
                            activeEpisodePlayControl={
                              desktopPlayback.activeEpisodePlayControl
                            }
                            episodeSelectLocked={
                              desktopPlayback.episodeSelectLocked
                            }
                            onRssSync={handleEpisodesRssSync}
                            rssSyncing={rssSyncing}
                            rssSyncPercent={rssSyncPercent}
                          />
                        ) : null,
                      }}
                      vaultWidthPx={layouts.inbox.leftWidthPx}
                      episodesWidthPx={layouts.inbox.leftWidthPx}
                      onVaultWidthPxChanged={persistMainLeftWidthPx}
                      onEpisodesWidthPxChanged={persistMainLeftWidthPx}
                      stackTopHeightPx={layouts.vaultEpisodesStack.topHeightPx}
                      onStackTopHeightPxChanged={persistVaultEpisodesStackTopHeightPx}
                      linkController={{
                        onWikiLinkActivate: workspaceLinkController.onWikiLinkActivate,
                        onMarkdownRelativeLinkActivate: workspaceLinkController.onMarkdownRelativeLinkActivate,
                        onMarkdownExternalLinkOpen: workspaceLinkController.onMarkdownExternalLinkOpen,
                        linkSnippetBlockedDomains: vaultSettings?.linkSnippetBlockedDomains,
                        onMuteLinkSnippetDomain: handleMuteLinkSnippetDomain,
                      }}
                      treeController={{
                        notes,
                        onDeleteNote: uri => { void deleteNote(uri); },
                        onRenameNote: (uri, nextDisplayName) => { void renameNote(uri, nextDisplayName); },
                        onDeleteFolder: uri => { void deleteFolder(uri); },
                        onRenameFolder: (uri, nextDisplayName) => { void renameFolder(uri, nextDisplayName); },
                        onMoveVaultTreeItem: (src, kind, destDir) => { void moveVaultTreeItem(src, kind, destDir); },
                        onBulkMoveVaultTreeItems: (items, destDir) => { void bulkMoveVaultTreeItems(items, destDir); },
                        onBulkDeleteVaultTreeItems: items => { void bulkDeleteVaultTreeItems(items); },
                        vaultTreeSelectionClearNonce,
                      }}
                      mergeController={{
                        wikiLinkAmbiguityRenamePrompt: pendingWikiLinkAmbiguityRename?.summary ?? null,
                        onConfirmWikiLinkAmbiguityRename: () => { void confirmPendingWikiLinkAmbiguityRename(); },
                        onCancelWikiLinkAmbiguityRename: cancelPendingWikiLinkAmbiguityRename,
                        mergeView,
                        onCloseMergeView: closeMergeView,
                        onApplyFullBackupFromMerge: applyFullBackupFromMerge,
                        onApplyMergedBodyFromMerge: applyMergedBodyFromMerge,
                        onKeepMyEditsFromMerge: keepMyEditsFromMerge,
                      }}
                      inboxBacklinksDeferNonce={inboxBacklinksDeferNonce}
                      tabsController={{
                        editorHistoryCanGoBack: workspaceTabsController.editorHistoryCanGoBack,
                        editorHistoryCanGoForward: workspaceTabsController.editorHistoryCanGoForward,
                        onEditorHistoryGoBack: workspaceTabsController.editorHistoryGoBack,
                        onEditorHistoryGoForward: workspaceTabsController.editorHistoryGoForward,
                        editorWorkspaceTabs: workspaceTabsController.editorWorkspaceTabs,
                        activeEditorTabId: workspaceTabsController.activeEditorTabId,
                        onActivateOpenTab: workspaceTabsController.activateOpenTab,
                        onCloseEditorTab: workspaceTabsController.closeEditorTab,
                        onReorderEditorWorkspaceTabs: workspaceTabsController.reorderEditorWorkspaceTabs,
                        onCloseOtherEditorTabs: workspaceTabsController.closeOtherEditorTabs,
                      }}
                      notificationsController={{
                        notificationsPanelVisible,
                        onToggleNotificationsPanel: () => setNotificationsPanelVisible(v => !v),
                        notificationItems,
                        notificationHighlightId,
                        onDismissNotification: dismissNotification,
                        onClearAllNotifications: clearAllNotifications,
                      }}
                      notificationsWidthPx={layouts.notifications.widthPx}
                      onNotificationsWidthPxChanged={persistNotificationsWidthPx}
                      todayHubController={{
                        showTodayHubCanvas,
                        todayHubSettings,
                        todayHubBridgeRef,
                        todayHubWikiNavParentRef,
                        todayHubCellEditorRef,
                        prehydrateTodayHubRows,
                        persistTodayHubRow,
                        todayHubCleanRowBlocked,
                      }}
                      titleBarEditorTabsHost={titleBarEditorTabsHost}
                    />
                  )}
                </main>
              </div>
            </div>
          </div>

          <AppDiskConflictBanners
            err={err}
            diskConflict={diskConflict}
            diskConflictSoft={diskConflictSoft as {uri: string} | null}
            selectedUri={selectedUri}
            enterDiskConflictMergeView={enterDiskConflictMergeView}
            resolveDiskConflictReloadFromDisk={resolveDiskConflictReloadFromDisk}
            resolveDiskConflictKeepLocal={resolveDiskConflictKeepLocal}
            elevateDiskConflictSoftToBlocking={elevateDiskConflictSoftToBlocking}
            dismissDiskConflictSoft={dismissDiskConflictSoft}
          />

          <AppStatusBar
            onOpenSettings={() => setActivePage('settings')}
          />
          <ToastStack
            items={notificationItems}
            onDismiss={dismissNotification}
          />
          <QuickOpenNotePalette
            open={quickOpenOpen}
            onOpenChange={setQuickOpenOpen}
            vaultRoot={vaultRoot}
            refs={vaultMarkdownRefs}
            onPickNote={selectNote}
          />
          <VaultSearchPalette
            open={vaultSearchOpen}
            onOpenChange={setVaultSearchOpen}
            vaultRoot={vaultRoot}
            onPickNote={selectNote}
          />
        </div>
      </div>
    </AppThemeShell>
  );
}

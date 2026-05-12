/**
 * Desktop app root: window chrome, global shortcuts, vault session, and shell around `VaultTab`.
 *
 * Ownership: app-level orchestration and Tauri window integration; vault editing behavior is in `VaultTab` / workspace hook.
 */
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
import {QuickOpenNotePalette} from './components/QuickOpenNotePalette';
import {VaultSearchPalette} from './components/VaultSearchPalette';
import {VaultTab} from './components/VaultTab.tsx';
import type {NoteMarkdownEditorHandle} from './editor/noteEditor/NoteMarkdownEditor';
import {EpisodesPane} from './components/EpisodesPane';
import {AppSetupTagline, AppStatusBar} from './components/AppStatusBar';
import {GitStatusChip} from './components/GitStatusChip';
import {useManualVaultGitSync} from './hooks/useManualVaultGitSync';
import {useVaultGitStatus} from './hooks/useVaultGitStatus';
import {ToastStack} from './components/ToastStack';
import {WindowTitleBar} from './components/WindowTitleBar';
import {useAppPodcastPlayback} from './hooks/useAppPodcastPlayback';
import {useDesktopPlaylistR2EtagPollingForMainWindow} from './hooks/useDesktopPlaylistR2EtagPolling';
import {useTauriWindowMaximized} from './hooks/useTauriWindowMaximized';
import {useTauriWindowTiling} from './hooks/useTauriWindowTiling';
import {useEditorHistoryMouseButtons} from './hooks/useEditorHistoryMouseButtons';
import {useMainWindowWorkspace} from './hooks/useMainWindowWorkspace';
import {usePreventMiddleClickPaste} from './hooks/usePreventMiddleClickPaste';
import {ThemedChromeBackground} from './theme/ThemedChromeBackground';
import type {EditorWorkspaceTab} from './lib/editorWorkspaceTabs';

import {
  DEFAULT_LAYOUTS,
  type StoredLayouts,
} from './lib/layoutStore';
import {
  buildStoredMainWindowInboxForPersist,
  DEFAULT_MAIN_WINDOW_PANE_VISIBILITY,
  saveMainWindowUi,
  type StoredMainWindowUi,
  type TodayHubWorkspaceSnapshot,
} from './lib/mainWindowUiStore';
import {getManualSyncDisabledReason} from './lib/gitSyncManualView';
import {createTauriVaultFilesystem} from './lib/tauriVault';
import type {SyncConfig} from './lib/tauriVaultGitSync';
import {writeVaultSettings} from './lib/vaultBootstrap';
import {AppThemeShell} from './shell/AppThemeShell';
import {useAppLayoutWidthPersisters} from './shell/useAppLayoutWidthPersisters';
import {useAppMainWindowKeyboardEffects} from './shell/useAppMainWindowKeyboardEffects';
import {useAppMediaControlDesktopPlayback} from './shell/useAppMediaControlDesktopPlayback';
import {useAppNotificationSession} from './shell/useAppNotificationSession';
import {useAppOnMountLayoutHydration} from './shell/useAppOnMountLayoutHydration';
import {useAppRootClassName} from './shell/useAppRootClassName';
import {useAppTauriCloseAndFocusSave} from './shell/useAppTauriCloseAndFocusSave';
import {useAppTauriDocumentChrome} from './shell/useAppTauriDocumentChrome';
import {useAppTitleBarTodayHubSelect} from './shell/useAppTitleBarTodayHubSelect';
import {AppDiskConflictBanners} from './shell/AppDiskConflictBanners';

import './App.css';

type AppPage = 'vault' | 'settings';

type UseAppDebouncedPersistMainWindowUiArgs = {
  vaultRoot: string | null;
  inboxShellRestored: boolean;
  vaultPaneVisible: boolean;
  episodesPaneVisible: boolean;
  inboxPaneVisible: boolean;
  notificationsPanelVisible: boolean;
  composingNewEntry: boolean;
  selectedUri: string | null;
  activeTodayHubUri: string | null;
  persistenceTodayHubWorkspaces: Record<string, TodayHubWorkspaceSnapshot>;
  vaultMarkdownRefs: readonly {uri: string; name: string}[];
  editorWorkspaceTabs: readonly EditorWorkspaceTab[];
  activeEditorTabId: string | null;
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
  activeTodayHubUri,
  persistenceTodayHubWorkspaces,
  vaultMarkdownRefs,
  editorWorkspaceTabs,
  activeEditorTabId,
}: UseAppDebouncedPersistMainWindowUiArgs) {
  useEffect(() => {
    if (!vaultRoot || !inboxShellRestored) {
      return;
    }
    const inbox = buildStoredMainWindowInboxForPersist({
      composingNewEntry,
      selectedUri,
      activeTodayHubUri,
      todayHubWorkspaces: persistenceTodayHubWorkspaces,
      vaultMarkdownRefs,
      editorWorkspaceTabs,
      activeEditorTabId,
    });
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
    activeTodayHubUri,
    persistenceTodayHubWorkspaces,
    inboxShellRestored,
    vaultMarkdownRefs,
    editorWorkspaceTabs,
    activeEditorTabId,
  ]);
}

// TODO: make configurable via vault settings once multi-remote / multi-branch support is needed.
const GIT_SYNC_REMOTE = 'origin';
const GIT_SYNC_BRANCH = 'master';
const MANUAL_GIT_SYNC_CONFIG: SyncConfig = {
  remote: GIT_SYNC_REMOTE,
  branch: GIT_SYNC_BRANCH,
  include: ['**/*.md'],
  exclude: ['Scripts/**'],
  backupDirectory: '_sync-backups',
  conflictPolicies: [{glob: '**/*.md', strategy: 'manual'}],
  markdownConflictCallout: {
    enabled: false,
    calloutKind: 'warning',
    template: 'Conflict backup: [[{backup_path}]]',
  },
  commitMessageTemplate: 'chore: sync {timestamp} {host}',
  hostLabel: null,
  backupLocalSubdir: 'local',
  backupRemoteSubdir: 'remote',
  timeouts: {
    fetchSecs: 30,
    pushSecs: 30,
    mergeSecs: 30,
  },
  allowCreateBackupDirectory: false,
  skipCommitHooks: true,
};

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
    saveSettledNonce,
  } = workspacePersistenceController;
  const {
    status: gitStatus,
    loading: gitStatusLoading,
    error: gitStatusError,
    refresh: refreshGitStatus,
  } = useVaultGitStatus({vaultPath: vaultRoot, remote: GIT_SYNC_REMOTE, branch: GIT_SYNC_BRANCH});
  useEffect(() => {
    if (saveSettledNonce === 0) return;
    refreshGitStatus();
  }, [saveSettledNonce, refreshGitStatus]);
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
    persistenceActiveTodayHubUri,
    persistenceTodayHubWorkspaces,
    switchTodayHubWorkspace,
    focusActiveTodayHubNote,
    workspaceSelectorSubLabel,
    workspaceSelectShowsActiveTabPill,
    openWorkspaceHomeCurrentInBackgroundTab,
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
    workspaceSelectorSubLabel,
    workspaceSelectShowsActiveTabPill,
    focusActiveTodayHubNote,
    switchTodayHubWorkspace,
    openTodayHubInNewTabAfterActive,
    openWorkspaceHomeCurrentInBackgroundTab,
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

  const [layouts, setLayouts] = useState<StoredLayouts>(DEFAULT_LAYOUTS);
  const [notificationsPanelVisible, setNotificationsPanelVisible] = useState(true);

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
    activeTodayHubUri: persistenceActiveTodayHubUri,
    persistenceTodayHubWorkspaces,
    vaultMarkdownRefs,
    editorWorkspaceTabs: workspaceTabsController.editorWorkspaceTabs,
    activeEditorTabId: workspaceTabsController.activeEditorTabId,
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
    pushItem: pushNotification,
  } = useAppNotificationSession({
    err,
    diskConflict,
    diskConflictSoft: diskConflictSoft as {uri: string} | null,
    selectedUri,
    statusBarCenter,
    renameLinkProgress,
    setNotificationsPanelVisible,
  });
  const manualGitSync = useManualVaultGitSync({
    vaultPath: vaultRoot,
    config: MANUAL_GIT_SYNC_CONFIG,
    notify: pushNotification,
    onSettled: refreshGitStatus,
  });
  const manualSyncDisabledReason = getManualSyncDisabledReason({
    vaultPath: vaultRoot,
    gitStatus,
    gitStatusLoading,
    gitStatusError,
    running: manualGitSync.running,
  });
  const manualSyncLabel = manualSyncDisabledReason ?? 'Sync vault';

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
    manualSyncDisabled: manualSyncDisabledReason != null,
    manualSyncRunning: manualGitSync.running,
    onManualSync: manualGitSync.run,
  });

  if (!vaultRoot) {
    return (
      <AppThemeShell
        vaultRoot={vaultRoot}
        vaultSettings={vaultSettings}
        setVaultSettings={setVaultSettings}
        fs={fs}>
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
        fs={fs}>
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
      fs={fs}>
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
                      layoutController={{
                        vaultPaneVisible,
                        onToggleVault: () => setVaultPaneVisible(v => !v),
                        episodesPaneVisible,
                        onToggleEpisodes: () => setEpisodesPaneVisible(v => !v),
                        inboxPaneVisible,
                        onToggleInboxPane: () => setInboxPaneVisible(v => !v),
                        onOpenInboxPane: () => setInboxPaneVisible(true),
                        onCloseInboxPane: () => setInboxPaneVisible(false),
                        notificationsInboxStackTopHeightPx:
                          layouts.notificationsInboxStack.topHeightPx,
                        onNotificationsInboxStackTopHeightPxChanged:
                          persistNotificationsInboxStackTopHeightPx,
                        vaultWidthPx: layouts.inbox.leftWidthPx,
                        episodesWidthPx: layouts.inbox.leftWidthPx,
                        onVaultWidthPxChanged: persistMainLeftWidthPx,
                        onEpisodesWidthPxChanged: persistMainLeftWidthPx,
                        stackTopHeightPx: layouts.vaultEpisodesStack.topHeightPx,
                        onStackTopHeightPxChanged:
                          persistVaultEpisodesStackTopHeightPx,
                        notificationsWidthPx: layouts.notifications.widthPx,
                        onNotificationsWidthPxChanged:
                          persistNotificationsWidthPx,
                        titleBarEditorTabsHost,
                      }}
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
            onManualSync={() => void manualGitSync.run()}
            manualSyncBusy={manualGitSync.running}
            manualSyncDisabled={manualSyncDisabledReason != null}
            manualSyncLabel={manualSyncLabel}
            statusIndicator={
              <GitStatusChip
                status={gitStatus}
                loading={gitStatusLoading}
                error={gitStatusError}
                syncing={manualGitSync.running}
              />
            }
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

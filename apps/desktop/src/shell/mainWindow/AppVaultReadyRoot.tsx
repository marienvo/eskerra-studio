/**
 * Main window chrome when vault is open and layouts are hydrated.
 */
import type {RefObject, SetStateAction} from 'react';

import type {EskerraSettings, VaultFilesystem} from '@eskerra/core';

import type {ReminderRemoveResult} from '../../hooks/useReminderPane';
import type {NoteMarkdownEditorHandle} from '../../editor/noteEditor/NoteMarkdownEditor';
import type {Reminder} from '../../lib/reminderIndex';
import {WindowTitleBar} from '../../components/WindowTitleBar';
import type {StoredLayouts} from '../../lib/layout/layoutStore';
import type {UseMainWindowWorkspaceResult} from '../../hooks/useMainWindowWorkspace';
import type {WindowTilingState} from '../../lib/windowTiling';
import {ThemedChromeBackground} from '../../theme/ThemedChromeBackground';
import {AppThemeShell} from '../AppThemeShell';
import type {PaneVisibilityController} from '../usePaneVisibility';
import type {useAppTitleBarTodayHubSelect} from '../useAppTitleBarTodayHubSelect';
import {AppChromeOverlays} from './AppChromeOverlays';
import {AppMainStage} from './AppMainStage';
import {AppPaletteLayer} from './AppPaletteLayer';
import {AppStatusBarSection} from './AppStatusBarSection';
import {MainWindowVaultTab} from './MainWindowVaultTab';
import type {useAppPaletteLayerState} from './useAppPaletteLayerState';
import type {useAppMainWindowChromeSession} from './useAppMainWindowChromeSession';
import type {PaneNotification} from '../../lib/reminderPane';
import type {useAppPodcastPlayback} from '../../hooks/useAppPodcastPlayback';
import {useCalendarPipelineTrigger} from '../../hooks/useCalendarPipelineTrigger';

type AppPage = 'vault' | 'settings';

export type AppVaultReadyRootProps = {
  appRootRef: RefObject<HTMLDivElement | null>;
  appRootClassName: string;
  vaultRoot: string;
  vaultSettings: EskerraSettings | null;
  setVaultSettings: (value: SetStateAction<EskerraSettings | null>) => void;
  fs: VaultFilesystem;
  fsRefreshNonce: number;
  inboxEditorRef: RefObject<NoteMarkdownEditorHandle | null>;
  inboxEditorShellScrollRef: RefObject<HTMLDivElement | null>;
  workspace: UseMainWindowWorkspaceResult;
  paneVisibility: PaneVisibilityController;
  layouts: StoredLayouts;
  persistMainLeftWidthPx: (px: number) => void;
  persistVaultEpisodesStackTopHeightPx: (px: number) => void;
  persistNotificationsInboxStackTopHeightPx: (px: number) => void;
  persistNotificationsWidthPx: (px: number) => void;
  activePage: AppPage;
  setActivePage: (page: AppPage) => void;
  pickFolder: () => Promise<void>;
  tiling: WindowTilingState;
  titleBarTodayHubSelect: ReturnType<typeof useAppTitleBarTodayHubSelect>;
  titleBarEditorTabsHost: HTMLDivElement | null;
  setTitleBarEditorTabsHost: (el: HTMLDivElement | null) => void;
  onTitleBarQuickOpen: () => void;
  onTitleBarAddToInbox: () => void;
  titleBarTabActionsDisabled: boolean;
  openAddToInbox: () => void;
  busy: boolean;
  chromeSession: ReturnType<typeof useAppMainWindowChromeSession>;
  podcastPlayback: Pick<
    ReturnType<typeof useAppPodcastPlayback>,
    | 'podcastCatalog'
    | 'rssSyncing'
    | 'rssSyncPercent'
    | 'handleEpisodesRssSync'
    | 'desktopPlayback'
    | 'toolbarNowPlaying'
    | 'playbackTransport'
  >;
  paletteLayer: ReturnType<typeof useAppPaletteLayerState>;
  vaultMarkdownRefs: UseMainWindowWorkspaceResult['selectionController']['vaultMarkdownRefs'];
  onPickNoteQuickOpen: (uri: string) => void;
  onPickNoteVaultSearch: (uri: string) => void;
  selectedUri: string | null;
  err: string | null;
  diskConflict: UseMainWindowWorkspaceResult['conflictController']['diskConflict'];
  diskConflictSoft: UseMainWindowWorkspaceResult['conflictController']['diskConflictSoft'];
  resolveDiskConflictReloadFromDisk: UseMainWindowWorkspaceResult['conflictController']['resolveDiskConflictReloadFromDisk'];
  resolveDiskConflictKeepLocal: UseMainWindowWorkspaceResult['conflictController']['resolveDiskConflictKeepLocal'];
  elevateDiskConflictSoftToBlocking: UseMainWindowWorkspaceResult['conflictController']['elevateDiskConflictSoftToBlocking'];
  dismissDiskConflictSoft: UseMainWindowWorkspaceResult['conflictController']['dismissDiskConflictSoft'];
  enterDiskConflictMergeView: UseMainWindowWorkspaceResult['conflictController']['enterDiskConflictMergeView'];
  onMuteLinkSnippetDomain: (domain: string) => Promise<void>;
  reminderItems: readonly PaneNotification[];
  reminders: readonly Reminder[];
  hasDueReminders: boolean;
  onOpenReminder: (noteUri: string, reminderId: string, uiCaretHint?: number) => void;
  onRemoveReminder: (
    noteUri: string,
    reminderId: string,
  ) => Promise<ReminderRemoveResult>;
  onSnoozeReminder: (noteUri: string, reminderId: string, minutes: number) => Promise<void>;
};

export function AppVaultReadyRoot({
  appRootRef,
  appRootClassName,
  vaultRoot,
  vaultSettings,
  setVaultSettings,
  fs,
  fsRefreshNonce,
  inboxEditorRef,
  inboxEditorShellScrollRef,
  workspace,
  paneVisibility,
  layouts,
  persistMainLeftWidthPx,
  persistVaultEpisodesStackTopHeightPx,
  persistNotificationsInboxStackTopHeightPx,
  persistNotificationsWidthPx,
  activePage,
  setActivePage,
  pickFolder,
  tiling,
  titleBarTodayHubSelect,
  titleBarEditorTabsHost,
  setTitleBarEditorTabsHost,
  onTitleBarQuickOpen,
  onTitleBarAddToInbox,
  titleBarTabActionsDisabled,
  openAddToInbox,
  busy,
  chromeSession,
  podcastPlayback,
  paletteLayer,
  vaultMarkdownRefs,
  onPickNoteQuickOpen,
  onPickNoteVaultSearch,
  selectedUri,
  err,
  diskConflict,
  diskConflictSoft,
  resolveDiskConflictReloadFromDisk,
  resolveDiskConflictKeepLocal,
  elevateDiskConflictSoftToBlocking,
  dismissDiskConflictSoft,
  enterDiskConflictMergeView,
  onMuteLinkSnippetDomain,
  reminderItems,
  reminders,
  hasDueReminders,
  onOpenReminder,
  onRemoveReminder,
  onSnoozeReminder,
}: AppVaultReadyRootProps) {
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
      gitStatusError,
      currentGitBranchError,
      handleWindowCloseRequest,
      closeSyncInProgress,
    },
  } = chromeSession;

  const {
    podcastCatalog,
    rssSyncing,
    rssSyncPercent,
    handleEpisodesRssSync,
    desktopPlayback,
    toolbarNowPlaying,
    playbackTransport,
  } = podcastPlayback;

  const {handleCalendarRefresh, calendarSyncing, calendarSyncPercent} =
    useCalendarPipelineTrigger(vaultRoot, fs, vaultMarkdownRefs);

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
              key={vaultRoot}
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
              persistNotificationsInboxStackTopHeightPx={
                persistNotificationsInboxStackTopHeightPx
              }
              persistNotificationsWidthPx={persistNotificationsWidthPx}
              titleBarEditorTabsHost={titleBarEditorTabsHost}
              onTitleBarQuickOpen={onTitleBarQuickOpen}
              onTitleBarAddToInbox={onTitleBarAddToInbox}
              titleBarTabActionsDisabled={titleBarTabActionsDisabled}
              onAddEntry={openAddToInbox}
              busy={busy}
              notificationItems={[...notificationItems, ...reminderItems]}
              notificationHighlightId={notificationHighlightId}
              dismissNotification={dismissNotification}
              clearAllNotifications={clearAllNotifications}
              hasDueReminders={hasDueReminders}
              reminders={reminders}
              onOpenReminder={onOpenReminder}
              onRemoveReminder={onRemoveReminder}
              onSnoozeReminder={onSnoozeReminder}
              playbackTransport={playbackTransport}
              toolbarNowPlaying={toolbarNowPlaying}
              podcastCatalog={podcastCatalog}
              desktopPlayback={desktopPlayback}
              handleEpisodesRssSync={handleEpisodesRssSync}
              rssSyncing={rssSyncing}
              rssSyncPercent={rssSyncPercent}
              onCalendarRefresh={handleCalendarRefresh}
              calendarSyncing={calendarSyncing}
              calendarSyncPercent={calendarSyncPercent}
              onMuteLinkSnippetDomain={onMuteLinkSnippetDomain}
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
            onPickNoteQuickOpen={onPickNoteQuickOpen}
            onPickNoteVaultSearch={onPickNoteVaultSearch}
            {...paletteLayer}
          />
        </div>
      </div>
    </AppThemeShell>
  );
}

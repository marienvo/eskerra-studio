import type {EskerraSettings, VaultFilesystem} from '@eskerra/core';
import type {ComponentProps, RefObject} from 'react';

import {EpisodesPane} from '../../components/EpisodesPane';
import {VaultTab} from '../../components/VaultTab';
import type {NoteMarkdownEditorHandle} from '../../editor/noteEditor/NoteMarkdownEditor';
import type {ReminderRemoveResult} from '../../hooks/useReminderPane';
import type {Reminder} from '../../lib/reminderIndex';
import type {PaneNotification} from '../../lib/reminderPane';
import type {UseMainWindowWorkspaceResult} from '../../hooks/useMainWindowWorkspace';
import type {StoredLayouts} from '../../lib/layout/layoutStore';
import type {PaneVisibilityController} from '../usePaneVisibility';

type MainWindowVaultTabProps = {
  vaultRoot: string;
  vaultSettings: EskerraSettings | null;
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
  titleBarEditorTabsHost: HTMLDivElement | null;
  onTitleBarQuickOpen?: () => void;
  onTitleBarAddToInbox?: () => void;
  titleBarTabActionsDisabled?: boolean;
  onAddEntry: () => void;
  busy: boolean;
  notificationItems: readonly PaneNotification[];
  notificationHighlightId: string | null;
  dismissNotification: (id: string) => void;
  clearAllNotifications: () => void;
  hasDueReminders: boolean;
  reminders: readonly Reminder[];
  onOpenReminder: (noteUri: string, reminderId: string, uiCaretHint?: number) => void;
  onRemoveReminder: (
    noteUri: string,
    reminderId: string,
  ) => Promise<ReminderRemoveResult>;
  onSnoozeReminder: (noteUri: string, reminderId: string, minutes: number) => Promise<void>;
  playbackTransport: ComponentProps<typeof VaultTab>['playbackController']['playbackTransport'];
  toolbarNowPlaying: ComponentProps<typeof VaultTab>['playbackController']['toolbarNowPlaying'];
  podcastCatalog: {
    sections: ComponentProps<typeof EpisodesPane>['sections'];
    catalogLoading: boolean;
  };
  desktopPlayback: {
    playEpisode: ComponentProps<typeof EpisodesPane>['playEpisode'];
    markEpisodePlayed: ComponentProps<typeof EpisodesPane>['markEpisodePlayed'];
    activeEpisodeId: string | null;
    activeEpisodePlayControl: ComponentProps<typeof EpisodesPane>['activeEpisodePlayControl'];
    episodeSelectLocked: boolean;
  };
  handleEpisodesRssSync: () => void;
  rssSyncing: boolean;
  rssSyncPercent: number | null;
  onCalendarRefresh: () => void;
  calendarSyncing: boolean;
  calendarSyncPercent: number | null;
  onMuteLinkSnippetDomain: (domain: string) => Promise<void>;
};

export function MainWindowVaultTab({
  vaultRoot,
  vaultSettings,
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
  titleBarEditorTabsHost,
  onTitleBarQuickOpen,
  onTitleBarAddToInbox,
  titleBarTabActionsDisabled,
  onAddEntry,
  busy,
  notificationItems,
  notificationHighlightId,
  dismissNotification,
  clearAllNotifications,
  hasDueReminders,
  reminders,
  onOpenReminder,
  onRemoveReminder,
  onSnoozeReminder,
  playbackTransport,
  toolbarNowPlaying,
  podcastCatalog,
  desktopPlayback,
  handleEpisodesRssSync,
  rssSyncing,
  rssSyncPercent,
  onCalendarRefresh,
  calendarSyncing,
  calendarSyncPercent,
  onMuteLinkSnippetDomain,
}: MainWindowVaultTabProps) {
  const {
    selectionController,
    frontmatterController,
    notificationsState,
    conflictController,
    persistenceController,
    linkController,
    treeController,
    tabsController,
    todayHubController,
  } = workspace;
  const {visibility, setVisibility, togglePane} = paneVisibility;
  return (
    <VaultTab
      environment={{
        vaultRoot,
        vaultSettings,
        fs,
        fsRefreshNonce,
        vaultMarkdownRefs: selectionController.vaultMarkdownRefs,
      }}
      frontmatterController={{
        inboxYamlFrontmatterInner: frontmatterController.inboxYamlFrontmatterInner,
        applyFrontmatterInnerChange: frontmatterController.applyFrontmatterInnerChange,
        diskConflict: conflictController.diskConflict,
      }}
      editorController={{
        inboxEditorRef,
        inboxEditorShellScrollRef,
        inboxEditorShellScrollDirectiveRef:
          selectionController.inboxEditorShellScrollDirectiveRef,
        inboxContentByUri: selectionController.inboxContentByUri,
        backlinkUris: selectionController.selectedNoteBacklinkUris,
        selectedUri: selectionController.selectedUri,
        onSelectNote: selectionController.selectNote,
        onSelectNoteInNewActiveTab: selectionController.selectNoteInNewActiveTab,
        onAddEntry,
        composeDraftMarkdown: selectionController.composeDraftMarkdown,
        composeDraftResetNonce: selectionController.composeDraftResetNonce,
        onComposeDraftChange: selectionController.setComposeDraftMarkdown,
        composingNewEntry: selectionController.composingNewEntry,
        onCancelNewEntry: selectionController.cancelNewEntry,
        onCreateNewEntry: (liveComposeMarkdown?: string) =>
          selectionController.submitNewEntry(liveComposeMarkdown),
        editorBody: selectionController.editorBody,
        onEditorChange: selectionController.setEditorBody,
        inboxEditorResetNonce: selectionController.inboxEditorResetNonce,
        onEditorError: notificationsState.setErr,
        onSaveShortcut: persistenceController.onInboxSaveShortcut,
        onCleanNote: selectionController.selectedUri && !selectionController.composingNewEntry
          ? persistenceController.onCleanNoteInbox
          : undefined,
        busy,
        inboxBacklinksDeferNonce: selectionController.inboxBacklinksDeferNonce,
      }}
      layoutController={{
        vaultPaneVisible: visibility.vault,
        onToggleVault: () => togglePane('vault'),
        episodesPaneVisible: visibility.episodes,
        onToggleEpisodes: () => togglePane('episodes'),
        inboxPaneVisible: visibility.inbox,
        onToggleInboxPane: () => togglePane('inbox'),
        onOpenInboxPane: () => setVisibility({inbox: true}),
        onCloseInboxPane: () => setVisibility({inbox: false}),
        notificationsInboxStackTopHeightPx: layouts.notificationsInboxStack.topHeightPx,
        onNotificationsInboxStackTopHeightPxChanged:
          persistNotificationsInboxStackTopHeightPx,
        vaultWidthPx: layouts.inbox.leftWidthPx,
        episodesWidthPx: layouts.inbox.leftWidthPx,
        onVaultWidthPxChanged: persistMainLeftWidthPx,
        onEpisodesWidthPxChanged: persistMainLeftWidthPx,
        stackTopHeightPx: layouts.vaultEpisodesStack.topHeightPx,
        onStackTopHeightPxChanged: persistVaultEpisodesStackTopHeightPx,
        notificationsWidthPx: layouts.notifications.widthPx,
        onNotificationsWidthPxChanged: persistNotificationsWidthPx,
        titleBarEditorTabsHost,
        onTitleBarQuickOpen,
        onTitleBarAddToInbox,
        titleBarTabActionsDisabled,
      }}
      playbackController={{
        playbackTransport,
        toolbarNowPlaying,
        episodesPane: visibility.episodes ? (
          <EpisodesPane
            sections={podcastCatalog.sections}
            catalogLoading={podcastCatalog.catalogLoading}
            playEpisode={desktopPlayback.playEpisode}
            markEpisodePlayed={desktopPlayback.markEpisodePlayed}
            openPodcastNote={selectionController.selectNote}
            activeEpisodeId={desktopPlayback.activeEpisodeId}
            activeEpisodePlayControl={desktopPlayback.activeEpisodePlayControl}
            episodeSelectLocked={desktopPlayback.episodeSelectLocked}
            onRssSync={handleEpisodesRssSync}
            rssSyncing={rssSyncing}
            rssSyncPercent={rssSyncPercent}
            onCalendarRefresh={onCalendarRefresh}
            calendarSyncing={calendarSyncing}
            calendarSyncPercent={calendarSyncPercent}
          />
        ) : null,
      }}
      linkController={{
        onWikiLinkActivate: linkController.onWikiLinkActivate,
        onMarkdownRelativeLinkActivate: linkController.onMarkdownRelativeLinkActivate,
        onMarkdownExternalLinkOpen: linkController.onMarkdownExternalLinkOpen,
        linkSnippetBlockedDomains: vaultSettings?.linkSnippetBlockedDomains,
        onMuteLinkSnippetDomain,
      }}
      treeController={{
        notes: selectionController.notes,
        onDeleteNote: treeController.deleteNote,
        onRenameNote: treeController.renameNote,
        onDeleteFolder: treeController.deleteFolder,
        onRenameFolder: treeController.renameFolder,
        onMoveVaultTreeItem: treeController.moveVaultTreeItem,
        onBulkMoveVaultTreeItems: treeController.bulkMoveVaultTreeItems,
        onBulkDeleteVaultTreeItems: treeController.bulkDeleteVaultTreeItems,
        vaultTreeSelectionClearNonce: treeController.vaultTreeSelectionClearNonce,
      }}
      mergeController={{
        wikiLinkAmbiguityRenamePrompt:
          notificationsState.pendingWikiLinkAmbiguityRename?.summary ?? null,
        onConfirmWikiLinkAmbiguityRename:
          notificationsState.confirmPendingWikiLinkAmbiguityRename,
        onCancelWikiLinkAmbiguityRename:
          notificationsState.cancelPendingWikiLinkAmbiguityRename,
        mergeView: conflictController.mergeView,
        onCloseMergeView: conflictController.closeMergeView,
        onApplyFullBackupFromMerge: conflictController.applyFullBackupFromMerge,
        onApplyMergedBodyFromMerge: conflictController.applyMergedBodyFromMerge,
        onKeepMyEditsFromMerge: conflictController.keepMyEditsFromMerge,
      }}
      tabsController={{
        editorHistoryCanGoBack: tabsController.editorHistoryCanGoBack,
        editorHistoryCanGoForward: tabsController.editorHistoryCanGoForward,
        onEditorHistoryGoBack: tabsController.editorHistoryGoBack,
        onEditorHistoryGoForward: tabsController.editorHistoryGoForward,
        editorWorkspaceTabs: tabsController.editorWorkspaceTabs,
        activeEditorTabId: tabsController.activeEditorTabId,
        onActivateOpenTab: tabsController.activateOpenTab,
        onCloseEditorTab: tabsController.closeEditorTab,
        onReorderEditorWorkspaceTabs: tabsController.reorderEditorWorkspaceTabs,
        onCloseOtherEditorTabs: tabsController.closeOtherEditorTabs,
      }}
      notificationsController={{
        notificationsPanelVisible: visibility.notifications,
        onToggleNotificationsPanel: () => togglePane('notifications'),
        notificationItems,
        notificationHighlightId,
        onDismissNotification: dismissNotification,
        onClearAllNotifications: clearAllNotifications,
        hasDueReminders,
        reminders,
        onOpenReminder,
        onRemoveReminder,
        onSnoozeReminder,
      }}
      todayHubController={{
        showTodayHubCanvas: todayHubController.showTodayHubCanvas,
        todayHubSettings: todayHubController.todayHubSettings,
        todayHubBridgeRef: todayHubController.todayHubBridgeRef,
        todayHubWikiNavParentRef: todayHubController.todayHubWikiNavParentRef,
        todayHubCellEditorRef: todayHubController.todayHubCellEditorRef,
        prehydrateTodayHubRows: todayHubController.prehydrateTodayHubRows,
        persistTodayHubRow: todayHubController.persistTodayHubRow,
        todayHubCleanRowBlocked: todayHubController.todayHubCleanRowBlocked,
      }}
    />
  );
}

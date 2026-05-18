import type {EskerraSettings, VaultFilesystem} from '@eskerra/core';
import type {ComponentProps, Dispatch, RefObject, SetStateAction} from 'react';

import {EpisodesPane} from '../../components/EpisodesPane';
import {VaultTab} from '../../components/VaultTab';
import type {NoteMarkdownEditorHandle} from '../../editor/noteEditor/NoteMarkdownEditor';
import type {SessionNotification} from '../../lib/sessionNotifications';
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
} from '../../hooks/workspaceReturnShape';
import type {StoredLayouts} from '../../lib/layout/layoutStore';

type MainWindowVaultTabProps = {
  vaultRoot: string;
  vaultSettings: EskerraSettings | null;
  fs: VaultFilesystem;
  fsRefreshNonce: number;
  inboxEditorRef: RefObject<NoteMarkdownEditorHandle | null>;
  inboxEditorShellScrollRef: RefObject<HTMLDivElement | null>;
  selectionController: WorkspaceSelectionController;
  frontmatterController: WorkspaceFrontmatterController;
  notificationsState: WorkspaceNotificationsState;
  conflictController: WorkspaceConflictController;
  persistenceController: WorkspacePersistenceController;
  linkController: WorkspaceLinkController;
  treeController: WorkspaceTreeController;
  tabsController: WorkspaceTabsController;
  todayHubController: WorkspaceTodayHubController;
  vaultPaneVisible: boolean;
  setVaultPaneVisible: Dispatch<SetStateAction<boolean>>;
  episodesPaneVisible: boolean;
  setEpisodesPaneVisible: Dispatch<SetStateAction<boolean>>;
  inboxPaneVisible: boolean;
  setInboxPaneVisible: Dispatch<SetStateAction<boolean>>;
  layouts: StoredLayouts;
  persistMainLeftWidthPx: (px: number) => void;
  persistVaultEpisodesStackTopHeightPx: (px: number) => void;
  persistNotificationsInboxStackTopHeightPx: (px: number) => void;
  persistNotificationsWidthPx: (px: number) => void;
  titleBarEditorTabsHost: HTMLDivElement | null;
  onAddEntry: () => void;
  busy: boolean;
  notificationsPanelVisible: boolean;
  setNotificationsPanelVisible: Dispatch<SetStateAction<boolean>>;
  notificationItems: readonly SessionNotification[];
  notificationHighlightId: string | null;
  dismissNotification: (id: string) => void;
  clearAllNotifications: () => void;
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
  onMuteLinkSnippetDomain: (domain: string) => Promise<void>;
};

export function MainWindowVaultTab({
  vaultRoot,
  vaultSettings,
  fs,
  fsRefreshNonce,
  inboxEditorRef,
  inboxEditorShellScrollRef,
  selectionController,
  frontmatterController,
  notificationsState,
  conflictController,
  persistenceController,
  linkController,
  treeController,
  tabsController,
  todayHubController,
  vaultPaneVisible,
  setVaultPaneVisible,
  episodesPaneVisible,
  setEpisodesPaneVisible,
  inboxPaneVisible,
  setInboxPaneVisible,
  layouts,
  persistMainLeftWidthPx,
  persistVaultEpisodesStackTopHeightPx,
  persistNotificationsInboxStackTopHeightPx,
  persistNotificationsWidthPx,
  titleBarEditorTabsHost,
  onAddEntry,
  busy,
  notificationsPanelVisible,
  setNotificationsPanelVisible,
  notificationItems,
  notificationHighlightId,
  dismissNotification,
  clearAllNotifications,
  playbackTransport,
  toolbarNowPlaying,
  podcastCatalog,
  desktopPlayback,
  handleEpisodesRssSync,
  rssSyncing,
  rssSyncPercent,
  onMuteLinkSnippetDomain,
}: MainWindowVaultTabProps) {
  return (
    <VaultTab
      key={vaultRoot}
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
        onCreateNewEntry: () => {
          selectionController.submitNewEntry().catch(() => undefined);
        },
        editorBody: selectionController.editorBody,
        onEditorChange: selectionController.setEditorBody,
        inboxEditorResetNonce: selectionController.inboxEditorResetNonce,
        onEditorError: notificationsState.setErr,
        onSaveShortcut: persistenceController.onInboxSaveShortcut,
        onCleanNote: selectionController.selectedUri
          ? persistenceController.onCleanNoteInbox
          : undefined,
        busy,
        inboxBacklinksDeferNonce: selectionController.inboxBacklinksDeferNonce,
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
            openPodcastNote={selectionController.selectNote}
            activeEpisodeId={desktopPlayback.activeEpisodeId}
            activeEpisodePlayControl={desktopPlayback.activeEpisodePlayControl}
            episodeSelectLocked={desktopPlayback.episodeSelectLocked}
            onRssSync={handleEpisodesRssSync}
            rssSyncing={rssSyncing}
            rssSyncPercent={rssSyncPercent}
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
        notificationsPanelVisible,
        onToggleNotificationsPanel: () => setNotificationsPanelVisible(v => !v),
        notificationItems,
        notificationHighlightId,
        onDismissNotification: dismissNotification,
        onClearAllNotifications: clearAllNotifications,
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

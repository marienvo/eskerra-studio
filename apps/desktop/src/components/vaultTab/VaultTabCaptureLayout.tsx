/**
 * Capture workspace layout: compose dialog, tree split, editor pane, notifications column.
 */
import type {NoteInboxAttachmentHost} from '../../lib/noteInboxAttachmentHost';
import {resolveVaultImagePreviewUrl} from '../../lib/resolveVaultImagePreviewUrl';
import {
  MIN_RESIZABLE_PANE_PX,
  NOTIFICATIONS_PANEL,
} from '../../lib/layout/layoutStore';
import type {VaultFrontmatterIndex} from '../../hooks/useVaultFrontmatterIndex';
import {AddToInboxDialog} from '../AddToInboxDialog';
import {DesktopHorizontalSplitEnd} from '../DesktopHorizontalSplitEnd';
import {EditorWorkspaceToolbar} from '../EditorWorkspaceToolbar';
import {MainWorkspaceSplit} from '../MainWorkspaceSplit';
import {VaultTabDialogs} from '../VaultTabDialogs';
import {VaultTreePane} from '../VaultTreePane';
import {submitComposeEntryAndApplyResult} from '../vaultTabComposeSubmitResult';
import type {VaultTabDialogsProps} from '../VaultTabDialogs';
import type {
  VaultTabEditorController,
  VaultTabEnvironment,
  VaultTabFrontmatterController,
  VaultTabLayoutController,
  VaultTabLinkController,
  VaultTabMergeController,
  VaultTabNotificationsController,
  VaultTabPlaybackController,
  VaultTabTabsController,
  VaultTabTodayHubController,
  VaultTabTreeController,
} from '../vaultTabTypes';
import {VaultTabEditorPane} from './VaultTabEditorPane';
import type {UseVaultTabEditorChromeArgs} from './useVaultTabEditorChrome';
import type {RefObject} from 'react';
import type {NoteMarkdownEditorHandle} from '../../editor/noteEditor/NoteMarkdownEditor';

type LinkDerived = ReturnType<
  typeof import('../vaultTabLinkContexts').buildVaultTabEditorAndComposeLinkDerivedData
>['mainEditor'];

export type VaultTabCaptureLayoutProps = {
  environment: VaultTabEnvironment;
  frontmatterController: VaultTabFrontmatterController;
  editorController: VaultTabEditorController;
  layoutController: VaultTabLayoutController;
  playbackController: VaultTabPlaybackController;
  linkController: VaultTabLinkController;
  treeController: VaultTabTreeController;
  mergeController: VaultTabMergeController;
  tabsController: VaultTabTabsController;
  notificationsController: VaultTabNotificationsController;
  todayHubController: VaultTabTodayHubController;
  inboxHasItems: boolean;
  notificationsHasItems: boolean;
  inboxAttachmentHost: NoteInboxAttachmentHost;
  vaultFrontmatterIndex: VaultFrontmatterIndex;
  composeEditorRef: RefObject<NoteMarkdownEditorHandle | null>;
  vaultTabDialogsProps: Omit<
    VaultTabDialogsProps,
    'busy' | 'vaultRoot' | 'wikiLinkAmbiguityRenamePrompt' | 'onConfirmWikiLinkAmbiguityRename' | 'onWikiLinkAmbiguityRenameDialogOpenChange'
  >;
  wikiLinkAmbiguityRenameDialogProps: Pick<
    VaultTabDialogsProps,
    | 'wikiLinkAmbiguityRenamePrompt'
    | 'onConfirmWikiLinkAmbiguityRename'
    | 'onWikiLinkAmbiguityRenameDialogOpenChange'
  >;
  editorChrome: Pick<
    UseVaultTabEditorChromeArgs,
    never
  > & {
    editorPaneTitle: string;
    editorOpen: boolean;
    mainEditorLinkDerived: LinkDerived;
    composeDialogLinkDerived: LinkDerived;
    backlinkRows: ReturnType<
      typeof import('../vaultTabBacklinkRows').buildVaultTabBacklinkRows
    >;
  };
  treeDialogs: {
    openRenameDialog: (uri: string) => void;
    openTreeDeleteNoteDialog: (uri: string) => void;
    openRenameFolderDialog: (uri: string) => void;
    openTreeDeleteFolderDialog: (uri: string) => void;
    openBulkDeleteDialog: (items: import('../../lib/vaultTreeBulkPlan').VaultTreeBulkItem[]) => void;
    moveVaultTreeItemStable: (
      sourceUri: string,
      sourceKind: 'folder' | 'article',
      targetDirectoryUri: string,
    ) => void;
    bulkMoveVaultTreeItemsStable: (
      items: import('../../lib/vaultTreeBulkPlan').VaultTreeBulkItem[],
      targetDirectoryUri: string,
    ) => void;
    onDeleteNoteShortcut: () => void;
  };
  revealTreeNonce: number;
  bumpRevealActiveNoteInTree: () => void;
  revealActiveNoteDisabled: boolean;
  shellEndColumnContent: React.ReactNode;
  shellEndColumnVisible: boolean;
};

export function VaultTabCaptureLayout({
  environment,
  frontmatterController,
  editorController,
  layoutController,
  playbackController,
  linkController,
  treeController,
  mergeController,
  tabsController,
  notificationsController,
  todayHubController,
  inboxHasItems,
  notificationsHasItems,
  inboxAttachmentHost,
  vaultFrontmatterIndex,
  composeEditorRef,
  vaultTabDialogsProps,
  wikiLinkAmbiguityRenameDialogProps,
  editorChrome,
  treeDialogs,
  revealTreeNonce,
  bumpRevealActiveNoteInTree,
  revealActiveNoteDisabled,
  shellEndColumnContent,
  shellEndColumnVisible,
}: VaultTabCaptureLayoutProps) {
  const {vaultRoot, vaultSettings, fs, fsRefreshNonce, vaultMarkdownRefs} = environment;
  const {inboxYamlFrontmatterInner, applyFrontmatterInnerChange, diskConflict} =
    frontmatterController;
  const {
    inboxEditorRef,
    inboxEditorShellScrollRef,
    inboxContentByUri,
    selectedUri,
    onSelectNote,
    onSelectNoteInNewActiveTab,
    onAddEntry,
    composeDraftMarkdown,
    composeDraftResetNonce,
    onComposeDraftChange,
    composingNewEntry,
    onCancelNewEntry,
    onCreateNewEntry,
    editorBody,
    onEditorChange,
    inboxEditorResetNonce,
    onEditorError,
    onSaveShortcut,
    onCleanNote,
    busy,
    inboxBacklinksDeferNonce,
  } = editorController;
  const {
    vaultPaneVisible,
    onToggleVault,
    episodesPaneVisible,
    onToggleEpisodes,
    inboxPaneVisible,
    onToggleInboxPane,
    vaultWidthPx,
    episodesWidthPx,
    onVaultWidthPxChanged,
    onEpisodesWidthPxChanged,
    stackTopHeightPx,
    onStackTopHeightPxChanged,
    notificationsWidthPx,
    onNotificationsWidthPxChanged,
  } = layoutController;
  const {
    onWikiLinkActivate,
    onMarkdownRelativeLinkActivate,
    onMarkdownExternalLinkOpen,
    linkSnippetBlockedDomains,
    onMuteLinkSnippetDomain,
  } = linkController;
  const {
    editorHistoryCanGoBack,
    editorHistoryCanGoForward,
    onEditorHistoryGoBack,
    onEditorHistoryGoForward,
  } = tabsController;

  const {notificationsPanelVisible, onToggleNotificationsPanel} = notificationsController;
  const {playbackTransport, toolbarNowPlaying, episodesPane} = playbackController;
  const {vaultTreeSelectionClearNonce} = treeController;
  const {
    mergeView,
    onCloseMergeView,
    onApplyFullBackupFromMerge,
    onApplyMergedBodyFromMerge,
    onKeepMyEditsFromMerge,
  } = mergeController;
  const {
    showTodayHubCanvas,
    todayHubSettings,
    todayHubBridgeRef,
    todayHubWikiNavParentRef,
    todayHubCellEditorRef,
    prehydrateTodayHubRows,
    persistTodayHubRow,
    todayHubCleanRowBlocked,
  } = todayHubController;

  const {
    editorPaneTitle,
    editorOpen,
    mainEditorLinkDerived,
    composeDialogLinkDerived,
    backlinkRows,
  } = editorChrome;

  const {
    openRenameDialog,
    openTreeDeleteNoteDialog,
    openRenameFolderDialog,
    openTreeDeleteFolderDialog,
    openBulkDeleteDialog,
    moveVaultTreeItemStable,
    bulkMoveVaultTreeItemsStable,
    onDeleteNoteShortcut,
  } = treeDialogs;

  return (
    <div className="inbox-root" data-app-surface="capture">
      <AddToInboxDialog
        open={composingNewEntry}
        busy={busy}
        vaultRoot={vaultRoot}
        editorRef={composeEditorRef}
        composeDraftMarkdown={composeDraftMarkdown}
        composeDraftResetNonce={composeDraftResetNonce}
        onComposeDraftChange={onComposeDraftChange}
        onSave={() =>
          submitComposeEntryAndApplyResult({
            editor: composeEditorRef.current,
            draftMarkdown: composeDraftMarkdown,
            onCreateNewEntry,
            onError: onEditorError,
          })
        }
        onCancel={onCancelNewEntry}
        onEditorError={onEditorError}
        onWikiLinkActivate={onWikiLinkActivate}
        onMarkdownRelativeLinkActivate={onMarkdownRelativeLinkActivate}
        onMarkdownExternalLinkOpen={onMarkdownExternalLinkOpen}
        relativeMarkdownLinkHrefIsResolved={
          composeDialogLinkDerived.relativeMarkdownLinkHrefIsResolved
        }
        wikiLinkTargetIsResolved={composeDialogLinkDerived.wikiLinkTargetIsResolved}
        wikiLinkCompletionCandidates={composeDialogLinkDerived.wikiLinkCompletionCandidates}
        attachmentHost={inboxAttachmentHost}
        resolveVaultImagePreviewUrl={resolveVaultImagePreviewUrl}
        linkSnippetBlockedDomains={linkSnippetBlockedDomains}
        onMuteLinkSnippetDomain={onMuteLinkSnippetDomain}
      />
      <VaultTabDialogs
        busy={busy}
        vaultRoot={vaultRoot}
        {...vaultTabDialogsProps}
        {...wikiLinkAmbiguityRenameDialogProps}
      />

      <div className="main-workspace-canvas">
        <EditorWorkspaceToolbar
          vaultPaneVisible={vaultPaneVisible}
          onToggleVault={onToggleVault}
          episodesPaneVisible={episodesPaneVisible}
          onToggleEpisodes={onToggleEpisodes}
          inboxPaneVisible={inboxPaneVisible}
          onToggleInboxPane={onToggleInboxPane}
          busy={busy}
          editorHistoryCanGoBack={editorHistoryCanGoBack}
          editorHistoryCanGoForward={editorHistoryCanGoForward}
          onEditorHistoryGoBack={onEditorHistoryGoBack}
          onEditorHistoryGoForward={onEditorHistoryGoForward}
          composingNewEntry={composingNewEntry}
          editorPaneTitle={editorPaneTitle}
          onCancelNewEntry={onCancelNewEntry}
          notificationsPanelVisible={notificationsPanelVisible}
          onToggleNotificationsPanel={onToggleNotificationsPanel}
          inboxHasItems={inboxHasItems}
          notificationsHasItems={notificationsHasItems}
          playbackTransport={playbackTransport}
          nowPlaying={toolbarNowPlaying ?? null}
          onCleanNote={onCleanNote}
        />
        <DesktopHorizontalSplitEnd
          endVisible={shellEndColumnVisible}
          endWidthPx={notificationsWidthPx}
          minEndPx={NOTIFICATIONS_PANEL.minPx}
          maxEndPx={NOTIFICATIONS_PANEL.maxPx}
          minMainPx={MIN_RESIZABLE_PANE_PX}
          onEndWidthPxChanged={onNotificationsWidthPxChanged}
          main={
            <MainWorkspaceSplit
              vaultVisible={vaultPaneVisible}
              episodesVisible={episodesPaneVisible}
              vaultWidthPx={vaultWidthPx}
              episodesWidthPx={episodesWidthPx}
              onVaultWidthPxChanged={onVaultWidthPxChanged}
              onEpisodesWidthPxChanged={onEpisodesWidthPxChanged}
              stackTopHeightPx={stackTopHeightPx}
              onStackTopHeightPxChanged={onStackTopHeightPxChanged}
              vaultPane={
                <VaultTreePane
                  vaultRoot={vaultRoot}
                  fs={fs}
                  fsRefreshNonce={fsRefreshNonce}
                  vaultTreeSelectionClearNonce={vaultTreeSelectionClearNonce}
                  editorActiveMarkdownUri={selectedUri}
                  revealActiveNoteNonce={revealTreeNonce}
                  onRevealActiveNoteInTree={bumpRevealActiveNoteInTree}
                  revealActiveNoteDisabled={revealActiveNoteDisabled}
                  busy={busy}
                  onAddEntry={onAddEntry}
                  onOpenMarkdownNote={onSelectNote}
                  onOpenMarkdownNoteInNewActiveTab={onSelectNoteInNewActiveTab}
                  onRenameMarkdownRequest={openRenameDialog}
                  onDeleteMarkdownRequest={openTreeDeleteNoteDialog}
                  onRenameFolderRequest={openRenameFolderDialog}
                  onDeleteFolderRequest={openTreeDeleteFolderDialog}
                  onBulkDeleteRequest={openBulkDeleteDialog}
                  onMoveVaultTreeItem={moveVaultTreeItemStable}
                  onBulkMoveVaultTreeItems={bulkMoveVaultTreeItemsStable}
                />
              }
              episodesPane={episodesPane}
              editorPane={
                <div className="panel-surface">
                  {editorOpen ? (
                    <VaultTabEditorPane
                      fs={fs}
                      mergeView={mergeView}
                      onCloseMergeView={onCloseMergeView}
                      onApplyFullBackupFromMerge={onApplyFullBackupFromMerge}
                      onApplyMergedBodyFromMerge={onApplyMergedBodyFromMerge}
                      onKeepMyEditsFromMerge={onKeepMyEditsFromMerge}
                      inboxEditorRef={inboxEditorRef}
                      inboxEditorShellScrollRef={inboxEditorShellScrollRef}
                      inboxAttachmentHost={inboxAttachmentHost}
                      vaultRoot={vaultRoot}
                      vaultMarkdownRefs={vaultMarkdownRefs}
                      inboxContentByUri={inboxContentByUri}
                      composingNewEntry={false}
                      selectedUri={selectedUri}
                      inboxYamlFrontmatterInner={inboxYamlFrontmatterInner}
                      applyFrontmatterInnerChange={applyFrontmatterInnerChange}
                      vaultFrontmatterIndex={vaultFrontmatterIndex}
                      vaultSettings={vaultSettings}
                      diskConflict={diskConflict}
                      editorBody={editorBody}
                      inboxEditorResetNonce={inboxEditorResetNonce}
                      onEditorChange={onEditorChange}
                      onEditorError={onEditorError}
                      onWikiLinkActivate={onWikiLinkActivate}
                      onMarkdownRelativeLinkActivate={onMarkdownRelativeLinkActivate}
                      onMarkdownExternalLinkOpen={onMarkdownExternalLinkOpen}
                      relativeMarkdownLinkHrefIsResolved={
                        mainEditorLinkDerived.relativeMarkdownLinkHrefIsResolved
                      }
                      wikiLinkTargetIsResolved={mainEditorLinkDerived.wikiLinkTargetIsResolved}
                      wikiLinkCompletionCandidates={
                        mainEditorLinkDerived.wikiLinkCompletionCandidates
                      }
                      onSaveShortcut={onSaveShortcut}
                      onCleanNote={onCleanNote}
                      onDeleteNoteShortcut={onDeleteNoteShortcut}
                      busy={busy}
                      backlinkRows={backlinkRows}
                      onSelectNote={onSelectNote}
                      inboxBacklinksDeferNonce={inboxBacklinksDeferNonce}
                      showTodayHubCanvas={showTodayHubCanvas}
                      todayHubSettings={todayHubSettings}
                      todayHubBridgeRef={todayHubBridgeRef}
                      todayHubWikiNavParentRef={todayHubWikiNavParentRef}
                      todayHubCellEditorRef={todayHubCellEditorRef}
                      prehydrateTodayHubRows={prehydrateTodayHubRows}
                      persistTodayHubRow={persistTodayHubRow}
                      todayHubCleanRowBlocked={todayHubCleanRowBlocked}
                      linkSnippetBlockedDomains={linkSnippetBlockedDomains}
                      onMuteLinkSnippetDomain={onMuteLinkSnippetDomain}
                    />
                  ) : (
                    <p className="muted empty-hint">
                      Select a note from the vault or Inbox tree, or use Add entry.
                    </p>
                  )}
                </div>
              }
            />
          }
          end={shellEndColumnContent}
        />
      </div>
    </div>
  );
}

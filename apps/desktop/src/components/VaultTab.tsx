/**
 * Vault tab shell: layout, tree/episodes/editor split, dialogs, and editor pane composition.
 *
 * Ownership: UI composition + local dialog state; workspace policy lives in `useMainWindowWorkspace`.
 */
import {Fragment, useMemo} from 'react';
import {createPortal} from 'react-dom';

import {createNoteInboxAttachmentHost} from '../lib/noteInboxAttachmentHost';
import {countInboxVaultMarkdownRefs} from '../lib/vault/countInboxVaultMarkdownRefs';
import {useVaultFrontmatterIndex} from '../hooks/useVaultFrontmatterIndex';
import {EditorPaneOpenNoteTabs} from './EditorPaneOpenNoteTabs';
import {VaultTabSideColumn} from './VaultTabSideColumn';
import {VaultTabCaptureLayout} from './vaultTab/VaultTabCaptureLayout';
import {useVaultTabEditorChrome} from './vaultTab/useVaultTabEditorChrome';
import {useVaultTabInboxPaneLifecycle} from './vaultTab/useVaultTabInboxPaneLifecycle';
import {useVaultTabRevealState} from './vaultTab/useVaultTabRevealState';
import {useVaultTabTreeDialogs} from './vaultTab/useVaultTabTreeDialogs';
import type {
  VaultTabEnvironment,
  VaultTabEditorController,
  VaultTabFrontmatterController,
  VaultTabLayoutController,
  VaultTabLinkController,
  VaultTabMergeController,
  VaultTabNotificationsController,
  VaultTabPlaybackController,
  VaultTabTabsController,
  VaultTabTodayHubController,
  VaultTabTreeController,
} from './vaultTabTypes';

type VaultTabProps = {
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
};

export function VaultTab({
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
}: VaultTabProps) {
  const {vaultRoot, vaultSettings, vaultMarkdownRefs} = environment;
  const {
    inboxPaneVisible,
    onCloseInboxPane,
    titleBarEditorTabsHost = null,
    onTitleBarQuickOpen,
    onTitleBarAddToInbox,
    titleBarTabActionsDisabled = false,
  } = layoutController;
  const {
    selectedUri,
    composingNewEntry,
    backlinkUris,
    editorBody,
    inboxContentByUri,
    inboxEditorShellScrollRef,
    inboxEditorShellScrollDirectiveRef,
    busy,
  } = editorController;
  const {notificationItems} = notificationsController;
  const {
    notes,
    onDeleteNote,
    onRenameNote,
    onDeleteFolder,
    onRenameFolder,
    onBulkDeleteVaultTreeItems,
    onMoveVaultTreeItem,
    onBulkMoveVaultTreeItems,
  } = treeController;
  const {
    wikiLinkAmbiguityRenamePrompt,
    onConfirmWikiLinkAmbiguityRename,
    onCancelWikiLinkAmbiguityRename,
  } = mergeController;
  const {
    editorWorkspaceTabs,
    activeEditorTabId,
    onActivateOpenTab,
    onCloseEditorTab,
    onReorderEditorWorkspaceTabs,
    onCloseOtherEditorTabs,
  } = tabsController;
  const {showTodayHubCanvas} = todayHubController;

  const inboxHasItems = useMemo(
    () => countInboxVaultMarkdownRefs(vaultRoot, vaultMarkdownRefs) > 0,
    [vaultRoot, vaultMarkdownRefs],
  );
  useVaultTabInboxPaneLifecycle({
    vaultRoot,
    inboxHasItems,
    inboxPaneVisible,
    onCloseInboxPane,
  });
  const {
    revealTreeNonce,
    revealActiveNoteDisabled,
    revealInInboxTreeDisabled,
    bumpRevealActiveNoteInTree,
  } = useVaultTabRevealState({
    vaultRoot,
    selectedUri,
    onOpenInboxPane: layoutController.onOpenInboxPane,
  });

  const treeDialogs = useVaultTabTreeDialogs({
    busy,
    vaultRoot,
    vaultMarkdownRefs,
    selectedUri,
    composingNewEntry,
    onRenameNote,
    onDeleteNote,
    onRenameFolder,
    onDeleteFolder,
    onBulkDeleteVaultTreeItems,
    onMoveVaultTreeItem,
    onBulkMoveVaultTreeItems,
    onCancelWikiLinkAmbiguityRename,
    wikiLinkAmbiguityRenamePrompt,
    onConfirmWikiLinkAmbiguityRename,
  });

  const inboxAttachmentHost = useMemo(() => createNoteInboxAttachmentHost(), []);
  const vaultFrontmatterIndex = useVaultFrontmatterIndex({
    vaultRoot,
    overrides: vaultSettings?.frontmatterProperties,
  });

  const editorChrome = useVaultTabEditorChrome({
    vaultRoot,
    vaultMarkdownRefs,
    selectedUri,
    showTodayHubCanvas,
    notes,
    backlinkUris,
    editorBody,
    inboxContentByUri,
    inboxEditorShellScrollRef,
    inboxEditorShellScrollDirectiveRef,
  });

  // Session notifications always light the dot; due reminders only light it
  // when now ≥ dueAtMs (future reminders must not trigger the dot — spec §6).
  const notificationsHasItems =
    notificationItems.some(i => i.source !== 'reminder') ||
    notificationsController.hasDueReminders;
  const shellEndColumnVisible =
    notificationsController.notificationsPanelVisible || inboxPaneVisible;
  const shellEndColumnContent = shellEndColumnVisible ? (
    <VaultTabSideColumn
      environment={environment}
      layoutController={layoutController}
      editorController={editorController}
      treeController={treeController}
      notificationsController={notificationsController}
      revealTreeNonce={revealTreeNonce}
      onRevealActiveNoteInTree={bumpRevealActiveNoteInTree}
      revealInInboxTreeDisabled={revealInInboxTreeDisabled}
      onRenameMarkdownRequest={treeDialogs.openRenameDialog}
      onDeleteMarkdownRequest={treeDialogs.openTreeDeleteNoteDialog}
      onRenameFolderRequest={treeDialogs.openRenameFolderDialog}
      onDeleteFolderRequest={treeDialogs.openTreeDeleteFolderDialog}
      onBulkDeleteRequest={treeDialogs.openBulkDeleteDialog}
      onMoveVaultTreeItem={treeDialogs.moveVaultTreeItemStable}
      onBulkMoveVaultTreeItems={treeDialogs.bulkMoveVaultTreeItemsStable}
    />
  ) : null;

  const titleBarTabsPortal =
    titleBarEditorTabsHost != null
      ? createPortal(
          <EditorPaneOpenNoteTabs
            notes={notes}
            workspaceTabs={editorWorkspaceTabs}
            activeTabId={activeEditorTabId}
            busy={busy}
            onActivateTab={onActivateOpenTab}
            onCloseTab={onCloseEditorTab}
            onRenameNote={treeDialogs.openRenameDialog}
            onCloseOtherTabs={onCloseOtherEditorTabs}
            inTitleBar
            onReorderTabs={onReorderEditorWorkspaceTabs}
            onTitleBarQuickOpen={onTitleBarQuickOpen}
            onTitleBarAddToInbox={onTitleBarAddToInbox}
            titleBarActionsDisabled={titleBarTabActionsDisabled}
          />,
          titleBarEditorTabsHost,
        )
      : null;

  return (
    <Fragment>
      {titleBarTabsPortal}
      <VaultTabCaptureLayout
        environment={environment}
        frontmatterController={frontmatterController}
        editorController={editorController}
        layoutController={layoutController}
        playbackController={playbackController}
        linkController={linkController}
        treeController={treeController}
        mergeController={mergeController}
        tabsController={tabsController}
        notificationsController={notificationsController}
        todayHubController={todayHubController}
        inboxHasItems={inboxHasItems}
        notificationsHasItems={notificationsHasItems}
        inboxAttachmentHost={inboxAttachmentHost}
        vaultFrontmatterIndex={vaultFrontmatterIndex}
        composeEditorRef={treeDialogs.composeEditorRef}
        vaultTabDialogsProps={treeDialogs.vaultTabDialogsProps}
        wikiLinkAmbiguityRenameDialogProps={treeDialogs.wikiLinkAmbiguityRenameDialogProps}
        editorChrome={editorChrome}
        treeDialogs={treeDialogs}
        revealTreeNonce={revealTreeNonce}
        bumpRevealActiveNoteInTree={bumpRevealActiveNoteInTree}
        revealActiveNoteDisabled={revealActiveNoteDisabled}
        shellEndColumnContent={shellEndColumnContent}
        shellEndColumnVisible={shellEndColumnVisible}
      />
    </Fragment>
  );
}

import {
  MIN_RESIZABLE_PANE_PX,
  NOTIFICATIONS_INBOX_STACK_TOP,
} from '../lib/layoutStore';
import type {VaultTreeBulkItem} from '../lib/vaultTreeBulkPlan';

import {DesktopVerticalSplit} from './DesktopVerticalSplit';
import {InboxTreePane} from './InboxTreePane';
import {NotificationsPanel} from './NotificationsPanel';
import type {
  VaultTabEditorController,
  VaultTabEnvironment,
  VaultTabLayoutController,
  VaultTabNotificationsController,
  VaultTabTreeController,
} from './vaultTabTypes';

type VaultTabSideColumnProps = {
  environment: VaultTabEnvironment;
  layoutController: VaultTabLayoutController;
  editorController: VaultTabEditorController;
  treeController: VaultTabTreeController;
  notificationsController: VaultTabNotificationsController;
  revealTreeNonce: number;
  onRevealActiveNoteInTree: () => void;
  revealInInboxTreeDisabled: boolean;
  onRenameMarkdownRequest: (uri: string) => void;
  onDeleteMarkdownRequest: (uri: string) => void;
  onRenameFolderRequest: (uri: string) => void;
  onDeleteFolderRequest: (uri: string) => void;
  onBulkDeleteRequest: (items: VaultTreeBulkItem[]) => void;
  onMoveVaultTreeItem: (
    sourceUri: string,
    sourceKind: 'folder' | 'article',
    targetDirectoryUri: string,
  ) => void | Promise<void>;
  onBulkMoveVaultTreeItems: (
    items: VaultTreeBulkItem[],
    targetDirectoryUri: string,
  ) => void | Promise<void>;
};

export function VaultTabSideColumn({
  environment,
  layoutController,
  editorController,
  treeController,
  notificationsController,
  revealTreeNonce,
  onRevealActiveNoteInTree,
  revealInInboxTreeDisabled,
  onRenameMarkdownRequest,
  onDeleteMarkdownRequest,
  onRenameFolderRequest,
  onDeleteFolderRequest,
  onBulkDeleteRequest,
  onMoveVaultTreeItem,
  onBulkMoveVaultTreeItems,
}: VaultTabSideColumnProps) {
  const {
    vaultRoot,
    fs,
    fsRefreshNonce,
  } = environment;
  const {
    vaultPaneVisible,
    inboxPaneVisible,
    notificationsInboxStackTopHeightPx,
    onNotificationsInboxStackTopHeightPxChanged,
  } = layoutController;
  const {
    selectedUri,
    composingNewEntry,
    busy,
    onAddEntry,
    onSelectNote,
    onSelectNoteInNewActiveTab,
  } = editorController;
  const {
    vaultTreeSelectionClearNonce,
  } = treeController;
  const {
    notificationsPanelVisible,
    notificationItems,
    notificationHighlightId,
    onDismissNotification,
    onClearAllNotifications,
  } = notificationsController;
  const editorActiveMarkdownUri = composingNewEntry ? null : selectedUri;

  const notificationsPanelEl = (
    <NotificationsPanel
      appSurface={vaultPaneVisible ? 'capture' : 'consume'}
      items={notificationItems}
      highlightId={notificationHighlightId}
      onDismiss={onDismissNotification}
      onClearAll={onClearAllNotifications}
    />
  );

  const inboxTreePaneEl = (
    <InboxTreePane
      vaultRoot={vaultRoot}
      fs={fs}
      fsRefreshNonce={fsRefreshNonce}
      vaultTreeSelectionClearNonce={vaultTreeSelectionClearNonce}
      editorActiveMarkdownUri={editorActiveMarkdownUri}
      revealActiveNoteNonce={revealTreeNonce}
      onRevealActiveNoteInTree={onRevealActiveNoteInTree}
      revealActiveNoteDisabled={revealInInboxTreeDisabled || busy}
      busy={busy}
      onAddEntry={onAddEntry}
      onOpenMarkdownNote={onSelectNote}
      onOpenMarkdownNoteInNewActiveTab={onSelectNoteInNewActiveTab}
      onRenameMarkdownRequest={onRenameMarkdownRequest}
      onDeleteMarkdownRequest={onDeleteMarkdownRequest}
      onRenameFolderRequest={onRenameFolderRequest}
      onDeleteFolderRequest={onDeleteFolderRequest}
      onBulkDeleteRequest={onBulkDeleteRequest}
      onMoveVaultTreeItem={onMoveVaultTreeItem}
      onBulkMoveVaultTreeItems={onBulkMoveVaultTreeItems}
    />
  );

  return (
    <DesktopVerticalSplit
      className="split-inner"
      topCollapsed={!notificationsPanelVisible}
      bottomCollapsed={!inboxPaneVisible}
      topHeightPx={notificationsInboxStackTopHeightPx}
      minTopPx={NOTIFICATIONS_INBOX_STACK_TOP.minPx}
      maxTopPx={NOTIFICATIONS_INBOX_STACK_TOP.maxPx}
      minBottomPx={MIN_RESIZABLE_PANE_PX}
      onTopHeightPxChanged={onNotificationsInboxStackTopHeightPxChanged}
      top={notificationsPanelEl}
      bottom={inboxTreePaneEl}
    />
  );
}

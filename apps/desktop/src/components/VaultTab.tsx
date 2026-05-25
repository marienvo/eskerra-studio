/**
 * Vault tab shell: layout, tree/episodes/editor split, dialogs, and editor pane composition.
 *
 * Ownership: UI composition + local dialog state; workspace policy lives in `useMainWindowWorkspace`.
 */
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {createPortal} from 'react-dom';

import {createNoteInboxAttachmentHost} from '../lib/noteInboxAttachmentHost';
import {countInboxVaultMarkdownRefs} from '../lib/vault/countInboxVaultMarkdownRefs';
import {resolveVaultImagePreviewUrl} from '../lib/resolveVaultImagePreviewUrl';

import {
  MIN_RESIZABLE_PANE_PX,
  NOTIFICATIONS_PANEL,
} from '../lib/layout/layoutStore';

import {useVaultFrontmatterIndex} from '../hooks/useVaultFrontmatterIndex';

import {
  type NoteMarkdownEditorHandle,
} from '../editor/noteEditor/NoteMarkdownEditor';

import {renameDraftStemForMarkdownUri} from '../lib/renameDialogDraft';
import type {VaultTreeBulkItem} from '../lib/vaultTreeBulkPlan';

import {DesktopHorizontalSplitEnd} from './DesktopHorizontalSplitEnd';
import {EditorPaneOpenNoteTabs} from './EditorPaneOpenNoteTabs';
import {EditorWorkspaceToolbar} from './EditorWorkspaceToolbar';
import {AddToInboxDialog} from './AddToInboxDialog';
import {MainWorkspaceSplit} from './MainWorkspaceSplit';
import {VaultTreePane} from './VaultTreePane';
import {VaultTabDialogs} from './VaultTabDialogs';
import {VaultTabSideColumn} from './VaultTabSideColumn';
import {submitComposeEntryAndApplyResult} from './vaultTabComposeSubmitResult';
import {VaultTabEditorPane} from './vaultTab/VaultTabEditorPane';
import {useVaultTabInboxPaneLifecycle} from './vaultTab/useVaultTabInboxPaneLifecycle';
import {useVaultTabRevealState} from './vaultTab/useVaultTabRevealState';
import {canOpenDeleteNoteShortcut, shouldHandleDeleteNoteGlobalShortcut} from './vaultTabDeleteNoteShortcut';
import {buildVaultTabBacklinkRows} from './vaultTabBacklinkRows';
import {buildVaultTabEditorAndComposeLinkDerivedData} from './vaultTabLinkContexts';
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
  const {
    vaultRoot,
    vaultSettings,
    fs,
    fsRefreshNonce,
    vaultMarkdownRefs,
  } = environment;
  const {
    inboxYamlFrontmatterInner,
    applyFrontmatterInnerChange,
    diskConflict,
  } = frontmatterController;
  const {
    vaultPaneVisible,
    onToggleVault,
    episodesPaneVisible,
    onToggleEpisodes,
    inboxPaneVisible,
    onToggleInboxPane,
    onOpenInboxPane,
    onCloseInboxPane,
    vaultWidthPx,
    episodesWidthPx,
    onVaultWidthPxChanged,
    onEpisodesWidthPxChanged,
    stackTopHeightPx,
    onStackTopHeightPxChanged,
    notificationsWidthPx,
    onNotificationsWidthPxChanged,
    titleBarEditorTabsHost = null,
    onTitleBarQuickOpen,
    onTitleBarAddToInbox,
    titleBarTabActionsDisabled = false,
  } = layoutController;
  const {
    inboxEditorRef,
    inboxEditorShellScrollRef,
    inboxEditorShellScrollDirectiveRef,
    inboxContentByUri,
    backlinkUris,
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
    editorWorkspaceTabs,
    activeEditorTabId,
    onActivateOpenTab,
    onCloseEditorTab,
    onReorderEditorWorkspaceTabs,
    onCloseOtherEditorTabs,
  } = tabsController;
  const {
    notificationsPanelVisible,
    onToggleNotificationsPanel,
    notificationItems,
  } = notificationsController;
  const {
    notes,
    onDeleteNote,
    onRenameNote,
    onDeleteFolder,
    onRenameFolder,
    onMoveVaultTreeItem,
    onBulkMoveVaultTreeItems,
    onBulkDeleteVaultTreeItems,
    vaultTreeSelectionClearNonce,
  } = treeController;
  const {
    wikiLinkAmbiguityRenamePrompt,
    onConfirmWikiLinkAmbiguityRename,
    onCancelWikiLinkAmbiguityRename,
    mergeView,
    onCloseMergeView,
    onApplyFullBackupFromMerge,
    onApplyMergedBodyFromMerge,
    onKeepMyEditsFromMerge,
  } = mergeController;
  const {
    playbackTransport,
    toolbarNowPlaying,
    episodesPane,
  } = playbackController;
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
    onOpenInboxPane,
  });
  const notificationsHasItems = notificationItems.length > 0;
  const inboxAttachmentHost = useMemo(() => createNoteInboxAttachmentHost(), []);
  const vaultFrontmatterIndex = useVaultFrontmatterIndex({
    vaultRoot,
    overrides: vaultSettings?.frontmatterProperties,
  });
  const [confirmDeleteUri, setConfirmDeleteUri] = useState<string | null>(null);
  const [confirmDeleteFolderUri, setConfirmDeleteFolderUri] = useState<string | null>(
    null,
  );
  const [confirmBulkDeleteItems, setConfirmBulkDeleteItems] = useState<
    VaultTreeBulkItem[] | null
  >(null);
  const [renameTargetUri, setRenameTargetUri] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [renameFolderUri, setRenameFolderUri] = useState<string | null>(null);
  const [renameFolderDraft, setRenameFolderDraft] = useState('');
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const confirmDeleteNoteActionRef = useRef<HTMLButtonElement | null>(null);
  const confirmDeleteFolderActionRef = useRef<HTMLButtonElement | null>(null);
  const confirmBulkDeleteActionRef = useRef<HTMLButtonElement | null>(null);
  const composeEditorRef = useRef<NoteMarkdownEditorHandle | null>(null);
  const vaultMarkdownRefsRef = useRef(vaultMarkdownRefs);
  const onMoveVaultTreeItemRef = useRef(onMoveVaultTreeItem);
  const onBulkMoveVaultTreeItemsRef = useRef(onBulkMoveVaultTreeItems);

  useLayoutEffect(() => {
    vaultMarkdownRefsRef.current = vaultMarkdownRefs;
    onMoveVaultTreeItemRef.current = onMoveVaultTreeItem;
    onBulkMoveVaultTreeItemsRef.current = onBulkMoveVaultTreeItems;
  }, [
    vaultMarkdownRefs,
    onMoveVaultTreeItem,
    onBulkMoveVaultTreeItems,
  ]);

  const onDeleteNoteShortcut = useCallback(() => {
    if (!canOpenDeleteNoteShortcut({busy, selectedUri, composingNewEntry})) {
      return;
    }
    setConfirmDeleteUri(selectedUri);
  }, [busy, composingNewEntry, selectedUri]);

  const onDeleteNoteShortcutRef = useRef(onDeleteNoteShortcut);
  useLayoutEffect(() => {
    onDeleteNoteShortcutRef.current = onDeleteNoteShortcut;
  }, [onDeleteNoteShortcut]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        !shouldHandleDeleteNoteGlobalShortcut(e, {
          activeElement: document.activeElement,
          eventTarget: e.target,
        })
      ) {
        return;
      }
      onDeleteNoteShortcutRef.current();
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKeyDown, false);
    return () => {
      window.removeEventListener('keydown', onKeyDown, false);
    };
  }, []);

  const renameFolderInputRef = useRef<HTMLInputElement | null>(null);

  const openRenameDialog = useCallback((uri: string) => {
    const draft = renameDraftStemForMarkdownUri(uri, vaultMarkdownRefsRef.current);
    if (draft === null) {
      return;
    }
    setRenameTargetUri(uri);
    setRenameDraft(draft);
  }, []);

  const submitRename = () => {
    const uri = renameTargetUri;
    if (!uri || busy) {
      return;
    }
    void onRenameNote(uri, renameDraft);
    setRenameTargetUri(null);
  };

  const onDeleteNoteDialogOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setConfirmDeleteUri(null);
    }
  }, []);

  const onConfirmDeleteNote = useCallback(() => {
    const uri = confirmDeleteUri;
    if (uri) {
      void onDeleteNote(uri);
    }
  }, [confirmDeleteUri, onDeleteNote]);

  const openRenameFolderDialog = useCallback((uri: string) => {
    const tail = uri.split(/[/\\]/).filter(Boolean).pop();
    if (!tail) {
      return;
    }
    setRenameFolderUri(uri);
    setRenameFolderDraft(tail);
  }, []);

  const openTreeDeleteNoteDialog = useCallback((uri: string) => {
    setConfirmDeleteUri(uri);
  }, []);

  const openTreeDeleteFolderDialog = useCallback((uri: string) => {
    setConfirmDeleteFolderUri(uri);
  }, []);

  const openBulkDeleteDialog = useCallback((items: VaultTreeBulkItem[]) => {
    setConfirmBulkDeleteItems(items);
  }, []);

  const onDeleteFolderDialogOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setConfirmDeleteFolderUri(null);
    }
  }, []);

  const onConfirmDeleteFolder = useCallback(() => {
    const uri = confirmDeleteFolderUri;
    if (uri) {
      void onDeleteFolder(uri);
    }
  }, [confirmDeleteFolderUri, onDeleteFolder]);

  const onBulkDeleteDialogOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setConfirmBulkDeleteItems(null);
    }
  }, []);

  const onConfirmBulkDelete = useCallback(() => {
    const items = confirmBulkDeleteItems;
    setConfirmBulkDeleteItems(null);
    if (items) {
      void onBulkDeleteVaultTreeItems(items);
    }
  }, [confirmBulkDeleteItems, onBulkDeleteVaultTreeItems]);

  const onWikiLinkAmbiguityRenameDialogOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        onCancelWikiLinkAmbiguityRename();
      }
    },
    [onCancelWikiLinkAmbiguityRename],
  );

  const onRenameNoteDialogOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setRenameTargetUri(null);
    }
  }, []);

  const onRenameDraftChange = useCallback((next: string) => {
    setRenameDraft(next);
  }, []);

  const onRenameFolderDialogOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setRenameFolderUri(null);
    }
  }, []);

  const onRenameFolderDraftChange = useCallback((next: string) => {
    setRenameFolderDraft(next);
  }, []);

  const moveVaultTreeItemStable = useCallback(
    (
      sourceUri: string,
      sourceKind: 'folder' | 'article',
      targetDirectoryUri: string,
    ) => onMoveVaultTreeItemRef.current(sourceUri, sourceKind, targetDirectoryUri),
    [],
  );

  const bulkMoveVaultTreeItemsStable = useCallback(
    (items: VaultTreeBulkItem[], targetDirectoryUri: string) =>
      onBulkMoveVaultTreeItemsRef.current(items, targetDirectoryUri),
    [],
  );

  const submitFolderRename = () => {
    const uri = renameFolderUri;
    if (!uri || busy) {
      return;
    }
    void onRenameFolder(uri, renameFolderDraft);
    setRenameFolderUri(null);
  };

  useEffect(() => {
    if (!renameTargetUri) {
      return;
    }
    const id = window.setTimeout(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(id);
  }, [renameTargetUri]);

  useEffect(() => {
    if (!renameFolderUri) {
      return;
    }
    const id = window.setTimeout(() => {
      renameFolderInputRef.current?.focus();
      renameFolderInputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(id);
  }, [renameFolderUri]);

  const {mainEditor: mainEditorLinkDerived, composeDialog: composeDialogLinkDerived} = useMemo(
    () =>
      buildVaultTabEditorAndComposeLinkDerivedData({
        vaultRoot,
        vaultMarkdownRefs,
        selectedUri,
        showTodayHubCanvas,
      }),
    [vaultRoot, vaultMarkdownRefs, selectedUri, showTodayHubCanvas],
  );

  const editorPaneTitle = useMemo(() => {
    if (!selectedUri) {
      return 'Editor';
    }
    const row = notes.find(n => n.uri === selectedUri);
    if (row) {
      return row.name;
    }
    const tail = selectedUri.split(/[/\\]/).pop()?.trim();
    return tail || 'Editor';
  }, [notes, selectedUri]);

  const backlinkRows = useMemo(
    () =>
      buildVaultTabBacklinkRows({
        backlinkUris,
        vaultMarkdownRefs,
        composingNewEntry: false,
        selectedUri,
        editorBody,
        inboxContentByUri,
      }),
    [
      backlinkUris,
      vaultMarkdownRefs,
      selectedUri,
      editorBody,
      inboxContentByUri,
    ],
  );

  const editorOpen = Boolean(selectedUri);

  useLayoutEffect(() => {
    if (!editorOpen) {
      return;
    }
    const el = inboxEditorShellScrollRef.current;
    if (!el) {
      return;
    }
    const directive = inboxEditorShellScrollDirectiveRef.current;
    if (directive == null) {
      return;
    }
    inboxEditorShellScrollDirectiveRef.current = null;
    const apply = () => {
      if (directive.kind === 'snapTop') {
        el.scrollTop = 0;
        el.scrollLeft = 0;
      } else {
        el.scrollTop = directive.top;
        el.scrollLeft = directive.left;
      }
    };
    apply();
    const raf = requestAnimationFrame(apply);
    return () => cancelAnimationFrame(raf);
  }, [
    editorOpen,
    selectedUri,
    inboxEditorShellScrollDirectiveRef,
    inboxEditorShellScrollRef,
  ]);

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
            onRenameNote={openRenameDialog}
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
  const shellEndColumnVisible = notificationsPanelVisible || inboxPaneVisible;
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
      onRenameMarkdownRequest={openRenameDialog}
      onDeleteMarkdownRequest={openTreeDeleteNoteDialog}
      onRenameFolderRequest={openRenameFolderDialog}
      onDeleteFolderRequest={openTreeDeleteFolderDialog}
      onBulkDeleteRequest={openBulkDeleteDialog}
      onMoveVaultTreeItem={moveVaultTreeItemStable}
      onBulkMoveVaultTreeItems={bulkMoveVaultTreeItemsStable}
    />
  ) : null;
  return (
    <Fragment>
      {titleBarTabsPortal}
      <div className="inbox-root" data-app-surface="capture">
      <AddToInboxDialog
        open={composingNewEntry}
        busy={busy}
        vaultRoot={vaultRoot}
        editorRef={composeEditorRef}
        composeDraftMarkdown={composeDraftMarkdown}
        composeDraftResetNonce={composeDraftResetNonce}
        onComposeDraftChange={onComposeDraftChange}
        onSave={() => submitComposeEntryAndApplyResult({editor: composeEditorRef.current, draftMarkdown: composeDraftMarkdown, onCreateNewEntry, onError: onEditorError})}
        onCancel={onCancelNewEntry}
        onEditorError={onEditorError}
        onWikiLinkActivate={onWikiLinkActivate}
        onMarkdownRelativeLinkActivate={onMarkdownRelativeLinkActivate}
        onMarkdownExternalLinkOpen={onMarkdownExternalLinkOpen}
        relativeMarkdownLinkHrefIsResolved={composeDialogLinkDerived.relativeMarkdownLinkHrefIsResolved}
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
        confirmDeleteUri={confirmDeleteUri}
        onDeleteNoteDialogOpenChange={onDeleteNoteDialogOpenChange}
        confirmDeleteNoteActionRef={confirmDeleteNoteActionRef}
        onConfirmDeleteNote={onConfirmDeleteNote}
        confirmDeleteFolderUri={confirmDeleteFolderUri}
        onDeleteFolderDialogOpenChange={onDeleteFolderDialogOpenChange}
        confirmDeleteFolderActionRef={confirmDeleteFolderActionRef}
        onConfirmDeleteFolder={onConfirmDeleteFolder}
        confirmBulkDeleteItems={confirmBulkDeleteItems}
        onBulkDeleteDialogOpenChange={onBulkDeleteDialogOpenChange}
        confirmBulkDeleteActionRef={confirmBulkDeleteActionRef}
        onConfirmBulkDelete={onConfirmBulkDelete}
        wikiLinkAmbiguityRenamePrompt={wikiLinkAmbiguityRenamePrompt}
        onWikiLinkAmbiguityRenameDialogOpenChange={
          onWikiLinkAmbiguityRenameDialogOpenChange
        }
        onConfirmWikiLinkAmbiguityRename={onConfirmWikiLinkAmbiguityRename}
        renameTargetUri={renameTargetUri}
        onRenameNoteDialogOpenChange={onRenameNoteDialogOpenChange}
        renameInputRef={renameInputRef}
        renameDraft={renameDraft}
        onRenameDraftChange={onRenameDraftChange}
        onSubmitRename={submitRename}
        renameFolderUri={renameFolderUri}
        onRenameFolderDialogOpenChange={onRenameFolderDialogOpenChange}
        renameFolderInputRef={renameFolderInputRef}
        renameFolderDraft={renameFolderDraft}
        onRenameFolderDraftChange={onRenameFolderDraftChange}
        onSubmitFolderRename={submitFolderRename}
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
                  <>
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
                  </>
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
    </Fragment>
  );
}

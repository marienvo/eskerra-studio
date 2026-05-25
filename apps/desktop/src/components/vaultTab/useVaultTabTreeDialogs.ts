/**
 * Vault tree confirm/rename dialogs and delete-note keyboard shortcut.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';

import type {VaultMarkdownRef} from '@eskerra/core';

import type {NoteMarkdownEditorHandle} from '../../editor/noteEditor/NoteMarkdownEditor';
import {renameDraftStemForMarkdownUri} from '../../lib/renameDialogDraft';
import type {VaultTreeBulkItem} from '../../lib/vaultTreeBulkPlan';
import type {VaultTabDialogsProps} from '../VaultTabDialogs';
import {
  canOpenDeleteNoteShortcut,
  shouldHandleDeleteNoteGlobalShortcut,
} from '../vaultTabDeleteNoteShortcut';

export type UseVaultTabTreeDialogsArgs = {
  busy: boolean;
  vaultRoot: string;
  vaultMarkdownRefs: readonly VaultMarkdownRef[];
  selectedUri: string | null;
  composingNewEntry: boolean;
  onRenameNote: (uri: string, draft: string) => void | Promise<void>;
  onDeleteNote: (uri: string) => void | Promise<void>;
  onRenameFolder: (uri: string, draft: string) => void | Promise<void>;
  onDeleteFolder: (uri: string) => void | Promise<void>;
  onBulkDeleteVaultTreeItems: (items: VaultTreeBulkItem[]) => void | Promise<void>;
  onMoveVaultTreeItem: (
    sourceUri: string,
    sourceKind: 'folder' | 'article',
    targetDirectoryUri: string,
  ) => void | Promise<void>;
  onBulkMoveVaultTreeItems: (
    items: VaultTreeBulkItem[],
    targetDirectoryUri: string,
  ) => void | Promise<void>;
  onCancelWikiLinkAmbiguityRename: () => void;
  wikiLinkAmbiguityRenamePrompt: VaultTabDialogsProps['wikiLinkAmbiguityRenamePrompt'];
  onConfirmWikiLinkAmbiguityRename: VaultTabDialogsProps['onConfirmWikiLinkAmbiguityRename'];
};

export type UseVaultTabTreeDialogsResult = {
  composeEditorRef: RefObject<NoteMarkdownEditorHandle | null>;
  vaultTabDialogsProps: Omit<
    VaultTabDialogsProps,
    'busy' | 'vaultRoot' | 'wikiLinkAmbiguityRenamePrompt' | 'onConfirmWikiLinkAmbiguityRename'
  >;
  wikiLinkAmbiguityRenameDialogProps: Pick<
    VaultTabDialogsProps,
    | 'wikiLinkAmbiguityRenamePrompt'
    | 'onConfirmWikiLinkAmbiguityRename'
    | 'onWikiLinkAmbiguityRenameDialogOpenChange'
  >;
  openRenameDialog: (uri: string) => void;
  openTreeDeleteNoteDialog: (uri: string) => void;
  openRenameFolderDialog: (uri: string) => void;
  openTreeDeleteFolderDialog: (uri: string) => void;
  openBulkDeleteDialog: (items: VaultTreeBulkItem[]) => void;
  moveVaultTreeItemStable: (
    sourceUri: string,
    sourceKind: 'folder' | 'article',
    targetDirectoryUri: string,
  ) => void;
  bulkMoveVaultTreeItemsStable: (
    items: VaultTreeBulkItem[],
    targetDirectoryUri: string,
  ) => void;
  onDeleteNoteShortcut: () => void;
};

export function useVaultTabTreeDialogs(
  args: UseVaultTabTreeDialogsArgs,
): UseVaultTabTreeDialogsResult {
  const {
    busy,
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
  } = args;

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
  const renameFolderInputRef = useRef<HTMLInputElement | null>(null);
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
  }, [vaultMarkdownRefs, onMoveVaultTreeItem, onBulkMoveVaultTreeItems]);

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
    return () => window.removeEventListener('keydown', onKeyDown, false);
  }, []);

  const openRenameDialog = useCallback((uri: string) => {
    const draft = renameDraftStemForMarkdownUri(uri, vaultMarkdownRefsRef.current);
    if (draft === null) {
      return;
    }
    setRenameTargetUri(uri);
    setRenameDraft(draft);
  }, []);

  const submitRename = useCallback(() => {
    const uri = renameTargetUri;
    if (!uri || busy) {
      return;
    }
    void onRenameNote(uri, renameDraft);
    setRenameTargetUri(null);
  }, [renameTargetUri, busy, onRenameNote, renameDraft]);

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

  const submitFolderRename = useCallback(() => {
    const uri = renameFolderUri;
    if (!uri || busy) {
      return;
    }
    void onRenameFolder(uri, renameFolderDraft);
    setRenameFolderUri(null);
  }, [renameFolderUri, busy, onRenameFolder, renameFolderDraft]);

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

  return {
    composeEditorRef,
    vaultTabDialogsProps: {
      confirmDeleteUri,
      onDeleteNoteDialogOpenChange,
      confirmDeleteNoteActionRef,
      onConfirmDeleteNote,
      confirmDeleteFolderUri,
      onDeleteFolderDialogOpenChange,
      confirmDeleteFolderActionRef,
      onConfirmDeleteFolder,
      confirmBulkDeleteItems,
      onBulkDeleteDialogOpenChange,
      confirmBulkDeleteActionRef,
      onConfirmBulkDelete,
      renameTargetUri,
      onRenameNoteDialogOpenChange,
      renameInputRef,
      renameDraft,
      onRenameDraftChange,
      onSubmitRename: submitRename,
      renameFolderUri,
      onRenameFolderDialogOpenChange,
      renameFolderInputRef,
      renameFolderDraft,
      onRenameFolderDraftChange,
      onSubmitFolderRename: submitFolderRename,
    },
    wikiLinkAmbiguityRenameDialogProps: {
      wikiLinkAmbiguityRenamePrompt,
      onConfirmWikiLinkAmbiguityRename,
      onWikiLinkAmbiguityRenameDialogOpenChange,
    },
    openRenameDialog,
    openTreeDeleteNoteDialog,
    openRenameFolderDialog,
    openTreeDeleteFolderDialog,
    openBulkDeleteDialog,
    moveVaultTreeItemStable,
    bulkMoveVaultTreeItemsStable,
    onDeleteNoteShortcut,
  };
}

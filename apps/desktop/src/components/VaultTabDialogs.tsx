import * as AlertDialog from '@radix-ui/react-alert-dialog';
import * as Dialog from '@radix-ui/react-dialog';
import type {RefObject} from 'react';

import {normalizeVaultBaseUri, trimTrailingSlashes} from '@eskerra/core';

import {
  planVaultTreeBulkTargets,
  type VaultTreeBulkItem,
} from '../lib/vaultTreeBulkPlan';

import type {VaultTabWikiLinkAmbiguityRenamePrompt} from './vaultTabTypes';

export type VaultTabDialogsProps = {
  busy: boolean;
  vaultRoot: string;
  confirmDeleteUri: string | null;
  onDeleteNoteDialogOpenChange: (open: boolean) => void;
  confirmDeleteNoteActionRef: RefObject<HTMLButtonElement | null>;
  onConfirmDeleteNote: () => void;
  confirmDeleteFolderUri: string | null;
  onDeleteFolderDialogOpenChange: (open: boolean) => void;
  confirmDeleteFolderActionRef: RefObject<HTMLButtonElement | null>;
  onConfirmDeleteFolder: () => void;
  confirmBulkDeleteItems: VaultTreeBulkItem[] | null;
  onBulkDeleteDialogOpenChange: (open: boolean) => void;
  confirmBulkDeleteActionRef: RefObject<HTMLButtonElement | null>;
  onConfirmBulkDelete: () => void;
  wikiLinkAmbiguityRenamePrompt: VaultTabWikiLinkAmbiguityRenamePrompt | null;
  onWikiLinkAmbiguityRenameDialogOpenChange: (open: boolean) => void;
  onConfirmWikiLinkAmbiguityRename: () => void | Promise<void>;
  renameTargetUri: string | null;
  onRenameNoteDialogOpenChange: (open: boolean) => void;
  renameInputRef: RefObject<HTMLInputElement | null>;
  renameDraft: string;
  onRenameDraftChange: (next: string) => void;
  onSubmitRename: () => void;
  renameFolderUri: string | null;
  onRenameFolderDialogOpenChange: (open: boolean) => void;
  renameFolderInputRef: RefObject<HTMLInputElement | null>;
  renameFolderDraft: string;
  onRenameFolderDraftChange: (next: string) => void;
  onSubmitFolderRename: () => void;
};

export function VaultTabDialogs({
  busy,
  vaultRoot,
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
  wikiLinkAmbiguityRenamePrompt,
  onWikiLinkAmbiguityRenameDialogOpenChange,
  onConfirmWikiLinkAmbiguityRename,
  renameTargetUri,
  onRenameNoteDialogOpenChange,
  renameInputRef,
  renameDraft,
  onRenameDraftChange,
  onSubmitRename,
  renameFolderUri,
  onRenameFolderDialogOpenChange,
  renameFolderInputRef,
  renameFolderDraft,
  onRenameFolderDraftChange,
  onSubmitFolderRename,
}: VaultTabDialogsProps) {
  return (
    <>
      <AlertDialog.Root
        open={confirmDeleteUri !== null}
        onOpenChange={onDeleteNoteDialogOpenChange}
      >
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="alert-dialog-overlay" />
          <AlertDialog.Content
            className="alert-dialog-content"
            onOpenAutoFocus={event => {
              event.preventDefault();
              queueMicrotask(() => {
                confirmDeleteNoteActionRef.current?.focus();
              });
            }}
          >
            <AlertDialog.Title className="alert-dialog-title">Delete note</AlertDialog.Title>
            <AlertDialog.Description className="alert-dialog-description">
              Delete this note? This cannot be undone.
            </AlertDialog.Description>
            <div className="alert-dialog-actions">
              <AlertDialog.Cancel asChild>
                <button type="button" className="ghost" disabled={busy}>
                  Cancel
                </button>
              </AlertDialog.Cancel>
              <AlertDialog.Action asChild>
                <button
                  ref={confirmDeleteNoteActionRef}
                  type="button"
                  className="primary destructive"
                  disabled={busy}
                  onClick={onConfirmDeleteNote}
                >
                  Delete
                </button>
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
      <AlertDialog.Root
        open={confirmDeleteFolderUri !== null}
        onOpenChange={onDeleteFolderDialogOpenChange}
      >
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="alert-dialog-overlay" />
          <AlertDialog.Content
            className="alert-dialog-content"
            onOpenAutoFocus={event => {
              event.preventDefault();
              queueMicrotask(() => {
                confirmDeleteFolderActionRef.current?.focus();
              });
            }}
          >
            <AlertDialog.Title className="alert-dialog-title">Delete folder</AlertDialog.Title>
            <AlertDialog.Description className="alert-dialog-description">
              Delete this folder and everything inside it? This cannot be undone.
            </AlertDialog.Description>
            <div className="alert-dialog-actions">
              <AlertDialog.Cancel asChild>
                <button type="button" className="ghost" disabled={busy}>
                  Cancel
                </button>
              </AlertDialog.Cancel>
              <AlertDialog.Action asChild>
                <button
                  ref={confirmDeleteFolderActionRef}
                  type="button"
                  className="primary destructive"
                  disabled={busy}
                  onClick={onConfirmDeleteFolder}
                >
                  Delete
                </button>
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
      <AlertDialog.Root
        open={confirmBulkDeleteItems !== null}
        onOpenChange={onBulkDeleteDialogOpenChange}
      >
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="alert-dialog-overlay" />
          <AlertDialog.Content
            className="alert-dialog-content"
            onOpenAutoFocus={event => {
              event.preventDefault();
              queueMicrotask(() => {
                confirmBulkDeleteActionRef.current?.focus();
              });
            }}
          >
            <AlertDialog.Title className="alert-dialog-title">
              Delete multiple items
            </AlertDialog.Title>
            <AlertDialog.Description className="alert-dialog-description">
              {confirmBulkDeleteItems ? (
                <>
                  Delete{' '}
                  {
                    planVaultTreeBulkTargets(
                      confirmBulkDeleteItems,
                      trimTrailingSlashes(normalizeVaultBaseUri(vaultRoot).replace(/\\/g, '/')),
                    ).length
                  }{' '}
                  vault item(s) including any files inside selected folders? This cannot be
                  undone.
                </>
              ) : null}
            </AlertDialog.Description>
            <div className="alert-dialog-actions">
              <AlertDialog.Cancel asChild>
                <button type="button" className="ghost" disabled={busy}>
                  Cancel
                </button>
              </AlertDialog.Cancel>
              <AlertDialog.Action asChild>
                <button
                  ref={confirmBulkDeleteActionRef}
                  type="button"
                  className="primary destructive"
                  disabled={busy}
                  onClick={onConfirmBulkDelete}
                >
                  Delete
                </button>
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
      <AlertDialog.Root
        open={wikiLinkAmbiguityRenamePrompt !== null}
        onOpenChange={onWikiLinkAmbiguityRenameDialogOpenChange}
      >
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="alert-dialog-overlay" />
          <AlertDialog.Content className="alert-dialog-content">
            <AlertDialog.Title className="alert-dialog-title">
              Ambiguous links found
            </AlertDialog.Title>
            <AlertDialog.Description className="alert-dialog-description">
              {wikiLinkAmbiguityRenamePrompt ? (
                <>
                  This rename can safely update{' '}
                  {wikiLinkAmbiguityRenamePrompt.updatedLinkCount} link(s) across{' '}
                  {wikiLinkAmbiguityRenamePrompt.touchedFileCount} note(s), but{' '}
                  {wikiLinkAmbiguityRenamePrompt.skippedAmbiguousLinkCount} wiki link(s)
                  are ambiguous and will be skipped.
                </>
              ) : null}
            </AlertDialog.Description>
            <div className="alert-dialog-actions">
              <AlertDialog.Cancel asChild>
                <button type="button" className="ghost" disabled={busy}>
                  Cancel
                </button>
              </AlertDialog.Cancel>
              <AlertDialog.Action asChild>
                <button
                  type="button"
                  className="primary"
                  disabled={busy}
                  onClick={() => {
                    void onConfirmWikiLinkAmbiguityRename();
                  }}
                >
                  Continue
                </button>
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
      <Dialog.Root
        open={renameTargetUri !== null}
        onOpenChange={onRenameNoteDialogOpenChange}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="alert-dialog-overlay" />
          <Dialog.Content className="alert-dialog-content">
            <Dialog.Title className="alert-dialog-title">Rename note</Dialog.Title>
            <Dialog.Description className="alert-dialog-description">
              Choose a new name for this note.
            </Dialog.Description>
            <label className="rename-note-field">
              <span className="rename-note-field__label">File name</span>
              <input
                ref={renameInputRef}
                type="text"
                className="rename-note-field__input"
                value={renameDraft}
                disabled={busy}
                onChange={event => onRenameDraftChange(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    onSubmitRename();
                  }
                }}
              />
            </label>
            <div className="alert-dialog-actions">
              <Dialog.Close asChild>
                <button type="button" className="ghost" disabled={busy}>
                  Cancel
                </button>
              </Dialog.Close>
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={onSubmitRename}
              >
                Rename
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <Dialog.Root
        open={renameFolderUri !== null}
        onOpenChange={onRenameFolderDialogOpenChange}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="alert-dialog-overlay" />
          <Dialog.Content className="alert-dialog-content">
            <Dialog.Title className="alert-dialog-title">Rename folder</Dialog.Title>
            <Dialog.Description className="alert-dialog-description">
              Choose a new name for this folder.
            </Dialog.Description>
            <label className="rename-note-field">
              <span className="rename-note-field__label">Folder name</span>
              <input
                ref={renameFolderInputRef}
                type="text"
                className="rename-note-field__input"
                value={renameFolderDraft}
                disabled={busy}
                onChange={event => onRenameFolderDraftChange(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    onSubmitFolderRename();
                  }
                }}
              />
            </label>
            <div className="alert-dialog-actions">
              <Dialog.Close asChild>
                <button type="button" className="ghost" disabled={busy}>
                  Cancel
                </button>
              </Dialog.Close>
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={onSubmitFolderRename}
              >
                Rename
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

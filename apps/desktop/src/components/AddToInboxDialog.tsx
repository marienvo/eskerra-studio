import * as Dialog from '@radix-ui/react-dialog';
import {
  useCallback,
  useEffect,
  useRef,
  type MouseEvent,
  type RefObject,
} from 'react';

import type {InboxWikiLinkCompletionCandidate} from '@eskerra/core';

import {
  NoteMarkdownEditor,
  type NoteMarkdownEditorHandle,
} from '../editor/noteEditor/NoteMarkdownEditor';
import type {NoteInboxAttachmentHost} from '../lib/noteInboxAttachmentHost';
import type {VaultImagePreviewUrlResolver} from '../editor/noteEditor/vaultImagePreviewTypes';
import type {
  VaultRelativeMarkdownLinkActivatePayload,
  VaultWikiLinkActivatePayload,
} from '../editor/noteEditor/vaultLinkActivatePayload';

import styles from './AddToInboxDialog.module.css';

export type AddToInboxDialogProps = {
  open: boolean;
  busy: boolean;
  vaultRoot: string;
  editorRef: RefObject<NoteMarkdownEditorHandle | null>;
  composeDraftMarkdown: string;
  composeDraftResetNonce: number;
  onComposeDraftChange: (markdown: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onEditorError: (message: string) => void;
  onWikiLinkActivate: (payload: VaultWikiLinkActivatePayload) => void;
  onMarkdownRelativeLinkActivate: (payload: VaultRelativeMarkdownLinkActivatePayload) => void;
  onMarkdownExternalLinkOpen: (payload: {href: string; at: number}) => void;
  relativeMarkdownLinkHrefIsResolved: (href: string) => boolean;
  wikiLinkTargetIsResolved: (inner: string) => boolean;
  wikiLinkCompletionCandidates: readonly InboxWikiLinkCompletionCandidate[];
  attachmentHost: NoteInboxAttachmentHost;
  resolveVaultImagePreviewUrl: VaultImagePreviewUrlResolver;
  linkSnippetBlockedDomains?: readonly string[];
  onMuteLinkSnippetDomain?: (domain: string) => void;
};

export function AddToInboxDialog({
  open,
  busy,
  vaultRoot,
  editorRef,
  composeDraftMarkdown,
  composeDraftResetNonce,
  onComposeDraftChange,
  onSave,
  onCancel,
  onEditorError,
  onWikiLinkActivate,
  onMarkdownRelativeLinkActivate,
  onMarkdownExternalLinkOpen,
  relativeMarkdownLinkHrefIsResolved,
  wikiLinkTargetIsResolved,
  wikiLinkCompletionCandidates,
  attachmentHost,
  resolveVaultImagePreviewUrl,
  linkSnippetBlockedDomains,
  onMuteLinkSnippetDomain,
}: AddToInboxDialogProps) {
  const safeComposeDraftMarkdown =
    typeof composeDraftMarkdown === 'string' ? composeDraftMarkdown : '';
  const wasOpenRef = useRef(false);
  const focusEditorSelectAll = useCallback(() => {
    window.requestAnimationFrame(() => {
      editorRef.current?.focus({
        selectAll: true,
        scrollIntoView: false,
      });
    });
  }, [editorRef]);
  const focusEditorAtEnd = useCallback(
    (scrollIntoView = false, fallbackLength: number) => {
      window.requestAnimationFrame(() => {
        const anchor =
          editorRef.current?.getMarkdown().length ?? fallbackLength;
        editorRef.current?.focus({
          anchor,
          scrollIntoView,
        });
      });
    },
    [editorRef],
  );
  const handleEditorSurfaceMouseDown = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target?.closest('.cm-content')) {
        return;
      }
      focusEditorAtEnd(true, safeComposeDraftMarkdown.length);
    },
    [focusEditorAtEnd, safeComposeDraftMarkdown.length],
  );

  useEffect(() => {
    const wasOpen = wasOpenRef.current;
    wasOpenRef.current = open;
    if (!open || wasOpen) {
      return;
    }
    focusEditorSelectAll();
  }, [focusEditorSelectAll, open]);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={nextOpen => {
        if (!nextOpen) {
          onCancel();
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content
          className={styles.content}
          onOpenAutoFocus={event => {
            event.preventDefault();
          }}
          onCloseAutoFocus={event => {
            event.preventDefault();
          }}
        >
          <Dialog.Title className={styles.title}>
            Add to inbox{' '}
            <span className={styles.titleHint}>(Ctrl+Enter to save)</span>
          </Dialog.Title>
          <div
            className={`${styles.editorSurface} note-markdown-editor-wrap`}
            data-app-surface="capture"
            onMouseDown={handleEditorSurfaceMouseDown}
          >
            <div className={styles.editorScroll}>
              <NoteMarkdownEditor
                ref={editorRef}
                vaultRoot={vaultRoot}
                activeNotePath={null}
                initialMarkdown={safeComposeDraftMarkdown}
                sessionKey={composeDraftResetNonce}
                onMarkdownChange={onComposeDraftChange}
                onEditorError={onEditorError}
                onWikiLinkActivate={onWikiLinkActivate}
                onMarkdownRelativeLinkActivate={onMarkdownRelativeLinkActivate}
                onMarkdownExternalLinkOpen={onMarkdownExternalLinkOpen}
                relativeMarkdownLinkHrefIsResolved={relativeMarkdownLinkHrefIsResolved}
                wikiLinkTargetIsResolved={wikiLinkTargetIsResolved}
                wikiLinkCompletionCandidates={wikiLinkCompletionCandidates}
                onSaveShortcut={onSave}
                modEnterSaveWhenNoLink
                placeholder="First line is title (H1)…"
                busy={busy}
                attachmentHost={attachmentHost}
                resolveVaultImagePreviewUrl={resolveVaultImagePreviewUrl}
                linkSnippetBlockedDomains={linkSnippetBlockedDomains}
                onMuteLinkSnippetDomain={onMuteLinkSnippetDomain}
              />
            </div>
          </div>
          <Dialog.Description className={styles.hint}>
            First line becomes the file name for a new note under <strong>Inbox/</strong>.
          </Dialog.Description>
          <div className={styles.actions}>
            <button type="button" className="ghost" disabled={busy} onClick={onCancel}>
              Cancel
            </button>
            <button type="button" className="primary" disabled={busy} onClick={onSave}>
              Save
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

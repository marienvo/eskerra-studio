/**
 * Deferred persist for a note left dirty on tab/URI switch (not awaited by open routing).
 * Cache / lastPersisted: update only via setLastPersistedSnapshot when the note is still active.
 */
import {markdownContainsTransientImageUrls, type VaultFilesystem} from '@eskerra/core';

import {normalizeEditorDocUri} from '../../lib/editorDocumentHistory';
import {persistTransientMarkdownImages} from '../../lib/persistTransientMarkdownImages';
import {saveNoteMarkdown} from '../../lib/vaultBootstrap';

import {
  shouldMergeCacheAfterOutgoingPersist,
  shouldSkipOutgoingPersistAfterNoteLeave,
  shouldSkipOutgoingPersistBeforeWrite,
} from '../inboxNoteBodyCache';
import type {LastPersisted} from '../workspaceFsWatchReconcile';

import {INBOX_TRANSIENT_IMAGE_SAVE_ERROR} from './inboxPersistErrors';
import {mergeInboxNoteBodyCacheRefAndState} from './mergeInboxNoteBodyCache';
import type {WorkspacePersistenceActions, WorkspacePersistenceRefs} from './workspacePersistenceTypes';

export async function persistOutgoingNoteSnapshot(args: {
  fs: VaultFilesystem;
  refs: WorkspacePersistenceRefs;
  actions: WorkspacePersistenceActions;
  norm: string;
  leaveSnapshotMarkdown: string;
}): Promise<void> {
  const {fs, refs, actions, norm, leaveSnapshotMarkdown} = args;
  const root = refs.vaultRootRef.current;
  if (!root) {
    return;
  }
  const dc = refs.diskConflictRef.current;
  if (dc && normalizeEditorDocUri(dc.uri) === norm) {
    return;
  }
  const memStart = refs.inboxContentByUriRef.current[norm];
  if (shouldSkipOutgoingPersistAfterNoteLeave(memStart, leaveSnapshotMarkdown)) {
    return;
  }

  actions.setErr(null);
  const md = await persistTransientMarkdownImages(leaveSnapshotMarkdown, root);
  if (markdownContainsTransientImageUrls(md)) {
    actions.setErr(INBOX_TRANSIENT_IMAGE_SAVE_ERROR);
    return;
  }
  if (md !== leaveSnapshotMarkdown) {
    mergeInboxNoteBodyCacheRefAndState(
      refs.inboxContentByUriRef,
      actions.setInboxContentByUri,
      norm,
      md,
    );
    const active = refs.selectedUriRef.current;
    if (active && normalizeEditorDocUri(active) === norm) {
      actions.loadFullMarkdownIntoInboxEditor(md, norm, 'preserve');
      actions.scheduleBacklinksDeferOneFrameAfterLoad();
    }
  }
  const memBeforeSave = refs.inboxContentByUriRef.current[norm];
  if (shouldSkipOutgoingPersistBeforeWrite(memBeforeSave, leaveSnapshotMarkdown, md)) {
    return;
  }
  await saveNoteMarkdown(norm, fs, md);
  actions.onVaultWriteSettled();
  actions.refreshNotes(root).catch(() => undefined);

  const activeSel = refs.selectedUriRef.current;
  if (activeSel && normalizeEditorDocUri(activeSel) === norm) {
    actions.setLastPersistedSnapshot({uri: norm, markdown: md} satisfies LastPersisted);
  }
  const memAfter = refs.inboxContentByUriRef.current[norm];
  if (shouldMergeCacheAfterOutgoingPersist(memAfter, md, leaveSnapshotMarkdown)) {
    mergeInboxNoteBodyCacheRefAndState(
      refs.inboxContentByUriRef,
      actions.setInboxContentByUri,
      norm,
      md,
    );
  }
}

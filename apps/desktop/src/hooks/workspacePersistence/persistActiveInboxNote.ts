/**
 * Persist the currently selected inbox note (autosave, flush, explicit save chain).
 */
import {markdownContainsTransientImageUrls, type VaultFilesystem} from '@eskerra/core';

import {normalizeEditorDocUri} from '../../lib/editorDocumentHistory';
import {persistTransientMarkdownImages} from '../../lib/persistTransientMarkdownImages';
import {saveNoteMarkdown} from '../../lib/vaultBootstrap';

import {mergeInboxNoteBodyIntoCache} from '../inboxNoteBodyCache';

import {INBOX_TRANSIENT_IMAGE_SAVE_ERROR} from './inboxPersistErrors';
import {readLiveInboxFullMarkdownFromRefs} from './readLiveInboxFullMarkdown';
import type {WorkspacePersistenceActions, WorkspacePersistenceRefs} from './workspacePersistenceTypes';

export async function persistActiveInboxNote(args: {
  fs: VaultFilesystem;
  refs: WorkspacePersistenceRefs;
  actions: WorkspacePersistenceActions;
}): Promise<void> {
  const {fs, refs, actions} = args;
  const root = refs.vaultRootRef.current;
  const uri = refs.selectedUriRef.current;
  if (!root || !uri || refs.composingNewEntryRef.current) {
    return;
  }
  const dc = refs.diskConflictRef.current;
  if (dc && normalizeEditorDocUri(dc.uri) === normalizeEditorDocUri(uri)) {
    return;
  }
  const prev = refs.lastPersistedRef.current;
  const raw = readLiveInboxFullMarkdownFromRefs(
    refs,
    refs.editorBodyRef.current,
    uri,
    refs.composingNewEntryRef.current,
  );
  if (prev && prev.uri === uri && prev.markdown === raw) {
    return;
  }

  actions.setErr(null);
  const md = await persistTransientMarkdownImages(raw, root);
  if (markdownContainsTransientImageUrls(md)) {
    actions.setErr(INBOX_TRANSIENT_IMAGE_SAVE_ERROR);
    return;
  }
  if (md !== raw) {
    actions.loadFullMarkdownIntoInboxEditor(md, uri, 'preserve');
    actions.scheduleBacklinksDeferOneFrameAfterLoad();
  }
  await saveNoteMarkdown(uri, fs, md);
  actions.onVaultWriteSettled();
  await actions.refreshNotes(root);
  if (refs.selectedUriRef.current !== uri || refs.composingNewEntryRef.current) {
    return;
  }
  actions.setLastPersistedSnapshot({uri, markdown: md});
  const nextCache = mergeInboxNoteBodyIntoCache(
    refs.inboxContentByUriRef.current,
    uri,
    md,
  );
  if (nextCache) {
    refs.inboxContentByUriRef.current = nextCache;
    actions.setInboxContentByUri(prev =>
      mergeInboxNoteBodyIntoCache(prev, uri, md) ?? prev,
    );
  }
}

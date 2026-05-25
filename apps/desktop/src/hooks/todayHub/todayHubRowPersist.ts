/**
 * Today Hub row disk read/write: prehydrate inbox cache and persist row markdown.
 *
 * Ownership: pure async I/O + cache updates; save-chain serialization stays in the caller hook.
 */
import {
  markdownContainsTransientImageUrls,
  type SubtreeMarkdownPresenceCache,
  type VaultFilesystem,
} from '@eskerra/core';

import type {Dispatch, MutableRefObject, SetStateAction} from 'react';

import {normalizeEditorDocUri} from '../../lib/editorDocumentHistory';
import {
  mergeInboxNoteBodyIntoCache,
  normalizeVaultMarkdownDiskRead,
  removeInboxNoteBodyFromCache,
} from '../inboxNoteBodyCache';
import {persistTransientMarkdownImages} from '../../lib/persistTransientMarkdownImages';
import {
  normalizeTodayHubRowForDisk,
  splitTodayRowIntoColumns,
  todayHubRowSectionsAllBlank,
} from '../../lib/todayHub';
import {deleteVaultMarkdownNote, saveNoteMarkdown} from '../../lib/vaultBootstrap';

export type TodayHubRowPersistDeps = {
  fs: VaultFilesystem;
  vaultRootRef: MutableRefObject<string | null>;
  saveChainRef: MutableRefObject<Promise<void>>;
  inboxContentByUriRef: MutableRefObject<Record<string, string>>;
  setInboxContentByUri: Dispatch<SetStateAction<Record<string, string>>>;
  todayHubRowLastPersistedRef: MutableRefObject<Map<string, string>>;
  setErr: (value: string | null) => void;
  markVaultWriteSettled: () => void;
  subtreeMarkdownCache: SubtreeMarkdownPresenceCache;
  refreshNotes: (root: string) => Promise<void>;
  setFsRefreshNonce: Dispatch<SetStateAction<number>>;
};

export async function prehydrateTodayHubRowsFromDisk(
  uris: readonly string[],
  deps: TodayHubRowPersistDeps,
): Promise<void> {
  const root = deps.vaultRootRef.current;
  if (!root) {
    return;
  }
  await deps.saveChainRef.current.catch(() => undefined);
  const updates: Record<string, string> = {};
  for (const uri of uris) {
    const n = normalizeEditorDocUri(uri);
    if (deps.inboxContentByUriRef.current[n] !== undefined) {
      continue;
    }
    try {
      if (!(await deps.fs.exists(n))) {
        continue;
      }
      const raw = await deps.fs.readFile(n, {encoding: 'utf8'});
      const body = normalizeVaultMarkdownDiskRead(raw);
      updates[n] = body;
      deps.todayHubRowLastPersistedRef.current.set(n, body);
    } catch {
      // ignore transient FS errors during prehydrate
    }
  }
  if (Object.keys(updates).length > 0) {
    deps.inboxContentByUriRef.current = {...deps.inboxContentByUriRef.current, ...updates};
    deps.setInboxContentByUri(prev => ({...prev, ...updates}));
  }
}

export async function persistTodayHubRowToVault(
  rowUri: string,
  merged: string,
  columnCount: number,
  deps: TodayHubRowPersistDeps,
): Promise<void> {
  const root = deps.vaultRootRef.current;
  if (!root) {
    return;
  }
  const norm = normalizeEditorDocUri(rowUri);
  deps.setErr(null);
  try {
    const toPersist = normalizeTodayHubRowForDisk(merged, columnCount);
    const sections = splitTodayRowIntoColumns(toPersist, columnCount);
    if (todayHubRowSectionsAllBlank(sections)) {
      await deleteBlankTodayHubRow(root, norm, deps);
      return;
    }
    await savePopulatedTodayHubRow(root, norm, toPersist, deps);
  } catch (e) {
    deps.setErr(e instanceof Error ? e.message : String(e));
  }
}

async function deleteBlankTodayHubRow(
  root: string,
  norm: string,
  deps: TodayHubRowPersistDeps,
): Promise<void> {
  try {
    if (await deps.fs.exists(norm)) {
      await deleteVaultMarkdownNote(root, norm, deps.fs);
      deps.markVaultWriteSettled();
      deps.subtreeMarkdownCache.invalidateForMutation(root, norm, 'file');
    }
  } catch (e) {
    deps.setErr(e instanceof Error ? e.message : String(e));
    return;
  }

  deps.todayHubRowLastPersistedRef.current.delete(norm);
  const nextCache = removeInboxNoteBodyFromCache(deps.inboxContentByUriRef.current, norm);
  if (nextCache) {
    deps.inboxContentByUriRef.current = nextCache;
    deps.setInboxContentByUri(prev => removeInboxNoteBodyFromCache(prev, norm) ?? prev);
  }
  await deps.refreshNotes(root);
  deps.setFsRefreshNonce(n => n + 1);
}

async function savePopulatedTodayHubRow(
  root: string,
  norm: string,
  toPersist: string,
  deps: TodayHubRowPersistDeps,
): Promise<void> {
  const md = await persistTransientMarkdownImages(toPersist, root);
  if (markdownContainsTransientImageUrls(md)) {
    deps.setErr(
      'Cannot save: some images are still temporary (blob or data URLs). Paste images again so they are stored under Assets/Attachments, or remove those image references.',
    );
    return;
  }

  await saveNoteMarkdown(norm, deps.fs, md);
  deps.markVaultWriteSettled();
  deps.subtreeMarkdownCache.invalidateForMutation(root, norm, 'file');
  deps.todayHubRowLastPersistedRef.current.set(norm, md);

  const nextCache = mergeInboxNoteBodyIntoCache(deps.inboxContentByUriRef.current, norm, md);
  if (nextCache) {
    deps.inboxContentByUriRef.current = nextCache;
    deps.setInboxContentByUri(prev => mergeInboxNoteBodyIntoCache(prev, norm, md) ?? prev);
  }
  await deps.refreshNotes(root);
  deps.setFsRefreshNonce(n => n + 1);
}

export function enqueuePersistTodayHubRowOnSaveChain(
  rowUri: string,
  merged: string,
  columnCount: number,
  deps: TodayHubRowPersistDeps & {
    saveActiveRef: MutableRefObject<boolean>;
    saveChainRef: MutableRefObject<Promise<void>>;
  },
): Promise<void> {
  const run = () => persistTodayHubRowToVault(rowUri, merged, columnCount, deps);
  deps.saveActiveRef.current = true;
  const next = deps.saveChainRef.current.then(() => run()).finally(() => {
    deps.saveActiveRef.current = false;
  });
  deps.saveChainRef.current = next.catch(() => undefined);
  return next;
}

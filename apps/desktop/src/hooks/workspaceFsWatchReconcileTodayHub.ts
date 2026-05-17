/**
 * Vault filesystem watch → Today Hub week-row disk/cache reconcile.
 *
 * Separated from the open-tab reconcile path so helpers explicitly declare that they only
 * touch Today Hub state (review: avoid one undifferentiated env for all vault-watch effects).
 */
import type {Dispatch, MutableRefObject, SetStateAction} from 'react';

import type {VaultFilesystem} from '@eskerra/core';

import {normalizeEditorDocUri} from '../lib/editorDocumentHistory';
import {
  enumerateTodayHubWeekStarts,
  todayHubRowUri,
  type TodayHubSettings,
  type TodayHubWorkspaceBridge,
} from '../lib/todayHub';
import {vaultUriParentDirectory} from '../lib/vaultUriPaths';
import {vaultUriIsTodayMarkdownFile} from '../lib/vaultTreeLoadChildren';
import {
  fsChangePathsMayAffectUri,
  mergeInboxNoteBodyIntoCache,
  normalizeVaultMarkdownDiskRead,
  removeInboxNoteBodyFromCache,
} from './inboxNoteBodyCache';

/** Today hub row disk/cache alignment; only used after open-tab reconcile in the same FS batch. */
export type ReconcileFsTodayHubEnv = {
  todayHubRowLastPersistedRef: MutableRefObject<Map<string, string>>;
  todayHubSettingsRef: MutableRefObject<TodayHubSettings | null>;
  todayHubBridgeRef: MutableRefObject<TodayHubWorkspaceBridge>;
};

/** Narrow slice of the open-markdown env that Today Hub reconcile actually needs. */
type TodayHubOpenCacheEnv = {
  fs: VaultFilesystem;
  selectedUriRef: MutableRefObject<string | null>;
  composingNewEntryRef: MutableRefObject<boolean>;
  inboxContentByUriRef: MutableRefObject<Record<string, string>>;
  setInboxContentByUri: Dispatch<SetStateAction<Record<string, string>>>;
};

async function pathExistsForTodayHubRow(
  fs: VaultFilesystem,
  rowUri: string,
): Promise<boolean | null> {
  try {
    return await fs.exists(rowUri);
  } catch {
    return null;
  }
}

async function readTodayHubRowMarkdownNormalized(
  fs: VaultFilesystem,
  rowUri: string,
): Promise<string | undefined> {
  try {
    const raw = await fs.readFile(rowUri, {encoding: 'utf8'});
    return normalizeVaultMarkdownDiskRead(raw);
  } catch {
    return undefined;
  }
}

async function syncTodayHubWeekRowFromDiskIfNeeded(
  open: TodayHubOpenCacheEnv,
  today: ReconcileFsTodayHubEnv,
  rowUri: string,
): Promise<void> {
  const rowExists = await pathExistsForTodayHubRow(open.fs, rowUri);
  if (rowExists === null) {
    return;
  }
  if (!rowExists) {
    today.todayHubRowLastPersistedRef.current.delete(rowUri);
    const rm = removeInboxNoteBodyFromCache(open.inboxContentByUriRef.current, rowUri);
    if (rm) {
      open.inboxContentByUriRef.current = rm;
      open.setInboxContentByUri(rm);
    }
    return;
  }
  const hubDiskBody = await readTodayHubRowMarkdownNormalized(open.fs, rowUri);
  if (hubDiskBody === undefined) {
    return;
  }
  const liveUri = today.todayHubBridgeRef.current.getLiveRowUri();
  if (liveUri === rowUri) {
    return;
  }
  const cached = open.inboxContentByUriRef.current[rowUri];
  if (cached === hubDiskBody) {
    today.todayHubRowLastPersistedRef.current.set(rowUri, hubDiskBody);
    return;
  }
  today.todayHubRowLastPersistedRef.current.set(rowUri, hubDiskBody);
  const nextHubCache = mergeInboxNoteBodyIntoCache(
    open.inboxContentByUriRef.current,
    rowUri,
    hubDiskBody,
  );
  if (nextHubCache) {
    open.inboxContentByUriRef.current = nextHubCache;
    open.setInboxContentByUri(prev =>
      mergeInboxNoteBodyIntoCache(prev, rowUri, hubDiskBody) ?? prev,
    );
  }
}

export async function reconcileTodayHubWeekRowsAfterVaultFsChange(
  open: TodayHubOpenCacheEnv,
  today: ReconcileFsTodayHubEnv,
  args: {fullRefresh: boolean; normPaths: string[]; root: string},
): Promise<void> {
  const {fullRefresh, normPaths, root} = args;
  const normToday = open.selectedUriRef.current?.replace(/\\/g, '/');
  if (!normToday || !vaultUriIsTodayMarkdownFile(normToday) || open.composingNewEntryRef.current) {
    return;
  }
  const hubDir = vaultUriParentDirectory(normToday);
  const hubStart = today.todayHubSettingsRef.current?.start ?? 'monday';
  for (const m of enumerateTodayHubWeekStarts(new Date(), hubStart)) {
    const rowUri = normalizeEditorDocUri(todayHubRowUri(hubDir, m));
    if (!fullRefresh && !fsChangePathsMayAffectUri(normPaths, rowUri, root)) {
      continue;
    }
    await syncTodayHubWeekRowFromDiskIfNeeded(open, today, rowUri);
  }
}

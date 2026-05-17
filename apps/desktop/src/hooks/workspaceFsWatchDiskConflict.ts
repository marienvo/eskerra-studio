/**
 * Vault filesystem watch → disk-conflict resolution for the active (selected) markdown tab.
 *
 * Covers: background-tab cache merge, reload-from-disk, three-way auto-merge,
 * recency-defer, and soft-conflict classification.
 */

import {normalizeEditorDocUri} from '../lib/editorDocumentHistory';
import {tryMergeThreeWayVaultMarkdown} from '../lib/vaultMarkdownThreeWayMerge';
import {
  mergeInboxNoteBodyIntoCache,
  normalizeVaultMarkdownDiskRead,
} from './inboxNoteBodyCache';
import type {
  DiskConflictSoftState,
  LastPersisted,
  ReconcileFsOpenMarkdownEnv,
} from './workspaceFsWatchReconcile';

const DISK_CONFLICT_RECENCY_MS = 2000;
const DISK_CONFLICT_DEFER_MS = 600;

/** Small stable fingerprint for debug logs (not crypto). */
export function fingerprintUtf16ForDebug(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

export function mergeInboxCacheWithDiskBodyForUri(
  open: ReconcileFsOpenMarkdownEnv,
  normTab: string,
  diskBody: string,
): void {
  const nextCache = mergeInboxNoteBodyIntoCache(
    open.inboxContentByUriRef.current,
    normTab,
    diskBody,
  );
  if (!nextCache) {
    return;
  }
  open.inboxContentByUriRef.current = nextCache;
  open.setInboxContentByUri(prev =>
    mergeInboxNoteBodyIntoCache(prev, normTab, diskBody) ?? prev,
  );
}

export function clearDiskConflictRefsForMatchingUri(
  open: ReconcileFsOpenMarkdownEnv,
  normTab: string,
): void {
  if (open.diskConflictRef.current?.uri === normTab) {
    open.setDiskConflict(null);
    open.diskConflictRef.current = null;
  }
  if (open.diskConflictSoftRef.current?.uri === normTab) {
    open.setDiskConflictSoft(null);
    open.diskConflictSoftRef.current = null;
  }
}

export function clearSoftDiskConflictRefIfUriMatches(
  open: ReconcileFsOpenMarkdownEnv,
  normTab: string,
): void {
  if (open.diskConflictSoftRef.current?.uri === normTab) {
    open.setDiskConflictSoft(null);
    open.diskConflictSoftRef.current = null;
  }
}

export async function mergeBackgroundTabCacheIfDiskChanged(
  open: ReconcileFsOpenMarkdownEnv,
  normTab: string,
  diskBody: string,
): Promise<void> {
  if (open.inboxContentByUriRef.current[normTab] !== diskBody) {
    mergeInboxCacheWithDiskBodyForUri(open, normTab, diskBody);
  }
}

export async function applyReloadFromDiskForFsWatch(
  open: ReconcileFsOpenMarkdownEnv,
  normTab: string,
  diskBody: string,
): Promise<void> {
  open.autosaveSchedulerRef.current.cancel();
  open.loadFullMarkdownIntoInboxEditor(diskBody, normTab, 'preserve');
  open.scheduleBacklinksDeferOneFrameAfterLoad();
  open.writeLastPersistedSnapshotWithoutSeqBump({uri: normTab, markdown: diskBody});
  open.bumpLastPersistedExternalMutationSeq();
  mergeInboxCacheWithDiskBodyForUri(open, normTab, diskBody);
  clearDiskConflictRefsForMatchingUri(open, normTab);
}

function tryScheduleDiskConflictRecencyDefer(
  open: ReconcileFsOpenMarkdownEnv,
  normTab: string,
  rerunForTab: (tab: string) => void,
): boolean {
  if (open.skipRecencyDeferForUriRef.current.has(normTab)) {
    open.skipRecencyDeferForUriRef.current.delete(normTab);
    return false;
  }
  if (Date.now() - open.lastInboxEditorActivityAtRef.current >= DISK_CONFLICT_RECENCY_MS) {
    return false;
  }
  if (open.diskConflictDeferTimerRef.current != null) {
    window.clearTimeout(open.diskConflictDeferTimerRef.current);
  }
  open.diskConflictDeferTimerRef.current = window.setTimeout(() => {
    open.diskConflictDeferTimerRef.current = null;
    open.skipRecencyDeferForUriRef.current.add(normTab);
    if (
      open.cancelled()
      || open.selectedUriRef.current !== normTab
      || open.composingNewEntryRef.current
    ) {
      open.skipRecencyDeferForUriRef.current.delete(normTab);
      return;
    }
    rerunForTab(normTab);
  }, DISK_CONFLICT_DEFER_MS);
  return true;
}

async function reconcileDiskConflictAfterMergeFailed(
  open: ReconcileFsOpenMarkdownEnv,
  normTab: string,
  diskBody: string,
  local: string,
  lp: LastPersisted | null,
  rerunForTab: (tab: string) => void,
): Promise<void> {
  if (tryScheduleDiskConflictRecencyDefer(open, normTab, rerunForTab)) {
    return;
  }
  const soft: DiskConflictSoftState = {uri: normTab, diskMarkdown: diskBody};
  console.debug('[disk-conflict-soft]', {
    uri: normTab,
    diskLen: diskBody.length,
    localLen: local.length,
    lastPersistedLen: lp?.markdown.length ?? 0,
    diskFp: fingerprintUtf16ForDebug(diskBody),
    localFp: fingerprintUtf16ForDebug(local),
    persistedFp: lp ? fingerprintUtf16ForDebug(lp.markdown) : null,
  });
  open.setDiskConflict(null);
  open.diskConflictRef.current = null;
  open.setDiskConflictSoft(soft);
  open.diskConflictSoftRef.current = soft;
}

export async function reconcileDiskConflictKindForSelectedTab(
  open: ReconcileFsOpenMarkdownEnv,
  args: {normTab: string; diskBody: string; local: string; lp: LastPersisted | null},
  rerunForTab: (tab: string) => void,
): Promise<void> {
  const {normTab, diskBody, local, lp} = args;
  open.autosaveSchedulerRef.current.cancel();

  if (lp != null && normalizeEditorDocUri(lp.uri) === normTab) {
    const merged = tryMergeThreeWayVaultMarkdown(lp.markdown, local, diskBody);
    if (merged.ok) {
      const mergedCanon = normalizeVaultMarkdownDiskRead(merged.merged);
      open.loadFullMarkdownIntoInboxEditor(mergedCanon, normTab, 'preserve');
      open.scheduleBacklinksDeferOneFrameAfterLoad();
      open.writeLastPersistedSnapshotWithoutSeqBump({uri: normTab, markdown: mergedCanon});
      open.bumpLastPersistedExternalMutationSeq();
      mergeInboxCacheWithDiskBodyForUri(open, normTab, mergedCanon);
      clearDiskConflictRefsForMatchingUri(open, normTab);
      console.debug('[disk-merge]', {uri: normTab, mergedLen: mergedCanon.length});
      return;
    }
  }

  await reconcileDiskConflictAfterMergeFailed(open, normTab, diskBody, local, lp, rerunForTab);
}

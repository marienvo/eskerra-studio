/**
 * Vault filesystem watch → open markdown tab reconcile (orchestration helpers).
 *
 * Ownership: pure-ish side-effect helpers driven by refs/setters from
 * `useMainWindowWorkspace`; keep vault-watch disk/cache/tab logic here so the hook
 * stays an orchestration shell.
 */

import type {
  Dispatch,
  MutableRefObject,
  RefObject,
  SetStateAction,
} from 'react';

import type {VaultFilesystem} from '@eskerra/core';

import type {NoteMarkdownEditorHandle} from '../editor/noteEditor/NoteMarkdownEditor';
import {
  collectDistinctUrisFromTabs,
  ensureActiveTabId,
  findTabById,
  firstSurvivorUriFromTabs,
  removeUriFromAllTabs,
  tabCurrentUri,
  type EditorWorkspaceTab,
} from '../lib/editorWorkspaceTabs';
import {normalizeEditorDocUri} from '../lib/editorDocumentHistory';
import {
  enumerateTodayHubWeekStarts,
  todayHubRowUri,
  type TodayHubSettings,
  type TodayHubWorkspaceBridge,
} from '../lib/todayHub';
import {vaultUriParentDirectory} from '../lib/vaultUriPaths';
import {vaultUriIsTodayMarkdownFile} from '../lib/vaultTreeLoadChildren';
import {tryMergeThreeWayVaultMarkdown} from '../lib/vaultMarkdownThreeWayMerge';
import {
  clearInboxYamlFrontmatterEditorRefs,
  inboxEditorSliceToFullMarkdown,
} from '../lib/inboxYamlFrontmatterEditor';
import {
  classifyNoteDiskReconcile,
  fsChangePathsMayAffectUri,
  mergeInboxNoteBodyIntoCache,
  normalizeVaultMarkdownDiskRead,
  removeInboxNoteBodyFromCache,
} from './inboxNoteBodyCache';
import type {InboxAutosaveScheduler} from '../lib/inboxAutosaveScheduler';

export type LastPersisted = {uri: string; markdown: string};

export type DiskConflictState = {uri: string; diskMarkdown: string};

/** Non-blocking: disk diverged while editing; autosave may continue until user opens full resolve. */
export type DiskConflictSoftState = {uri: string; diskMarkdown: string};

/** Skip showing an immediate blocking disk conflict if the user just edited; one deferred re-check follows. */
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

/**
 * Open-tab inbox reconcile after vault FS events: tabs, cache, editor, autosave, disk conflicts.
 * Split from {@link ReconcileFsTodayHubEnv} so helpers declare whether they touch Today hub state
 * (review: avoid one undifferentiated env for all vault-watch side effects).
 */
export type ReconcileFsOpenMarkdownEnv = {
  cancelled: () => boolean;
  fs: VaultFilesystem;
  vaultRootRef: MutableRefObject<string | null>;
  editorWorkspaceTabsRef: MutableRefObject<EditorWorkspaceTab[]>;
  selectedUriRef: MutableRefObject<string | null>;
  activeEditorTabIdRef: MutableRefObject<string | null>;
  composingNewEntryRef: MutableRefObject<boolean>;
  diskConflictRef: MutableRefObject<DiskConflictState | null>;
  diskConflictSoftRef: MutableRefObject<DiskConflictSoftState | null>;
  inboxContentByUriRef: MutableRefObject<Record<string, string>>;
  lastPersistedRef: MutableRefObject<LastPersisted | null>;
  editorBodyRef: MutableRefObject<string>;
  inboxYamlFrontmatterInnerRef: MutableRefObject<string | null>;
  inboxEditorYamlLeadingBeforeFrontmatterRef: MutableRefObject<string>;
  editorShellScrollByUriRef: MutableRefObject<Map<string, {top: number; left: number}>>;
  skipRecencyDeferForUriRef: MutableRefObject<Set<string>>;
  diskConflictDeferTimerRef: MutableRefObject<number | null>;
  lastInboxEditorActivityAtRef: MutableRefObject<number>;
  inboxEditorRef: RefObject<NoteMarkdownEditorHandle | null>;
  autosaveSchedulerRef: MutableRefObject<InboxAutosaveScheduler>;
  writeLastPersistedSnapshotWithoutSeqBump: (next: LastPersisted | null) => void;
  bumpLastPersistedExternalMutationSeq: () => void;
  setEditorWorkspaceTabs: Dispatch<SetStateAction<EditorWorkspaceTab[]>>;
  setActiveEditorTabId: Dispatch<SetStateAction<string | null>>;
  setDiskConflict: Dispatch<SetStateAction<DiskConflictState | null>>;
  setDiskConflictSoft: Dispatch<SetStateAction<DiskConflictSoftState | null>>;
  setInboxContentByUri: Dispatch<SetStateAction<Record<string, string>>>;
  setSelectedUri: Dispatch<SetStateAction<string | null>>;
  setComposingNewEntry: Dispatch<SetStateAction<boolean>>;
  setEditorBody: Dispatch<SetStateAction<string>>;
  setInboxEditorResetNonce: Dispatch<SetStateAction<number>>;
  setInboxYamlFrontmatterInner: Dispatch<SetStateAction<string | null>>;
  setInboxEditorYamlLeadingBeforeFrontmatter: Dispatch<SetStateAction<string>>;
  openMarkdownInEditor: (
    uri: string,
    opts?: {skipHistory?: boolean},
  ) => Promise<void>;
  loadFullMarkdownIntoInboxEditor: (
    markdown: string,
    uri: string,
    selection: 'preserve' | 'start',
  ) => void;
  scheduleBacklinksDeferOneFrameAfterLoad: () => void;
  /**
   * Drops pruned URIs from the shadow workspace model in the same turn as legacy tab strip edits.
   * Uses {@link removeUrisAction} so inactive-hub snapshots stay aligned without waiting for projection replace.
   */
  syncWorkspaceModelRemoveOpenTabUri?: (normalizedMarkdownUri: string) => void;
};

/** Today hub row disk/cache alignment; only used after open-tab reconcile in the same FS batch. */
export type ReconcileFsTodayHubEnv = {
  todayHubRowLastPersistedRef: MutableRefObject<Map<string, string>>;
  todayHubSettingsRef: MutableRefObject<TodayHubSettings | null>;
  todayHubBridgeRef: MutableRefObject<TodayHubWorkspaceBridge>;
};

function normalizeVaultFsWatchRawPaths(rawPaths: string[]): string[] {
  return rawPaths.map(p => p.trim().replace(/\\/g, '/')).filter(Boolean);
}

async function pathExistsForVaultWatch(
  fs: VaultFilesystem,
  normTab: string,
): Promise<boolean | null> {
  try {
    return await fs.exists(normTab);
  } catch {
    return null;
  }
}

async function readVaultMarkdownUtf8Normalized(
  fs: VaultFilesystem,
  normTab: string,
): Promise<string | undefined> {
  try {
    const raw = await fs.readFile(normTab, {encoding: 'utf8'});
    return normalizeVaultMarkdownDiskRead(raw);
  } catch {
    return undefined;
  }
}

function mergeInboxCacheWithDiskBodyForUri(
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

function clearDiskConflictRefsForMatchingUri(
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

function clearSoftDiskConflictRefIfUriMatches(
  open: ReconcileFsOpenMarkdownEnv,
  normTab: string,
): void {
  if (open.diskConflictSoftRef.current?.uri === normTab) {
    open.setDiskConflictSoft(null);
    open.diskConflictSoftRef.current = null;
  }
}

export async function applyExternalOpenNoteDeletedForFsWatch(
  open: ReconcileFsOpenMarkdownEnv,
  normTab: string,
): Promise<void> {
  const wasSelected = open.selectedUriRef.current === normTab;
  const nextTabs = removeUriFromAllTabs(
    open.editorWorkspaceTabsRef.current,
    u => u === normTab,
  );
  const nextActive = ensureActiveTabId(
    nextTabs,
    open.activeEditorTabIdRef.current,
  );
  open.editorWorkspaceTabsRef.current = nextTabs;
  open.setEditorWorkspaceTabs(nextTabs);
  open.activeEditorTabIdRef.current = nextActive;
  open.setActiveEditorTabId(nextActive);

  open.syncWorkspaceModelRemoveOpenTabUri?.(normTab);

  clearDiskConflictRefsForMatchingUri(open, normTab);

  open.editorShellScrollByUriRef.current.delete(normTab);

  const cacheNext = removeInboxNoteBodyFromCache(
    open.inboxContentByUriRef.current,
    normTab,
  );
  if (cacheNext) {
    open.inboxContentByUriRef.current = cacheNext;
    open.setInboxContentByUri(cacheNext);
  }

  if (!wasSelected) {
    return;
  }

  const activeTab = nextActive
    ? findTabById(nextTabs, nextActive)
    : undefined;
  const nextAfterRemove =
    (activeTab ? tabCurrentUri(activeTab) : null)
    ?? firstSurvivorUriFromTabs(nextTabs);

  if (nextAfterRemove) {
    await open.openMarkdownInEditor(nextAfterRemove, {skipHistory: true});
  } else {
    open.selectedUriRef.current = null;
    open.composingNewEntryRef.current = false;
    open.writeLastPersistedSnapshotWithoutSeqBump(null);
    open.bumpLastPersistedExternalMutationSeq();
    open.setSelectedUri(null);
    open.setComposingNewEntry(false);
    clearInboxYamlFrontmatterEditorRefs({
      inner: open.inboxYamlFrontmatterInnerRef,
      leading: open.inboxEditorYamlLeadingBeforeFrontmatterRef,
      setInner: open.setInboxYamlFrontmatterInner,
      setLeading: open.setInboxEditorYamlLeadingBeforeFrontmatter,
    });
    open.setEditorBody('');
    open.setInboxEditorResetNonce(n => n + 1);
  }
}

async function mergeBackgroundTabCacheIfDiskChanged(
  open: ReconcileFsOpenMarkdownEnv,
  normTab: string,
  diskBody: string,
): Promise<void> {
  const cached = open.inboxContentByUriRef.current[normTab];
  if (cached === diskBody) {
    return;
  }
  mergeInboxCacheWithDiskBodyForUri(open, normTab, diskBody);
}

async function applyReloadFromDiskForFsWatch(
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
  const skipRecency = open.skipRecencyDeferForUriRef.current.has(normTab);
  if (skipRecency) {
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

async function reconcileDiskConflictKindForSelectedTab(
  open: ReconcileFsOpenMarkdownEnv,
  args: {
    normTab: string;
    diskBody: string;
    local: string;
    lp: LastPersisted | null;
  },
  rerunForTab: (tab: string) => void,
): Promise<void> {
  const {normTab, diskBody, local, lp} = args;
  open.autosaveSchedulerRef.current.cancel();

  if (lp != null && normalizeEditorDocUri(lp.uri) === normTab) {
    const merged = tryMergeThreeWayVaultMarkdown(
      lp.markdown,
      local,
      diskBody,
    );
    if (merged.ok) {
      const mergedCanon = normalizeVaultMarkdownDiskRead(merged.merged);
      open.loadFullMarkdownIntoInboxEditor(mergedCanon, normTab, 'preserve');
      open.scheduleBacklinksDeferOneFrameAfterLoad();
      open.writeLastPersistedSnapshotWithoutSeqBump({uri: normTab, markdown: mergedCanon});
      open.bumpLastPersistedExternalMutationSeq();
      mergeInboxCacheWithDiskBodyForUri(open, normTab, mergedCanon);
      clearDiskConflictRefsForMatchingUri(open, normTab);
      console.debug('[disk-merge]', {
        uri: normTab,
        mergedLen: mergedCanon.length,
      });
      return;
    }
  }

  await reconcileDiskConflictAfterMergeFailed(
    open,
    normTab,
    diskBody,
    local,
    lp,
    rerunForTab,
  );
}

async function reconcileOneOpenMarkdownTabAfterDiskRead(
  open: ReconcileFsOpenMarkdownEnv,
  args: {normTab: string; diskBody: string},
  rerunForTab: (tab: string) => void,
): Promise<void> {
  const {normTab, diskBody} = args;
  const isSelected =
    open.selectedUriRef.current === normTab && !open.composingNewEntryRef.current;
  if (!isSelected) {
    await mergeBackgroundTabCacheIfDiskChanged(open, normTab, diskBody);
    return;
  }

  const local = inboxEditorSliceToFullMarkdown(
    open.inboxEditorRef.current?.getMarkdown() ?? open.editorBodyRef.current,
    normTab,
    open.composingNewEntryRef.current,
    open.inboxYamlFrontmatterInnerRef.current,
    open.inboxEditorYamlLeadingBeforeFrontmatterRef.current,
  );
  const lp = open.lastPersistedRef.current;
  const kind = classifyNoteDiskReconcile({
    noteUri: normTab,
    lastPersisted: lp,
    diskMarkdown: diskBody,
    localMarkdown: local,
  });

  if (kind === 'noop') {
    clearSoftDiskConflictRefIfUriMatches(open, normTab);
    return;
  }
  if (kind === 'reload_from_disk') {
    await applyReloadFromDiskForFsWatch(open, normTab, diskBody);
    return;
  }

  await reconcileDiskConflictKindForSelectedTab(
    open,
    {normTab, diskBody, local, lp},
    rerunForTab,
  );
}

async function syncTodayHubWeekRowFromDiskIfNeeded(
  open: ReconcileFsOpenMarkdownEnv,
  today: ReconcileFsTodayHubEnv,
  rowUri: string,
): Promise<void> {
  const rowExists = await pathExistsForVaultWatch(open.fs, rowUri);
  if (rowExists === null) {
    return;
  }
  if (!rowExists) {
    today.todayHubRowLastPersistedRef.current.delete(rowUri);
    const rm = removeInboxNoteBodyFromCache(
      open.inboxContentByUriRef.current,
      rowUri,
    );
    if (rm) {
      open.inboxContentByUriRef.current = rm;
      open.setInboxContentByUri(rm);
    }
    return;
  }
  const hubDiskBody = await readVaultMarkdownUtf8Normalized(open.fs, rowUri);
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

async function reconcileTodayHubWeekRowsAfterVaultFsChange(
  open: ReconcileFsOpenMarkdownEnv,
  today: ReconcileFsTodayHubEnv,
  args: {fullRefresh: boolean; normPaths: string[]; root: string},
): Promise<void> {
  const {fullRefresh, normPaths, root} = args;
  const todaySel = open.selectedUriRef.current;
  const normToday = todaySel?.replace(/\\/g, '/');
  if (
    !normToday
    || !vaultUriIsTodayMarkdownFile(normToday)
    || open.composingNewEntryRef.current
  ) {
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

async function reconcileOpenWorkspaceTabUriForVaultWatch(
  open: ReconcileFsOpenMarkdownEnv,
  tabUri: string,
  root: string,
  fullRefresh: boolean,
  normPaths: string[],
  rerunForTab: (tab: string) => void,
): Promise<void> {
  const normTab = normalizeEditorDocUri(tabUri);
  if (!normTab.toLowerCase().endsWith('.md')) {
    return;
  }
  const inTab = collectDistinctUrisFromTabs(
    open.editorWorkspaceTabsRef.current,
  ).some(u => normalizeEditorDocUri(u) === normTab);
  // Also "still open" when it's the active home-navigated page (no active editor tab).
  const stillOpen = inTab || open.selectedUriRef.current === normTab;
  if (!stillOpen) {
    return;
  }
  if (!fullRefresh && !fsChangePathsMayAffectUri(normPaths, normTab, root)) {
    return;
  }

  const existsResult = await pathExistsForVaultWatch(open.fs, normTab);
  if (existsResult === null) {
    return;
  }
  if (!existsResult) {
    await applyExternalOpenNoteDeletedForFsWatch(open, normTab);
    return;
  }

  const diskBody = await readVaultMarkdownUtf8Normalized(open.fs, normTab);
  if (diskBody === undefined) {
    return;
  }

  await reconcileOneOpenMarkdownTabAfterDiskRead(
    open,
    {normTab, diskBody},
    rerunForTab,
  );
}

export async function reconcileOpenNotesAfterFsChangeFromVaultWatch(
  open: ReconcileFsOpenMarkdownEnv,
  today: ReconcileFsTodayHubEnv,
  rawPaths: string[],
  rerunForTab: (tab: string) => void,
): Promise<void> {
  const root = open.vaultRootRef.current;
  if (!root || open.cancelled()) {
    return;
  }
  const normPaths = normalizeVaultFsWatchRawPaths(rawPaths);
  if (normPaths.length === 0) {
    console.debug(
      '[vault-files-changed] empty path batch: reconciling every open markdown tab (coarse invalidation); Rust watcher only emits non-empty batches today',
    );
  }
  const fullRefresh = normPaths.length === 0;
  const tabs = collectDistinctUrisFromTabs(open.editorWorkspaceTabsRef.current);
  const tabNorms = new Set(tabs.map(u => normalizeEditorDocUri(u)));

  // Include the home-navigated page URI when no editor tab is active: a note open via workspace
  // home navigation is not in the tab strip but is still displayed in the editor and must be
  // reconciled like any open tab (e.g. wiki-link rename rewrites its file on disk).
  const homePageUri =
    !open.composingNewEntryRef.current &&
    open.activeEditorTabIdRef.current === null &&
    open.selectedUriRef.current &&
    !vaultUriIsTodayMarkdownFile(open.selectedUriRef.current) &&
    !tabNorms.has(normalizeEditorDocUri(open.selectedUriRef.current))
      ? open.selectedUriRef.current
      : null;

  const urisToReconcile = homePageUri ? [...tabs, homePageUri] : tabs;
  for (const tabUri of urisToReconcile) {
    await reconcileOpenWorkspaceTabUriForVaultWatch(
      open,
      tabUri,
      root,
      fullRefresh,
      normPaths,
      rerunForTab,
    );
  }

  await reconcileTodayHubWeekRowsAfterVaultFsChange(open, today, {
    fullRefresh,
    normPaths,
    root,
  });
}

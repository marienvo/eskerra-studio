/**
 * Vault filesystem watch → open markdown tab reconcile (orchestration helpers).
 *
 * Ownership: pure-ish side-effect helpers driven by refs/setters from
 * `useMainWindowWorkspace`; keep vault-watch disk/cache/tab logic here so the hook
 * stays an orchestration shell.
 *
 * Sub-modules:
 *  - {@link workspaceFsWatchDiskConflict} — reload/merge/conflict resolution for the active tab.
 *  - {@link workspaceFsWatchReconcileTodayHub} — Today Hub week-row disk/cache alignment.
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
import {vaultUriIsTodayMarkdownFile} from '../lib/vaultTreeLoadChildren';
import {
  clearInboxYamlFrontmatterEditorRefs,
  inboxEditorSliceToFullMarkdown,
} from '../lib/inboxYamlFrontmatterEditor';
import {
  classifyNoteDiskReconcile,
  fsChangePathsMayAffectUri,
  normalizeVaultMarkdownDiskRead,
  removeInboxNoteBodyFromCache,
} from './inboxNoteBodyCache';
import type {InboxAutosaveScheduler} from '../lib/inboxAutosaveScheduler';
import {
  applyReloadFromDiskForFsWatch,
  clearDiskConflictRefsForMatchingUri,
  clearSoftDiskConflictRefIfUriMatches,
  mergeBackgroundTabCacheIfDiskChanged,
  reconcileDiskConflictKindForSelectedTab,
} from './workspaceFsWatchDiskConflict';
import {reconcileTodayHubWeekRowsAfterVaultFsChange} from './workspaceFsWatchReconcileTodayHub';

// Re-exported for callers that import these names from this module.
export {fingerprintUtf16ForDebug} from './workspaceFsWatchDiskConflict';
export type {ReconcileFsTodayHubEnv} from './workspaceFsWatchReconcileTodayHub';

export type LastPersisted = {uri: string; markdown: string};

export type DiskConflictState = {uri: string; diskMarkdown: string};

/** Non-blocking: disk diverged while editing; autosave may continue until user opens full resolve. */
export type DiskConflictSoftState = {uri: string; diskMarkdown: string};

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

export async function applyExternalOpenNoteDeletedForFsWatch(
  open: ReconcileFsOpenMarkdownEnv,
  normTab: string,
): Promise<void> {
  const wasSelected = open.selectedUriRef.current === normTab;
  const nextTabs = removeUriFromAllTabs(
    open.editorWorkspaceTabsRef.current,
    u => u === normTab,
  );
  const nextActive = ensureActiveTabId(nextTabs, open.activeEditorTabIdRef.current);
  open.editorWorkspaceTabsRef.current = nextTabs;
  open.setEditorWorkspaceTabs(nextTabs);
  open.activeEditorTabIdRef.current = nextActive;
  open.setActiveEditorTabId(nextActive);

  open.syncWorkspaceModelRemoveOpenTabUri?.(normTab);

  clearDiskConflictRefsForMatchingUri(open, normTab);
  open.editorShellScrollByUriRef.current.delete(normTab);

  const cacheNext = removeInboxNoteBodyFromCache(open.inboxContentByUriRef.current, normTab);
  if (cacheNext) {
    open.inboxContentByUriRef.current = cacheNext;
    open.setInboxContentByUri(cacheNext);
  }

  if (!wasSelected) {
    return;
  }

  const activeTab = nextActive ? findTabById(nextTabs, nextActive) : undefined;
  const nextAfterRemove =
    (activeTab ? tabCurrentUri(activeTab) : null) ?? firstSurvivorUriFromTabs(nextTabs);

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

  await reconcileDiskConflictKindForSelectedTab(open, {normTab, diskBody, local, lp}, rerunForTab);
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

  await reconcileOneOpenMarkdownTabAfterDiskRead(open, {normTab, diskBody}, rerunForTab);
}

export async function reconcileOpenNotesAfterFsChangeFromVaultWatch(
  open: ReconcileFsOpenMarkdownEnv,
  today: import('./workspaceFsWatchReconcileTodayHub').ReconcileFsTodayHubEnv,
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

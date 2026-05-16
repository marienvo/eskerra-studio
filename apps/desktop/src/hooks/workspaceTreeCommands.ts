/**
 * Vault tree mutations invoked from the main workspace (delete, rename, move, bulk).
 * I/O and React wiring stay in {@link useMainWindowWorkspace}; this module holds the command bodies.
 */

import type {MutableRefObject} from 'react';
import type {Dispatch, SetStateAction} from 'react';

import {
  normalizeVaultBaseUri,
  SubtreeMarkdownPresenceCache,
  trimTrailingSlashes,
  type VaultFilesystem,
} from '@eskerra/core';

import {
  deleteVaultMarkdownNote,
  deleteVaultTreeDirectory,
  moveVaultTreeItemToDirectory,
  renameVaultTreeDirectory,
  type MoveVaultTreeItemResult,
} from '../lib/vaultBootstrap';
import {
  filterVaultTreeBulkMoveSources,
  planVaultTreeBulkTargets,
  type VaultTreeBulkItem,
} from '../lib/vaultTreeBulkPlan';
import {normalizeEditorDocUri, remapVaultUriPrefix} from '../lib/editorDocumentHistory';
import {
  ensureActiveTabId,
  findTabById,
  firstSurvivorUriFromTabs,
  remapAllTabsUriPrefix,
  removeUriFromAllTabs,
  tabCurrentUri,
  type EditorWorkspaceTab,
} from '../lib/editorWorkspaceTabs';
import {clearInboxYamlFrontmatterEditorRefs} from '../lib/inboxYamlFrontmatterEditor';
import {remapEditorShellScrollMapExact, remapEditorShellScrollMapTreePrefix} from './workspaceEditorScrollMap';
import {bulkDeleteUriRemovalPredicate, pruneEditorTabsAfterBulkTreeDelete} from './workspaceVaultTreeMutations';
import type {InboxAutosaveScheduler} from '../lib/inboxAutosaveScheduler';
import type {LastPersisted} from './workspaceFsWatchReconcile';
import type {OpenMarkdownInEditorOptions} from './workspaceOpenMarkdownCommand';

export type TreeCommandRefs = {
  autosaveSchedulerRef: MutableRefObject<InboxAutosaveScheduler>;
  saveChainRef: MutableRefObject<Promise<void>>;
  editorWorkspaceTabsRef: MutableRefObject<EditorWorkspaceTab[]>;
  activeEditorTabIdRef: MutableRefObject<string | null>;
  selectedUriRef: MutableRefObject<string | null>;
  composingNewEntryRef: MutableRefObject<boolean>;
  editorShellScrollByUriRef: MutableRefObject<Map<string, {top: number; left: number}>>;
  inboxYamlFrontmatterInnerRef: MutableRefObject<string | null>;
  inboxEditorYamlLeadingBeforeFrontmatterRef: MutableRefObject<string>;
  lastPersistedRef: MutableRefObject<LastPersisted | null>;
};

export type TreeCommandSetters = {
  setEditorWorkspaceTabs: Dispatch<SetStateAction<EditorWorkspaceTab[]>>;
  setActiveEditorTabId: Dispatch<SetStateAction<string | null>>;
  setInboxContentByUri: Dispatch<SetStateAction<Record<string, string>>>;
  setBusy: Dispatch<SetStateAction<boolean>>;
  setErr: Dispatch<SetStateAction<string | null>>;
  setFsRefreshNonce: Dispatch<SetStateAction<number>>;
  setSelectedUri: Dispatch<SetStateAction<string | null>>;
  setComposingNewEntry: Dispatch<SetStateAction<boolean>>;
  setEditorBody: Dispatch<SetStateAction<string>>;
  setInboxYamlFrontmatterInner: Dispatch<SetStateAction<string | null>>;
  setInboxEditorYamlLeadingBeforeFrontmatter: Dispatch<SetStateAction<string>>;
  setInboxEditorResetNonce: Dispatch<SetStateAction<number>>;
  setLastPersistedSnapshot: (next: LastPersisted) => void;
  clearLastPersistedSnapshot: () => void;
};

export type TreeCommandContext = {
  vaultRoot: string | null;
  fs: VaultFilesystem;
  subtreeMarkdownCache: SubtreeMarkdownPresenceCache;
  refs: TreeCommandRefs;
  setters: TreeCommandSetters;
  mirrorShadowHomeSurface: (reason: string) => void;
  mirrorShadowActiveTab: (tabId: string, reason: string) => void;
  removeHomeHistoryUris: (shouldRemove: (normalizedUri: string) => boolean) => void;
  markVaultWriteSettled: () => void;
  refreshNotes: (root: string) => Promise<void>;
  refocusAfterActiveTabRemoved: (
    closedNorm: string,
    nextTabs: readonly EditorWorkspaceTab[],
    nextActive: string | null,
  ) => Promise<void>;
  openMarkdownInEditor: (
    uri: string,
    options?: OpenMarkdownInEditorOptions,
  ) => Promise<void>;
  /** Same ref as workspace persistence flush; required before directory rename on disk. */
  flushInboxSaveRef: MutableRefObject<() => Promise<void>>;
  /** Clears transient wiki-rename notices (shared with {@link useWorkspaceRenameMaintenance}). */
  clearRenameNotice: () => void;
  /** Updates ref + React tab strip (same helper as wiki-link rename commit path). */
  replaceEditorWorkspaceTabs: (nextTabs: EditorWorkspaceTab[]) => void;
  /** Model-backed home history remap (same as {@link commitRenameMaintenanceResult} when URI changes). */
  remapHomeStatesPrefix: (oldPrefix: string, newPrefix: string) => void;
  clearInboxSelection: () => void;
  setVaultTreeSelectionClearNonce: Dispatch<SetStateAction<number>>;
};

export async function runDeleteNote(ctx: TreeCommandContext, uri: string): Promise<void> {
  const {vaultRoot, fs, subtreeMarkdownCache, refs, setters} = ctx;
  if (!vaultRoot) {
    return;
  }
  const {
    autosaveSchedulerRef,
    saveChainRef,
    editorWorkspaceTabsRef,
    activeEditorTabIdRef,
    selectedUriRef,
    editorShellScrollByUriRef,
  } = refs;
  const {
    setEditorWorkspaceTabs,
    setActiveEditorTabId,
    setInboxContentByUri,
    setBusy,
    setErr,
    setFsRefreshNonce,
  } = setters;

  autosaveSchedulerRef.current.cancel();
  await saveChainRef.current.catch(() => undefined);

  const norm = normalizeEditorDocUri(uri);
  const wasOpen = selectedUriRef.current === norm;
  const nextTabs = removeUriFromAllTabs(editorWorkspaceTabsRef.current, u => u === norm);
  const nextActive = ensureActiveTabId(nextTabs, activeEditorTabIdRef.current);
  editorWorkspaceTabsRef.current = nextTabs;
  setEditorWorkspaceTabs(nextTabs);
  activeEditorTabIdRef.current = nextActive;
  setActiveEditorTabId(nextActive);
  if (nextActive == null) {
    ctx.mirrorShadowHomeSurface('delete note home surface');
  } else {
    ctx.mirrorShadowActiveTab(nextActive, 'delete note active tab');
  }
  ctx.removeHomeHistoryUris(u => u === norm);
  editorShellScrollByUriRef.current.delete(norm);

  if (wasOpen) {
    await ctx.refocusAfterActiveTabRemoved(norm, nextTabs, nextActive);
  }

  setBusy(true);
  setErr(null);
  try {
    await deleteVaultMarkdownNote(vaultRoot, uri, fs);
    subtreeMarkdownCache.invalidateForMutation(vaultRoot, uri, 'file');
    setInboxContentByUri(prev => {
      const next = {...prev};
      delete next[uri];
      return next;
    });
    ctx.markVaultWriteSettled();
    await ctx.refreshNotes(vaultRoot);
    setFsRefreshNonce(n => n + 1);
  } catch (e) {
    setErr(e instanceof Error ? e.message : String(e));
  } finally {
    setBusy(false);
  }
}

export async function runDeleteFolder(
  ctx: TreeCommandContext,
  directoryUri: string,
): Promise<void> {
  const {vaultRoot, fs, subtreeMarkdownCache, refs, setters} = ctx;
  if (!vaultRoot) {
    return;
  }
  const {
    autosaveSchedulerRef,
    saveChainRef,
    editorWorkspaceTabsRef,
    activeEditorTabIdRef,
    selectedUriRef,
    composingNewEntryRef,
    inboxYamlFrontmatterInnerRef,
    inboxEditorYamlLeadingBeforeFrontmatterRef,
  } = refs;
  const {
    setEditorWorkspaceTabs,
    setActiveEditorTabId,
    setInboxContentByUri,
    setBusy,
    setErr,
    setFsRefreshNonce,
    setSelectedUri,
    setComposingNewEntry,
    setEditorBody,
    setInboxYamlFrontmatterInner,
    setInboxEditorYamlLeadingBeforeFrontmatter,
    setInboxEditorResetNonce,
    clearLastPersistedSnapshot,
  } = setters;

  autosaveSchedulerRef.current.cancel();
  const normDir = trimTrailingSlashes(directoryUri.replace(/\\/g, '/'));
  const selected = selectedUriRef.current?.replace(/\\/g, '/');
  const clearsSelection =
    selected != null && (selected === normDir || selected.startsWith(`${normDir}/`));
  if (clearsSelection) {
    selectedUriRef.current = null;
    composingNewEntryRef.current = false;
    clearLastPersistedSnapshot();
    setSelectedUri(null);
    setComposingNewEntry(false);
    clearInboxYamlFrontmatterEditorRefs({
      inner: inboxYamlFrontmatterInnerRef,
      leading: inboxEditorYamlLeadingBeforeFrontmatterRef,
      setInner: setInboxYamlFrontmatterInner,
      setLeading: setInboxEditorYamlLeadingBeforeFrontmatter,
    });
    setEditorBody('');
    setInboxEditorResetNonce(n => n + 1);
  }
  await saveChainRef.current.catch(() => undefined);
  setBusy(true);
  setErr(null);
  try {
    await deleteVaultTreeDirectory(vaultRoot, directoryUri, fs);
    subtreeMarkdownCache.invalidateForMutation(vaultRoot, directoryUri, 'directory');
    setInboxContentByUri(prev => {
      const norm = normDir;
      const next = {...prev};
      for (const k of Object.keys(next)) {
        const kn = k.replace(/\\/g, '/');
        if (kn === norm || kn.startsWith(`${norm}/`)) {
          delete next[k];
        }
      }
      return next;
    });
    const tabPred = (u: string) => {
      const f = normDir;
      return u === f || u.startsWith(`${f}/`);
    };
    const newTabs = removeUriFromAllTabs(editorWorkspaceTabsRef.current, tabPred);
    const nextActive = ensureActiveTabId(newTabs, activeEditorTabIdRef.current);
    editorWorkspaceTabsRef.current = newTabs;
    setEditorWorkspaceTabs(newTabs);
    activeEditorTabIdRef.current = nextActive;
    setActiveEditorTabId(nextActive);
    if (nextActive == null) {
      ctx.mirrorShadowHomeSurface('delete folder home surface');
    } else {
      ctx.mirrorShadowActiveTab(nextActive, 'delete folder active tab');
    }
    ctx.removeHomeHistoryUris(tabPred);
    if (clearsSelection) {
      const activeTab = nextActive ? findTabById(newTabs, nextActive) : undefined;
      const nextUri =
        (activeTab ? tabCurrentUri(activeTab) : null) ?? firstSurvivorUriFromTabs(newTabs);
      if (nextUri) {
        await ctx.openMarkdownInEditor(nextUri, {skipHistory: true});
      }
    }
    ctx.markVaultWriteSettled();
    await ctx.refreshNotes(vaultRoot);
    setFsRefreshNonce(n => n + 1);
  } catch (e) {
    setErr(e instanceof Error ? e.message : String(e));
  } finally {
    setBusy(false);
  }
}

export async function runRenameFolder(
  ctx: TreeCommandContext,
  directoryUri: string,
  nextDisplayName: string,
): Promise<void> {
  const {vaultRoot, fs, subtreeMarkdownCache, refs, setters} = ctx;
  if (!vaultRoot) {
    return;
  }
  const {
    autosaveSchedulerRef,
    selectedUriRef,
    editorWorkspaceTabsRef,
    editorShellScrollByUriRef,
    lastPersistedRef,
  } = refs;
  const {setBusy, setErr, setInboxContentByUri, setSelectedUri, setFsRefreshNonce, setLastPersistedSnapshot} =
    setters;

  autosaveSchedulerRef.current.cancel();
  await ctx.flushInboxSaveRef.current();
  setBusy(true);
  setErr(null);
  ctx.clearRenameNotice();
  try {
    const oldUri = trimTrailingSlashes(directoryUri.replace(/\\/g, '/'));
    const nextUri = await renameVaultTreeDirectory(
      vaultRoot,
      directoryUri,
      nextDisplayName,
      fs,
    );
    const normalizedNext = nextUri.replace(/\\/g, '/');
    subtreeMarkdownCache.invalidateForMutation(vaultRoot, oldUri, 'directory');
    subtreeMarkdownCache.invalidateForMutation(vaultRoot, normalizedNext, 'directory');
    setInboxContentByUri(prev => {
      const next = {...prev};
      for (const k of Object.keys(prev)) {
        const mapped = remapVaultUriPrefix(k, oldUri, normalizedNext);
        if (mapped && mapped !== k && prev[k] !== undefined) {
          next[mapped] = prev[k]!;
          delete next[k];
        }
      }
      return next;
    });
    remapEditorShellScrollMapTreePrefix(
      editorShellScrollByUriRef.current,
      oldUri,
      normalizedNext,
    );
    {
      let nextSel: string | null = selectedUriRef.current;
      if (nextSel) {
        const mappedSel = remapVaultUriPrefix(
          nextSel.replace(/\\/g, '/'),
          oldUri,
          normalizedNext,
        );
        nextSel = mappedSel ?? nextSel;
      }
      selectedUriRef.current = nextSel;
      setSelectedUri(nextSel);
    }
    const lp = lastPersistedRef.current;
    if (lp) {
      const mappedLp = remapVaultUriPrefix(lp.uri, oldUri, normalizedNext);
      if (mappedLp) {
        setLastPersistedSnapshot({...lp, uri: mappedLp});
      }
    }
    const remappedTabs = remapAllTabsUriPrefix(
      editorWorkspaceTabsRef.current,
      oldUri,
      normalizedNext,
    );
    ctx.replaceEditorWorkspaceTabs(remappedTabs);
    ctx.remapHomeStatesPrefix(oldUri, normalizedNext);
    ctx.markVaultWriteSettled();
    await ctx.refreshNotes(vaultRoot);
    setFsRefreshNonce(n => n + 1);
  } catch (e) {
    setErr(e instanceof Error ? e.message : String(e));
  } finally {
    setBusy(false);
  }
}

function applyMovedArticleResult(ctx: TreeCommandContext, previousUri: string, nextUri: string): void {
  const {refs, setters} = ctx;
  const {selectedUriRef, editorShellScrollByUriRef, lastPersistedRef} = refs;
  const {setInboxContentByUri, setSelectedUri, setLastPersistedSnapshot} = setters;

  setInboxContentByUri(prev => {
    if (prev[previousUri] === undefined) {
      return prev;
    }
    const next = {...prev};
    next[nextUri] = next[previousUri]!;
    delete next[previousUri];
    return next;
  });
  remapEditorShellScrollMapExact(editorShellScrollByUriRef.current, previousUri, nextUri);
  if (selectedUriRef.current !== previousUri) {
    return;
  }
  selectedUriRef.current = nextUri;
  setSelectedUri(nextUri);
  const lp = lastPersistedRef.current;
  if (lp && lp.uri === previousUri) {
    setLastPersistedSnapshot({...lp, uri: nextUri});
  }
}

function applyMovedDirectoryResult(ctx: TreeCommandContext, oldUri: string, newUri: string): void {
  const {refs, setters} = ctx;
  const {
    selectedUriRef,
    editorShellScrollByUriRef,
    lastPersistedRef,
  } = refs;
  const {setInboxContentByUri, setSelectedUri, setLastPersistedSnapshot} = setters;

  setInboxContentByUri(prev => {
    const next = {...prev};
    for (const k of Object.keys(prev)) {
      const mapped = remapVaultUriPrefix(k, oldUri, newUri);
      if (mapped && mapped !== k && prev[k] !== undefined) {
        next[mapped] = prev[k]!;
        delete next[k];
      }
    }
    return next;
  });
  remapEditorShellScrollMapTreePrefix(editorShellScrollByUriRef.current, oldUri, newUri);
  let nextSel: string | null = selectedUriRef.current;
  if (nextSel) {
    const mappedSel = remapVaultUriPrefix(nextSel.replace(/\\/g, '/'), oldUri, newUri);
    nextSel = mappedSel ?? nextSel;
  }
  selectedUriRef.current = nextSel;
  setSelectedUri(nextSel);
  const lp = lastPersistedRef.current;
  if (lp) {
    const mappedLp = remapVaultUriPrefix(lp.uri, oldUri, newUri);
    if (mappedLp) {
      setLastPersistedSnapshot({...lp, uri: mappedLp});
    }
  }
}

export function runCommitMoveVaultTreeResult(
  ctx: TreeCommandContext,
  result: MoveVaultTreeItemResult,
): void {
  const {vaultRoot, subtreeMarkdownCache, refs} = ctx;
  if (!vaultRoot || result.previousUri === result.nextUri) {
    return;
  }
  const invKind = result.movedKind === 'article' ? 'file' : 'directory';
  subtreeMarkdownCache.invalidateForMutation(vaultRoot, result.previousUri, invKind);
  subtreeMarkdownCache.invalidateForMutation(vaultRoot, result.nextUri, invKind);

  if (result.movedKind === 'article') {
    applyMovedArticleResult(ctx, result.previousUri, result.nextUri);
  } else {
    applyMovedDirectoryResult(ctx, result.previousUri, result.nextUri);
  }
  const remappedMoveTabs = remapAllTabsUriPrefix(
    refs.editorWorkspaceTabsRef.current,
    result.previousUri,
    result.nextUri,
  );
  ctx.replaceEditorWorkspaceTabs(remappedMoveTabs);
  ctx.remapHomeStatesPrefix(result.previousUri, result.nextUri);
}

export async function runMoveVaultTreeItem(
  ctx: TreeCommandContext,
  sourceUri: string,
  sourceKind: 'folder' | 'article',
  targetDirectoryUri: string,
): Promise<void> {
  const {vaultRoot, fs, refs, setters} = ctx;
  if (!vaultRoot) {
    return;
  }
  const {autosaveSchedulerRef} = refs;
  const {setBusy, setErr, setFsRefreshNonce} = setters;

  autosaveSchedulerRef.current.cancel();
  await ctx.flushInboxSaveRef.current();
  setBusy(true);
  setErr(null);
  try {
    const result = await moveVaultTreeItemToDirectory(vaultRoot, fs, {
      sourceUri,
      sourceKind,
      targetDirectoryUri,
    });
    runCommitMoveVaultTreeResult(ctx, result);
    ctx.markVaultWriteSettled();
    await ctx.refreshNotes(vaultRoot);
    setFsRefreshNonce(n => n + 1);
  } catch (e) {
    setErr(e instanceof Error ? e.message : String(e));
  } finally {
    setBusy(false);
  }
}

export async function runBulkDeleteRemoveVaultEntry(
  ctx: TreeCommandContext,
  entry: VaultTreeBulkItem,
  root: string,
): Promise<void> {
  const {fs, subtreeMarkdownCache, setters} = ctx;
  const {setInboxContentByUri} = setters;
  if (entry.kind === 'article') {
    await deleteVaultMarkdownNote(root, entry.uri, fs);
    subtreeMarkdownCache.invalidateForMutation(root, entry.uri, 'file');
    setInboxContentByUri(prev => {
      if (prev[entry.uri] === undefined) {
        return prev;
      }
      const next = {...prev};
      delete next[entry.uri];
      return next;
    });
    return;
  }
  const normDir = trimTrailingSlashes(entry.uri.replace(/\\/g, '/'));
  await deleteVaultTreeDirectory(root, entry.uri, fs);
  subtreeMarkdownCache.invalidateForMutation(root, entry.uri, 'directory');
  setInboxContentByUri(prev => {
    const next = {...prev};
    for (const k of Object.keys(next)) {
      const kn = k.replace(/\\/g, '/');
      if (kn === normDir || kn.startsWith(`${normDir}/`)) {
        delete next[k];
      }
    }
    return next;
  });
}

export function runBulkDeletePruneTabsAndScroll(
  ctx: TreeCommandContext,
  plan: readonly VaultTreeBulkItem[],
): {newTabs: EditorWorkspaceTab[]; nextActive: string | null} {
  const {refs, setters, mirrorShadowHomeSurface, mirrorShadowActiveTab, removeHomeHistoryUris} = ctx;
  const {editorShellScrollByUriRef, editorWorkspaceTabsRef, activeEditorTabIdRef} = refs;
  const {setEditorWorkspaceTabs, setActiveEditorTabId} = setters;

  const sm = editorShellScrollByUriRef.current;
  const {newTabs, nextActive, scrollKeysToRemove} = pruneEditorTabsAfterBulkTreeDelete({
    editorWorkspaceTabs: editorWorkspaceTabsRef.current,
    activeEditorTabId: activeEditorTabIdRef.current,
    plan,
    scrollMapKeys: sm.keys(),
  });
  editorWorkspaceTabsRef.current = newTabs;
  setEditorWorkspaceTabs(newTabs);
  activeEditorTabIdRef.current = nextActive;
  setActiveEditorTabId(nextActive);
  if (nextActive == null) {
    mirrorShadowHomeSurface('bulk delete home surface');
  } else {
    mirrorShadowActiveTab(nextActive, 'bulk delete active tab');
  }
  removeHomeHistoryUris(bulkDeleteUriRemovalPredicate(plan));
  for (const key of scrollKeysToRemove) {
    sm.delete(key);
  }
  return {newTabs, nextActive};
}

export async function runBulkDeleteVaultTreeItems(
  ctx: TreeCommandContext,
  items: VaultTreeBulkItem[],
): Promise<void> {
  const {vaultRoot, refs, setters} = ctx;
  if (!vaultRoot) {
    return;
  }
  const {autosaveSchedulerRef, saveChainRef, selectedUriRef} = refs;
  const {setBusy, setErr, setFsRefreshNonce} = setters;

  const rootId = trimTrailingSlashes(normalizeVaultBaseUri(vaultRoot).replace(/\\/g, '/'));
  const plan = planVaultTreeBulkTargets(items, rootId);
  if (plan.length === 0) {
    return;
  }
  autosaveSchedulerRef.current.cancel();
  const normSel = selectedUriRef.current?.replace(/\\/g, '/');
  const shouldClearEditor =
    normSel != null
    && plan.some(entry => {
      const d = trimTrailingSlashes(entry.uri.replace(/\\/g, '/'));
      if (entry.kind === 'folder' || entry.kind === 'todayHub') {
        return normSel === d || normSel.startsWith(`${d}/`);
      }
      return normSel === d;
    });
  if (shouldClearEditor) {
    ctx.clearInboxSelection();
  }
  await saveChainRef.current.catch(() => undefined);
  setBusy(true);
  setErr(null);
  try {
    for (const entry of plan) {
      await runBulkDeleteRemoveVaultEntry(ctx, entry, vaultRoot);
    }
    const {newTabs, nextActive} = runBulkDeletePruneTabsAndScroll(ctx, plan);
    if (shouldClearEditor) {
      const activeTab = nextActive ? findTabById(newTabs, nextActive) : undefined;
      const nextUri =
        (activeTab ? tabCurrentUri(activeTab) : null) ?? firstSurvivorUriFromTabs(newTabs);
      if (nextUri) {
        await ctx.openMarkdownInEditor(nextUri, {skipHistory: true});
      }
    }
    ctx.markVaultWriteSettled();
    await ctx.refreshNotes(vaultRoot);
    setFsRefreshNonce(n => n + 1);
    ctx.setVaultTreeSelectionClearNonce(n => n + 1);
  } catch (e) {
    setErr(e instanceof Error ? e.message : String(e));
  } finally {
    setBusy(false);
  }
}

export async function runBulkMoveVaultTreeItems(
  ctx: TreeCommandContext,
  items: VaultTreeBulkItem[],
  targetDirectoryUri: string,
): Promise<void> {
  const {vaultRoot, fs, refs, setters} = ctx;
  if (!vaultRoot) {
    return;
  }
  const {autosaveSchedulerRef} = refs;
  const {setBusy, setErr, setFsRefreshNonce} = setters;

  const rootId = trimTrailingSlashes(normalizeVaultBaseUri(vaultRoot).replace(/\\/g, '/'));
  const plan = filterVaultTreeBulkMoveSources(items, targetDirectoryUri, rootId);
  if (plan.length === 0) {
    return;
  }
  autosaveSchedulerRef.current.cancel();
  await ctx.flushInboxSaveRef.current();
  setBusy(true);
  setErr(null);
  try {
    for (const entry of plan) {
      const result = await moveVaultTreeItemToDirectory(vaultRoot, fs, {
        sourceUri: entry.uri,
        sourceKind: entry.kind === 'article' ? 'article' : 'folder',
        targetDirectoryUri,
      });
      runCommitMoveVaultTreeResult(ctx, result);
    }
    ctx.markVaultWriteSettled();
    await ctx.refreshNotes(vaultRoot);
    setFsRefreshNonce(n => n + 1);
    ctx.setVaultTreeSelectionClearNonce(n => n + 1);
  } catch (e) {
    setErr(e instanceof Error ? e.message : String(e));
  } finally {
    setBusy(false);
  }
}

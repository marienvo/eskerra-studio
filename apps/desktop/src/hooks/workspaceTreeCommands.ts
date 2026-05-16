/**
 * Vault tree mutations invoked from the main workspace (delete, rename, move, bulk).
 * I/O and React wiring stay in {@link useMainWindowWorkspace}; this module holds the command bodies.
 */

import type {MutableRefObject} from 'react';
import type {Dispatch, SetStateAction} from 'react';

import {
  SubtreeMarkdownPresenceCache,
  trimTrailingSlashes,
  type VaultFilesystem,
} from '@eskerra/core';

import {
  deleteVaultMarkdownNote,
  deleteVaultTreeDirectory,
  renameVaultTreeDirectory,
} from '../lib/vaultBootstrap';
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
import {remapEditorShellScrollMapTreePrefix} from './workspaceEditorScrollMap';
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
  lastPersistedExternalMutationSeqRef: MutableRefObject<number>;
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
};

export type TreeCommandContext = {
  vaultRoot: string | null;
  fs: VaultFilesystem;
  subtreeMarkdownCache: SubtreeMarkdownPresenceCache;
  refs: TreeCommandRefs;
  setters: TreeCommandSetters;
  mirrorShadowHomeSurface: (reason: string) => void;
  mirrorShadowActiveTab: (tabId: string | null, reason: string) => void;
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
    lastPersistedRef,
    lastPersistedExternalMutationSeqRef,
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
  } = setters;

  autosaveSchedulerRef.current.cancel();
  const normDir = trimTrailingSlashes(directoryUri.replace(/\\/g, '/'));
  const selected = selectedUriRef.current?.replace(/\\/g, '/');
  const clearsSelection =
    selected != null && (selected === normDir || selected.startsWith(`${normDir}/`));
  if (clearsSelection) {
    selectedUriRef.current = null;
    composingNewEntryRef.current = false;
    lastPersistedRef.current = null;
    lastPersistedExternalMutationSeqRef.current += 1;
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
    lastPersistedExternalMutationSeqRef,
  } = refs;
  const {setBusy, setErr, setInboxContentByUri, setSelectedUri, setFsRefreshNonce} = setters;

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
        lastPersistedRef.current = {...lp, uri: mappedLp};
        lastPersistedExternalMutationSeqRef.current += 1;
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

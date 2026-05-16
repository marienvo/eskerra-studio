import type {Dispatch, MutableRefObject, RefObject, SetStateAction} from 'react';

import type {VaultFilesystem} from '@eskerra/core';

import type {NoteMarkdownEditorHandle} from '../editor/noteEditor/NoteMarkdownEditor';
import {normalizeEditorDocUri} from '../lib/editorDocumentHistory';
import {
  createEditorWorkspaceTab,
  insertTabAfterActive,
  insertTabAtIndex,
  type EditorWorkspaceTab,
} from '../lib/editorWorkspaceTabs';
import {inboxEditorSliceToFullMarkdown} from '../lib/inboxYamlFrontmatterEditor';
import {
  openTabBackgroundAction,
  type OpenTabBackgroundOptions,
  type WorkspaceModel,
} from '../lib/workspaceModel';
import {normalizeVaultMarkdownDiskRead} from './inboxNoteBodyCache';
import type {InboxEditorShellScrollDirective} from './workspaceEditorScrollMap';
import {
  applyForegroundOpenTabPlacement,
  decideHomeOpenMode,
} from './workspaceEditorTabs';
import {snapshotEditorShellScrollForOpenNote} from './workspaceEditorScrollMap';
import {resolveModelBackedLegacyTabStrip} from './workspaceRuntimeProjection';

export type OpenMarkdownInEditorOptions = {
  skipHistory?: boolean;
  newTab?: boolean;
  activateNewTab?: boolean;
  insertAfterActive?: boolean;
  insertAtIndex?: number;
  home?: boolean;
  workspaceShell?: boolean;
  workspaceShellPreserveTabs?: boolean;
};

type OpenMarkdownCommandContext = {
  fs: VaultFilesystem;
  openMarkdownGenerationRef: MutableRefObject<number>;
  clearMergeViewForOpenRef: MutableRefObject<() => void>;
  autosaveSchedulerRef: MutableRefObject<{cancel: () => void}>;
  todayHubBridgeRef: MutableRefObject<{
    getLiveRowUri: () => string | null;
    hasPendingHubFlush: () => boolean;
    flushPendingEdits: () => Promise<void>;
  }>;
  diskConflictDeferTimerRef: MutableRefObject<number | null>;
  inboxEditorShellScrollRef: RefObject<HTMLDivElement | null>;
  selectedUriRef: MutableRefObject<string | null>;
  composingNewEntryRef: MutableRefObject<boolean>;
  editorShellScrollByUriRef: MutableRefObject<Map<string, {top: number; left: number}>>;
  inboxEditorShellScrollDirectiveRef: MutableRefObject<InboxEditorShellScrollDirective | null>;
  clearStaleDiskConflictsForOpen: (targetNorm: string) => void;
  vaultRootRef: MutableRefObject<string | null>;
  inboxContentByUriRef: MutableRefObject<Record<string, string>>;
  lastPersistedRef: MutableRefObject<{uri: string; markdown: string} | null>;
  lastPersistedExternalMutationSeqRef: MutableRefObject<number>;
  eagerEditorLoadUriRef: MutableRefObject<string | null>;
  backlinksActiveBodyRef: MutableRefObject<string>;
  loadFullMarkdownIntoInboxEditor: (
    full: string,
    uri: string | null,
    selection?: 'start' | 'end' | 'preserve',
  ) => void;
  scheduleBacklinksDeferOneFrameAfterLoad: () => void;
  setInboxContentByUri: Dispatch<SetStateAction<Record<string, string>>>;
  setBacklinksActiveBody: Dispatch<SetStateAction<string>>;
  setComposingNewEntry: Dispatch<SetStateAction<boolean>>;
  setSelectedUri: Dispatch<SetStateAction<string | null>>;
  inboxEditorRef: RefObject<NoteMarkdownEditorHandle | null>;
  editorBodyRef: MutableRefObject<string>;
  inboxYamlFrontmatterInnerRef: MutableRefObject<string | null>;
  inboxEditorYamlLeadingBeforeFrontmatterRef: MutableRefObject<string>;
  mergeInboxNoteBodyCacheRefAndState: (uri: string, markdown: string) => void;
  enqueuePersistOutgoingNoteMarkdown: (uri: string, markdown: string) => void;
  setErr: Dispatch<SetStateAction<string | null>>;
  dispatchWorkspaceActionSync: (
    reason: string,
    reducer: (m: WorkspaceModel) => WorkspaceModel,
  ) => WorkspaceModel;
  mirrorShadowActiveWorkspaceTabs: (
    tabs: readonly EditorWorkspaceTab[],
    activeEditorTabId: string | null,
    reason: string,
  ) => void;
  mirrorShadowHomeSurface: (reason: string) => void;
  mirrorShadowActiveTab: (tabId: string, reason: string) => void;
  editorWorkspaceTabsRef: MutableRefObject<EditorWorkspaceTab[]>;
  activeEditorTabIdRef: MutableRefObject<string | null>;
  activeTodayHubUriRef: MutableRefObject<string | null>;
  setEditorWorkspaceTabs: Dispatch<SetStateAction<EditorWorkspaceTab[]>>;
  setActiveEditorTabId: Dispatch<SetStateAction<string | null>>;
  pushHomeHistoryForHub: (hubUri: string, nextUri: string) => void;
};

function prepareInboxScrollDirectiveForOpen(
  inboxEditorShellScrollDirectiveRef: MutableRefObject<InboxEditorShellScrollDirective | null>,
  editorShellScrollByUriRef: MutableRefObject<Map<string, {top: number; left: number}>>,
  targetNorm: string,
  skipHistory: boolean,
): void {
  if (skipHistory) {
    const saved = editorShellScrollByUriRef.current.get(targetNorm) ?? {top: 0, left: 0};
    inboxEditorShellScrollDirectiveRef.current = {
      kind: 'restore',
      top: saved.top,
      left: saved.left,
    };
    return;
  }
  inboxEditorShellScrollDirectiveRef.current = {kind: 'snapTop'};
}

function snapshotAndPersistCurrentNoteBeforeOpen(ctx: OpenMarkdownCommandContext): void {
  const root = ctx.vaultRootRef.current;
  const curUri = ctx.selectedUriRef.current;
  if (curUri == null || ctx.composingNewEntryRef.current) {
    return;
  }
  const snapMdForSlice = ctx.inboxEditorRef.current?.getMarkdown() ?? ctx.editorBodyRef.current;
  const snapshot = inboxEditorSliceToFullMarkdown(
    snapMdForSlice,
    curUri,
    false,
    ctx.inboxYamlFrontmatterInnerRef.current,
    ctx.inboxEditorYamlLeadingBeforeFrontmatterRef.current,
  );
  ctx.mergeInboxNoteBodyCacheRefAndState(curUri, snapshot);
  const prev = ctx.lastPersistedRef.current;
  const needsPersist = root != null && !(prev && prev.uri === curUri && prev.markdown === snapshot);
  if (needsPersist) {
    ctx.enqueuePersistOutgoingNoteMarkdown(curUri, snapshot);
  }
}

async function tryPrefetchTargetBody(
  ctx: OpenMarkdownCommandContext,
  targetNorm: string,
  openGen: number,
): Promise<string | undefined> {
  try {
    const raw = await ctx.fs.readFile(targetNorm, {encoding: 'utf8'});
    if (openGen !== ctx.openMarkdownGenerationRef.current) {
      return undefined;
    }
    return normalizeVaultMarkdownDiskRead(raw);
  } catch (e) {
    if (openGen !== ctx.openMarkdownGenerationRef.current) {
      return undefined;
    }
    ctx.setErr(e instanceof Error ? e.message : String(e));
    return undefined;
  }
}

function loadOpenedNoteBodyAndApplySelection(
  ctx: OpenMarkdownCommandContext,
  targetNorm: string,
  prefetchBody: string | undefined,
): void {
  if (prefetchBody !== undefined) {
    ctx.lastPersistedRef.current = {uri: targetNorm, markdown: prefetchBody};
    ctx.lastPersistedExternalMutationSeqRef.current += 1;
    ctx.inboxContentByUriRef.current = {
      ...ctx.inboxContentByUriRef.current,
      [targetNorm]: prefetchBody,
    };
  }
  const resolvedEditorBody =
    prefetchBody !== undefined ? prefetchBody : ctx.inboxContentByUriRef.current[targetNorm];
  if (resolvedEditorBody !== undefined) {
    ctx.lastPersistedRef.current = {uri: targetNorm, markdown: resolvedEditorBody};
    ctx.lastPersistedExternalMutationSeqRef.current += 1;
    ctx.eagerEditorLoadUriRef.current = targetNorm;
    ctx.backlinksActiveBodyRef.current = resolvedEditorBody;
    ctx.loadFullMarkdownIntoInboxEditor(resolvedEditorBody, targetNorm, 'start');
    ctx.scheduleBacklinksDeferOneFrameAfterLoad();
  }
  ctx.selectedUriRef.current = targetNorm;
  ctx.composingNewEntryRef.current = false;
  if (prefetchBody !== undefined) {
    ctx.setInboxContentByUri(prev => {
      if (prev[targetNorm] === prefetchBody) {
        return prev;
      }
      return {...prev, [targetNorm]: prefetchBody};
    });
  }
  if (resolvedEditorBody !== undefined) {
    ctx.setBacklinksActiveBody(resolvedEditorBody);
  }
  ctx.setComposingNewEntry(false);
  ctx.setSelectedUri(targetNorm);
}

function applyBackgroundNewTabOpen(
  ctx: OpenMarkdownCommandContext,
  targetNorm: string,
  options: {insertAtIndex?: number; insertAfterActive?: boolean} | undefined,
  prefetchBody: string | undefined,
): void {
  const newTab = createEditorWorkspaceTab(targetNorm);
  const curTabs = ctx.editorWorkspaceTabsRef.current;
  const activeId = ctx.activeEditorTabIdRef.current;
  let nextTabsLegacy: EditorWorkspaceTab[];
  let tabOpts: OpenTabBackgroundOptions;
  if (typeof options?.insertAtIndex === 'number' && Number.isFinite(options.insertAtIndex)) {
    nextTabsLegacy = insertTabAtIndex(curTabs, options.insertAtIndex, newTab);
    tabOpts = {
      placement: 'insertAtIndex',
      tabId: newTab.id,
      insertAtIndex: options.insertAtIndex,
    };
  } else if (options?.insertAfterActive) {
    nextTabsLegacy = insertTabAfterActive(curTabs, activeId, newTab);
    tabOpts = {
      placement: 'insertAfterTab',
      tabId: newTab.id,
      insertAfterTabId: activeId,
    };
  } else {
    nextTabsLegacy = [...curTabs, newTab];
    tabOpts = {tabId: newTab.id};
  }

  const nextModel = ctx.dispatchWorkspaceActionSync('background new tab', m =>
    openTabBackgroundAction(m, targetNorm, tabOpts),
  );
  const {nextTabs, mismatch: tabStripMismatch} = resolveModelBackedLegacyTabStrip(
    nextModel,
    nextTabsLegacy,
    'signature',
  );
  if (tabStripMismatch?.kind === 'signature') {
    const warn = typeof process !== 'undefined' && process.env.NODE_ENV !== 'production';
    if (warn) {
      const {legacySig, derivedSig} = tabStripMismatch;
      console.warn(
        '[workspaceModel] applyBackgroundNewTabOpen: model strip signature mismatch vs legacy; using legacy strip',
        {targetNorm, legacySig, derivedSig},
      );
    }
  }
  ctx.editorWorkspaceTabsRef.current = nextTabs;
  ctx.setEditorWorkspaceTabs(nextTabs);
  ctx.mirrorShadowActiveWorkspaceTabs(
    nextTabs,
    ctx.activeEditorTabIdRef.current,
    'background open tab',
  );
  if (prefetchBody !== undefined) {
    ctx.inboxContentByUriRef.current = {
      ...ctx.inboxContentByUriRef.current,
      [targetNorm]: prefetchBody,
    };
    ctx.setInboxContentByUri(prev => {
      if (prev[targetNorm] === prefetchBody) {
        return prev;
      }
      return {...prev, [targetNorm]: prefetchBody};
    });
  }
}

function placeForegroundMarkdownOpen(
  ctx: OpenMarkdownCommandContext,
  uri: string,
  targetNorm: string,
  options: OpenMarkdownInEditorOptions | undefined,
): {nextTabs: EditorWorkspaceTab[]; nextActiveId: string | null} {
  let nextTabs = ctx.editorWorkspaceTabsRef.current;
  let nextActiveId = ctx.activeEditorTabIdRef.current;
  const homeMode = decideHomeOpenMode({
    targetNorm,
    activeTodayHubUri: ctx.activeTodayHubUriRef.current,
    activeEditorTabId: ctx.activeEditorTabIdRef.current,
    options,
  });
  if (homeMode === 'home') {
    nextTabs = [...ctx.editorWorkspaceTabsRef.current];
    nextActiveId = null;
    const hubUri = ctx.activeTodayHubUriRef.current;
    if (hubUri && options?.skipHistory !== true) {
      ctx.pushHomeHistoryForHub(hubUri, targetNorm);
    }
    return {nextTabs, nextActiveId};
  }
  return applyForegroundOpenTabPlacement({
    uri,
    targetNorm,
    tabs: nextTabs,
    activeId: nextActiveId,
    options,
  });
}

export async function runOpenMarkdownInEditorCommand(
  ctx: OpenMarkdownCommandContext,
  uri: string,
  options?: OpenMarkdownInEditorOptions,
): Promise<void> {
  const openGen = ++ctx.openMarkdownGenerationRef.current;
  const targetNorm = normalizeEditorDocUri(uri);
  ctx.clearMergeViewForOpenRef.current();
  ctx.autosaveSchedulerRef.current.cancel();
  const hubBridge = ctx.todayHubBridgeRef.current;
  const needHubFlush = hubBridge.getLiveRowUri() != null || hubBridge.hasPendingHubFlush();
  if (needHubFlush) {
    await hubBridge.flushPendingEdits().catch(() => undefined);
  }
  if (openGen !== ctx.openMarkdownGenerationRef.current) {
    return;
  }
  if (ctx.diskConflictDeferTimerRef.current != null) {
    window.clearTimeout(ctx.diskConflictDeferTimerRef.current);
    ctx.diskConflictDeferTimerRef.current = null;
  }
  snapshotEditorShellScrollForOpenNote(
    ctx.inboxEditorShellScrollRef.current,
    ctx.selectedUriRef.current,
    ctx.composingNewEntryRef.current,
    ctx.editorShellScrollByUriRef.current,
  );
  ctx.clearStaleDiskConflictsForOpen(targetNorm);
  const isBackgroundNewTab = options?.newTab === true && options?.activateNewTab === false;

  if (!isBackgroundNewTab) {
    prepareInboxScrollDirectiveForOpen(
      ctx.inboxEditorShellScrollDirectiveRef,
      ctx.editorShellScrollByUriRef,
      targetNorm,
      options?.skipHistory === true,
    );
  }

  snapshotAndPersistCurrentNoteBeforeOpen(ctx);
  if (openGen !== ctx.openMarkdownGenerationRef.current) {
    return;
  }

  let prefetchBody: string | undefined;
  const root = ctx.vaultRootRef.current;
  if (root != null && ctx.inboxContentByUriRef.current[targetNorm] === undefined) {
    prefetchBody = await tryPrefetchTargetBody(ctx, targetNorm, openGen);
    if (openGen !== ctx.openMarkdownGenerationRef.current) {
      return;
    }
  }

  if (isBackgroundNewTab) {
    applyBackgroundNewTabOpen(ctx, targetNorm, options, prefetchBody);
    return;
  }

  const {nextTabs, nextActiveId} = placeForegroundMarkdownOpen(ctx, uri, targetNorm, options);
  ctx.editorWorkspaceTabsRef.current = nextTabs;
  ctx.activeEditorTabIdRef.current = nextActiveId;
  ctx.setEditorWorkspaceTabs(nextTabs);
  ctx.setActiveEditorTabId(nextActiveId);
  ctx.mirrorShadowActiveWorkspaceTabs(nextTabs, nextActiveId, 'foreground open tabs');
  if (nextActiveId == null) {
    ctx.mirrorShadowHomeSurface('foreground open home surface');
  } else {
    ctx.mirrorShadowActiveTab(nextActiveId, 'foreground open active tab');
  }

  loadOpenedNoteBodyAndApplySelection(ctx, targetNorm, prefetchBody);
}

/**
 * Editor tab strip commands for the main workspace: activate, reorder, close variants,
 * reopen closed, and note selection. React wiring stays in {@link useMainWindowWorkspace};
 * this module holds the imperative bodies.
 */

import type {Dispatch, MutableRefObject, RefObject, SetStateAction} from 'react';

import {vaultUriIsTodayMarkdownFile} from '../lib/vaultTreeLoadChildren';
import {popNextReopenableClosedTabRecord, type ClosedEditorTabRecord} from '../lib/editorClosedTabStack';
import {normalizeEditorDocUri} from '../lib/editorDocumentHistory';
import {
  findTabById,
  findTabIdWithCurrentUri,
  pickNeighborTabIdAfterRemovingTab,
  pushClosedWorkspaceTabsFromCloseAll,
  pushClosedWorkspaceTabsFromCloseOther,
  reorderEditorWorkspaceTabsInArray,
  tabCurrentUri,
  type EditorWorkspaceTab,
} from '../lib/editorWorkspaceTabs';
import {clearInboxYamlFrontmatterEditorRefs} from '../lib/inboxYamlFrontmatterEditor';
import {isOnWorkspaceHome, selectNoteActiveHubTodayOpen} from '../lib/workspaceShellToday';
import {
  closeAllTabsAction,
  closeOtherTabsAction,
  closeTabAction,
  reorderTabsAction,
  type WorkspaceModel,
} from '../lib/workspaceModel';
import {
  editorWorkspaceTabsFromModelTabEntries,
  resolveModelBackedLegacyTabStrip,
} from './workspaceRuntimeProjection';
import type {OpenMarkdownInEditorOptions} from './workspaceOpenMarkdownCommand';

export type TabOpenMarkdown = (
  uri: string,
  options?: OpenMarkdownInEditorOptions,
) => Promise<void>;

export function replaceRuntimeActiveHub(
  hubUri: string | null,
  ref: MutableRefObject<string | null>,
  setActiveTodayHubUri: Dispatch<SetStateAction<string | null>>,
): void {
  ref.current = hubUri;
  setActiveTodayHubUri(hubUri);
}

export function replaceRuntimeActiveSurfaceTab(
  tabId: string | null,
  ref: MutableRefObject<string | null>,
  setActiveEditorTabId: Dispatch<SetStateAction<string | null>>,
): void {
  ref.current = tabId;
  setActiveEditorTabId(tabId);
}

export type TabCommandRefs = {
  editorWorkspaceTabsRef: MutableRefObject<EditorWorkspaceTab[]>;
  activeEditorTabIdRef: MutableRefObject<string | null>;
  selectedUriRef: MutableRefObject<string | null>;
  composingNewEntryRef: MutableRefObject<boolean>;
  activeTodayHubUriRef: MutableRefObject<string | null>;
  flushInboxSaveRef: MutableRefObject<() => Promise<void>>;
  saveChainRef: MutableRefObject<Promise<void>>;
  vaultRootRef: MutableRefObject<string | null>;
  notesRef: RefObject<readonly {uri: string}[]>;
  editorClosedTabsStackRef: MutableRefObject<ClosedEditorTabRecord[]>;
  editorShellScrollByUriRef: MutableRefObject<Map<string, {top: number; left: number}>>;
  inboxYamlFrontmatterInnerRef: MutableRefObject<string | null>;
  inboxEditorYamlLeadingBeforeFrontmatterRef: MutableRefObject<string>;
};

export type TabCommandCallbacks = {
  bumpEditorClosedStack: () => void;
  dispatchWorkspaceActionSync: (
    reason: string,
    reduce: (model: WorkspaceModel) => WorkspaceModel,
  ) => WorkspaceModel;
  replaceEditorWorkspaceTabs: (tabs: EditorWorkspaceTab[]) => void;
  mirrorShadowActiveTab: (tabId: string, reason: string) => void;
  mirrorShadowHomeSurface: (reason: string) => void;
  openMarkdownInEditor: TabOpenMarkdown;
  selectHomeCurrentNote: (todayNoteUri: string) => void | Promise<void>;
  clearInboxSelection: () => void;
};

export type TabCommandSetters = {
  setActiveEditorTabId: Dispatch<SetStateAction<string | null>>;
  setSelectedUri: Dispatch<SetStateAction<string | null>>;
  setComposingNewEntry: Dispatch<SetStateAction<boolean>>;
  setEditorBody: Dispatch<SetStateAction<string>>;
  setInboxYamlFrontmatterInner: Dispatch<SetStateAction<string | null>>;
  setInboxEditorYamlLeadingBeforeFrontmatter: Dispatch<SetStateAction<string>>;
  setInboxEditorResetNonce: Dispatch<SetStateAction<number>>;
  clearLastPersistedSnapshot: () => void;
};

export type TabCommandContext = {
  busy: boolean;
  refs: TabCommandRefs;
  callbacks: TabCommandCallbacks;
  setters: TabCommandSetters;
};

export function runActivateOpenTab(ctx: TabCommandContext, tabId: string): void {
  const {refs, callbacks, setters} = ctx;
  const tab = findTabById(refs.editorWorkspaceTabsRef.current, tabId);
  const u = tab ? tabCurrentUri(tab) : null;
  if (!u) {
    return;
  }
  replaceRuntimeActiveSurfaceTab(tabId, refs.activeEditorTabIdRef, setters.setActiveEditorTabId);
  callbacks.mirrorShadowActiveTab(tabId, 'activate open tab');
  callbacks.openMarkdownInEditor(u, {skipHistory: true}).catch(() => undefined);
}

export function runReorderEditorWorkspaceTabs(
  ctx: TabCommandContext,
  fromIndex: number,
  insertBeforeIndex: number,
): void {
  if (ctx.busy) {
    return;
  }
  const {refs, callbacks} = ctx;
  const tabs = refs.editorWorkspaceTabsRef.current;
  const preview = reorderEditorWorkspaceTabsInArray(tabs, fromIndex, insertBeforeIndex);
  let sameOrder = true;
  for (let i = 0; i < preview.length; i++) {
    if (preview[i]!.id !== tabs[i]!.id) {
      sameOrder = false;
      break;
    }
  }
  if (sameOrder) {
    return;
  }
  const nextModel = callbacks.dispatchWorkspaceActionSync('reorder tabs', m =>
    reorderTabsAction(m, fromIndex, insertBeforeIndex),
  );
  const hub = nextModel.activeHub;
  if (hub == null) {
    return;
  }
  const ws = nextModel.workspaces[hub];
  if (ws == null) {
    return;
  }
  const nextTabs = editorWorkspaceTabsFromModelTabEntries(ws.tabs);
  callbacks.replaceEditorWorkspaceTabs(nextTabs);
}

function recordClosedTabAndPruneScroll(
  ctx: TabCommandContext,
  tabsBefore: readonly EditorWorkspaceTab[],
  tabId: string,
  tabClosing: EditorWorkspaceTab | undefined,
): void {
  const {refs, callbacks} = ctx;
  const closedUri = tabClosing ? tabCurrentUri(tabClosing) : null;
  if (closedUri) {
    const closedIndex = tabsBefore.findIndex(t => t.id === tabId);
    refs.editorClosedTabsStackRef.current.push({
      uri: closedUri,
      index: closedIndex >= 0 ? closedIndex : tabsBefore.length - 1,
    });
  }
  callbacks.bumpEditorClosedStack();
  if (tabClosing) {
    for (const u of tabClosing.history.entries) {
      refs.editorShellScrollByUriRef.current.delete(normalizeEditorDocUri(u));
    }
  }
}

export async function runRefocusAfterClosingActiveTab(
  ctx: TabCommandContext,
  nextTabId: string | null,
  nextTabs: readonly EditorWorkspaceTab[],
): Promise<void> {
  const {refs, callbacks, setters} = ctx;
  if (nextTabId) {
    replaceRuntimeActiveSurfaceTab(
      nextTabId,
      refs.activeEditorTabIdRef,
      setters.setActiveEditorTabId,
    );
    callbacks.mirrorShadowActiveTab(nextTabId, 'close tab refocus neighbor');
  }
  const neighbor = nextTabId ? findTabById(nextTabs, nextTabId) : undefined;
  const nextUri = neighbor ? tabCurrentUri(neighbor) : null;
  if (nextUri) {
    await callbacks.openMarkdownInEditor(nextUri, {skipHistory: true});
    return;
  }
  const shellHub = refs.activeTodayHubUriRef.current;
  if (shellHub) {
    await callbacks.selectHomeCurrentNote(shellHub);
    return;
  }
  if (!nextTabId) {
    replaceRuntimeActiveSurfaceTab(null, refs.activeEditorTabIdRef, setters.setActiveEditorTabId);
    callbacks.mirrorShadowHomeSurface('close tab home surface');
  }
  callbacks.clearInboxSelection();
}

export function runCloseEditorTab(ctx: TabCommandContext, tabId: string): void {
  void (async () => {
    const {refs, callbacks} = ctx;
    const tabsBefore = refs.editorWorkspaceTabsRef.current;
    const tabClosing = findTabById(tabsBefore, tabId);
    const wasActive = refs.activeEditorTabIdRef.current === tabId;

    if (wasActive) {
      await refs.flushInboxSaveRef.current();
    } else {
      await refs.saveChainRef.current.catch(() => undefined);
    }

    recordClosedTabAndPruneScroll(ctx, tabsBefore, tabId, tabClosing);

    const nextTabId = pickNeighborTabIdAfterRemovingTab(tabsBefore, tabId);
    const nextTabsLegacy = tabsBefore.filter(t => t.id !== tabId);

    const nextModel = callbacks.dispatchWorkspaceActionSync('close tab', m =>
      closeTabAction(m, tabId),
    );
    const {nextTabs, mismatch: tabStripMismatch} = resolveModelBackedLegacyTabStrip(
      nextModel,
      nextTabsLegacy,
      'ids',
    );
    if (tabStripMismatch?.kind === 'ids') {
      const warn = typeof process !== 'undefined' && process.env.NODE_ENV !== 'production';
      if (warn) {
        const {legacyIds, derivedIds} = tabStripMismatch;
        console.warn(
          '[workspaceModel] closeEditorTab: model strip mismatch vs legacy filter; using legacy strip',
          {tabId, legacyIds, derivedIds},
        );
      }
    }

    callbacks.replaceEditorWorkspaceTabs(nextTabs);

    if (!wasActive) {
      return;
    }
    await runRefocusAfterClosingActiveTab(ctx, nextTabId, nextTabs);
  })();
}

export function runCloseOtherEditorTabs(ctx: TabCommandContext, keepTabId: string): void {
  void (async () => {
    const {refs, callbacks} = ctx;
    const prevTabs = [...refs.editorWorkspaceTabsRef.current];
    const keepTab = findTabById(prevTabs, keepTabId);
    const keepUri = keepTab ? tabCurrentUri(keepTab) : null;
    if (keepUri == null) {
      return;
    }
    await refs.saveChainRef.current.catch(() => undefined);
    if (refs.activeEditorTabIdRef.current !== keepTabId) {
      replaceRuntimeActiveSurfaceTab(
        keepTabId,
        refs.activeEditorTabIdRef,
        ctx.setters.setActiveEditorTabId,
      );
      callbacks.mirrorShadowActiveTab(keepTabId, 'close other tabs activate kept tab');
      await callbacks.openMarkdownInEditor(keepUri, {skipHistory: true});
    } else {
      await refs.flushInboxSaveRef.current();
    }
    pushClosedWorkspaceTabsFromCloseOther(refs.editorClosedTabsStackRef.current, prevTabs, keepTabId);
    callbacks.bumpEditorClosedStack();
    for (const t of prevTabs) {
      if (t.id === keepTabId) {
        continue;
      }
      for (const u of t.history.entries) {
        refs.editorShellScrollByUriRef.current.delete(normalizeEditorDocUri(u));
      }
    }
    const nextModel = callbacks.dispatchWorkspaceActionSync('close other tabs', m =>
      closeOtherTabsAction(m, keepTabId),
    );
    const hub = nextModel.activeHub;
    const derived =
      hub != null && nextModel.workspaces[hub] != null
        ? editorWorkspaceTabsFromModelTabEntries(nextModel.workspaces[hub].tabs)
        : null;
    const nextTabs =
      derived != null && derived.length === 1 && derived[0]!.id === keepTabId
        ? derived
        : prevTabs.filter(t => t.id === keepTabId);
    callbacks.replaceEditorWorkspaceTabs(nextTabs);
  })();
}

export function runCloseAllEditorTabs(ctx: TabCommandContext): void {
  void (async () => {
    const {refs, callbacks, setters} = ctx;
    await refs.flushInboxSaveRef.current();
    const tabs = [...refs.editorWorkspaceTabsRef.current];
    if (tabs.length === 0) {
      return;
    }
    pushClosedWorkspaceTabsFromCloseAll(
      refs.editorClosedTabsStackRef.current,
      tabs,
      refs.activeEditorTabIdRef.current,
    );
    callbacks.bumpEditorClosedStack();
    for (const t of tabs) {
      for (const u of t.history.entries) {
        refs.editorShellScrollByUriRef.current.delete(normalizeEditorDocUri(u));
      }
    }
    const nextModel = callbacks.dispatchWorkspaceActionSync('close all tabs', closeAllTabsAction);
    const hub = nextModel.activeHub;
    const nextTabs =
      hub != null && nextModel.workspaces[hub] != null
        ? editorWorkspaceTabsFromModelTabEntries(nextModel.workspaces[hub].tabs)
        : [];
    callbacks.replaceEditorWorkspaceTabs(nextTabs);
    replaceRuntimeActiveSurfaceTab(null, refs.activeEditorTabIdRef, setters.setActiveEditorTabId);
    callbacks.mirrorShadowHomeSurface('close all tabs home surface');
    const shellHubAll = refs.activeTodayHubUriRef.current;
    if (shellHubAll) {
      await callbacks.selectHomeCurrentNote(shellHubAll);
      return;
    }
    refs.selectedUriRef.current = null;
    refs.composingNewEntryRef.current = false;
    setters.clearLastPersistedSnapshot();
    setters.setSelectedUri(null);
    setters.setComposingNewEntry(false);
    clearInboxYamlFrontmatterEditorRefs({
      inner: refs.inboxYamlFrontmatterInnerRef,
      leading: refs.inboxEditorYamlLeadingBeforeFrontmatterRef,
      setInner: setters.setInboxYamlFrontmatterInner,
      setLeading: setters.setInboxEditorYamlLeadingBeforeFrontmatter,
    });
    setters.setEditorBody('');
    setters.setInboxEditorResetNonce(n => n + 1);
  })();
}

export function runReopenLastClosedEditorTab(ctx: TabCommandContext): void {
  void (async () => {
    const {refs, callbacks} = ctx;
    const root = refs.vaultRootRef.current;
    const stack = refs.editorClosedTabsStackRef.current;
    const noteSet = new Set(refs.notesRef.current.map(n => n.uri.replace(/\\/g, '/')));
    const {record, popped} = popNextReopenableClosedTabRecord(stack, root, noteSet);
    if (popped > 0) {
      callbacks.bumpEditorClosedStack();
    }
    if (record) {
      await callbacks.openMarkdownInEditor(record.uri, {
        newTab: true,
        activateNewTab: true,
        insertAtIndex: record.index,
      });
    }
  })();
}

export {runRefocusAfterActiveTabRemoved} from './workspaceTabRefocusAfterActiveTabRemoved';

export function runSelectNote(ctx: TabCommandContext, uri: string): void {
  const {refs, callbacks} = ctx;
  const existingId = findTabIdWithCurrentUri(refs.editorWorkspaceTabsRef.current, uri);
  if (existingId != null) {
    runActivateOpenTab(ctx, existingId);
    return;
  }
  const norm = normalizeEditorDocUri(uri) ?? '';
  const hubTodayOpen = selectNoteActiveHubTodayOpen({
    uri,
    activeTodayHubUri: refs.activeTodayHubUriRef.current,
    uriIsTodayMarkdownFile: vaultUriIsTodayMarkdownFile(norm),
    editorWorkspaceTabCount: refs.editorWorkspaceTabsRef.current.length,
  });
  if (hubTodayOpen === 'home') {
    callbacks.openMarkdownInEditor(uri, {home: true}).catch(() => undefined);
    return;
  }
  if (
    isOnWorkspaceHome({
      composingNewEntry: refs.composingNewEntryRef.current,
      activeTodayHubUri: refs.activeTodayHubUriRef.current,
      selectedUri: refs.selectedUriRef.current,
      activeEditorTabId: refs.activeEditorTabIdRef.current,
    })
  ) {
    callbacks.openMarkdownInEditor(uri, {home: true}).catch(() => undefined);
    return;
  }
  callbacks.openMarkdownInEditor(uri).catch(() => undefined);
}

export function runSelectNoteInNewActiveTab(
  ctx: TabCommandContext,
  uri: string,
  opts?: {insertAfterActive?: boolean},
): void {
  const {refs, callbacks} = ctx;
  const existingId = findTabIdWithCurrentUri(refs.editorWorkspaceTabsRef.current, uri);
  if (existingId != null) {
    runActivateOpenTab(ctx, existingId);
    return;
  }
  callbacks.openMarkdownInEditor(uri, {
    newTab: true,
    activateNewTab: true,
    insertAfterActive: opts?.insertAfterActive === true,
  }).catch(() => undefined);
}

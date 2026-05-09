/**
 * Editor history navigation: Home stack vs per-tab document stack (preview → WorkspaceModel actions).
 * Runtime tabs/home state remain authoritative; this module orchestrates back/forward only.
 */
import type {Dispatch, RefObject, SetStateAction} from 'react';

import type {EditorDocumentHistoryState} from '../lib/editorDocumentHistory';
import {findTabById, type EditorWorkspaceTab} from '../lib/editorWorkspaceTabs';
import {
  createWorkspaceHomeState,
  homeCanGoBack,
  homeCanGoForward,
  homeCurrentUri,
  homeGoBack,
  homeGoForward,
  type WorkspaceHomeState,
} from '../lib/workspaceHomeNavigation';
import {goBackAction, goForwardAction} from '../lib/workspaceModel';
import type {DispatchWorkspaceModelAction} from './workspaceShadowBridge';

export type OpenMarkdownInEditorFn = (
  uri: string,
  opts?: {home?: boolean; skipHistory?: boolean},
) => void | Promise<void>;

export function deriveActiveTabHistorySnapshot(args: {
  activeEditorTabId: string | null;
  editorWorkspaceTabs: readonly EditorWorkspaceTab[];
}): EditorDocumentHistoryState {
  const tab = args.activeEditorTabId
    ? findTabById(args.editorWorkspaceTabs, args.activeEditorTabId)
    : undefined;
  return tab?.history ?? {entries: [], index: -1};
}

export function deriveActiveHomeStateSnapshot(args: {
  activeEditorTabId: string | null;
  activeTodayHubUri: string | null;
  homeStatesByHub: Record<string, WorkspaceHomeState>;
}): WorkspaceHomeState | null {
  if (args.activeEditorTabId != null || args.activeTodayHubUri == null) {
    return null;
  }
  return (
    args.homeStatesByHub[args.activeTodayHubUri]
    ?? createWorkspaceHomeState(args.activeTodayHubUri)
  );
}

export function computeEditorHistoryCanGoBack(args: {
  composingNewEntry: boolean;
  activeHomeState: WorkspaceHomeState | null;
  activeTabHistory: EditorDocumentHistoryState;
}): boolean {
  const {composingNewEntry, activeHomeState, activeTabHistory} = args;
  if (activeHomeState) {
    return composingNewEntry
      ? homeCurrentUri(activeHomeState) != null
      : homeCanGoBack(activeHomeState);
  }
  const {entries, index} = activeTabHistory;
  if (entries.length === 0) {
    return false;
  }
  if (composingNewEntry) {
    return index >= 0;
  }
  return index > 0;
}

export function computeEditorHistoryCanGoForward(args: {
  busy: boolean;
  composingNewEntry: boolean;
  activeHomeState: WorkspaceHomeState | null;
  activeTabHistory: EditorDocumentHistoryState;
}): boolean {
  const {busy, composingNewEntry, activeHomeState, activeTabHistory} = args;
  if (activeHomeState) {
    return !busy && !composingNewEntry && homeCanGoForward(activeHomeState);
  }
  const {entries, index} = activeTabHistory;
  if (busy || composingNewEntry) {
    return false;
  }
  return index >= 0 && index < entries.length - 1;
}

export type OpenCurrentHomeAfterComposingBridgeDeps = {
  setComposingNewEntry: (value: boolean) => void;
  clearFrontmatterRefs: () => void;
  setEditorBody: (body: string) => void;
  setInboxEditorResetNonce: Dispatch<SetStateAction<number>>;
  openMarkdownInEditor: OpenMarkdownInEditorFn;
};

export async function openCurrentHomeAfterComposingBridge(
  deps: OpenCurrentHomeAfterComposingBridgeDeps,
  state: WorkspaceHomeState,
): Promise<boolean> {
  const uri = homeCurrentUri(state);
  if (!uri) {
    return false;
  }
  deps.setComposingNewEntry(false);
  deps.clearFrontmatterRefs();
  deps.setEditorBody('');
  deps.setInboxEditorResetNonce(n => n + 1);
  await deps.openMarkdownInEditor(uri, {home: true, skipHistory: true});
  return true;
}

export type MoveHomeHistoryBridgeDeps = {
  setHomeStateForHub: (hubUri: string, state: WorkspaceHomeState) => void;
  openMarkdownInEditor: OpenMarkdownInEditorFn;
};

export async function moveHomeHistoryBridge(
  deps: MoveHomeHistoryBridgeDeps,
  hubUri: string,
  state: WorkspaceHomeState,
  move: (state: WorkspaceHomeState) => WorkspaceHomeState,
): Promise<boolean> {
  const nextHome = move(state);
  const uri = homeCurrentUri(nextHome);
  if (!uri) {
    return false;
  }
  deps.setHomeStateForHub(hubUri, nextHome);
  await deps.openMarkdownInEditor(uri, {home: true, skipHistory: true});
  return true;
}

export type EditorHistoryNavigationRefs = {
  activeTodayHubUriRef: RefObject<string | null>;
  activeEditorTabIdRef: RefObject<string | null>;
  homeStatesByHubRef: RefObject<Record<string, WorkspaceHomeState>>;
  editorWorkspaceTabsRef: RefObject<EditorWorkspaceTab[]>;
  composingNewEntryRef: RefObject<boolean>;
};

export type RunEditorHistoryGoBackDeps = EditorHistoryNavigationRefs & {
  flushInboxSave: () => Promise<void>;
  dispatchWorkspaceAction: DispatchWorkspaceModelAction;
  openMarkdownInEditor: OpenMarkdownInEditorFn;
  openCurrentHomeAfterComposing: (state: WorkspaceHomeState) => Promise<boolean>;
  moveHomeHistory: (
    hubUri: string,
    state: WorkspaceHomeState,
    move: (state: WorkspaceHomeState) => WorkspaceHomeState,
  ) => Promise<boolean>;
  setComposingNewEntry: (value: boolean) => void;
  setEditorBody: (body: string) => void;
  setInboxEditorResetNonce: Dispatch<SetStateAction<number>>;
  setEditorWorkspaceTabs: Dispatch<SetStateAction<EditorWorkspaceTab[]>>;
  clearFrontmatterRefs: () => void;
};

export async function runEditorHistoryGoBack(
  deps: RunEditorHistoryGoBackDeps,
): Promise<void> {
  await deps.flushInboxSave();
  const activeHub = deps.activeTodayHubUriRef.current;
  if (deps.activeEditorTabIdRef.current == null && activeHub != null) {
    const snap =
      deps.homeStatesByHubRef.current[activeHub]
      ?? createWorkspaceHomeState(activeHub);
    if (deps.composingNewEntryRef.current) {
      await deps.openCurrentHomeAfterComposing(snap);
      return;
    }
    if (!homeCanGoBack(snap)) {
      return;
    }
    await deps.moveHomeHistory(activeHub, snap, homeGoBack);
    return;
  }
  const id = deps.activeEditorTabIdRef.current;
  const tabs = deps.editorWorkspaceTabsRef.current;
  const tab = id ? findTabById(tabs, id) : undefined;
  const snap = tab?.history ?? {entries: [], index: -1};
  if (deps.composingNewEntryRef.current) {
    if (snap.entries.length === 0 || snap.index < 0) {
      return;
    }
    const uri = snap.entries[snap.index]!;
    deps.setComposingNewEntry(false);
    deps.clearFrontmatterRefs();
    deps.setEditorBody('');
    deps.setInboxEditorResetNonce(n => n + 1);
    await deps.openMarkdownInEditor(uri, {skipHistory: true});
    return;
  }
  if (snap.index <= 0) {
    return;
  }
  const nextIndex = snap.index - 1;
  const uri = snap.entries[nextIndex]!;
  const nextTabs = tabs.map(t =>
    t.id === id ? {...t, history: {...t.history, index: nextIndex}} : t,
  );
  deps.editorWorkspaceTabsRef.current = nextTabs;
  deps.setEditorWorkspaceTabs(nextTabs);
  deps.dispatchWorkspaceAction('tab go back', goBackAction);
  await deps.openMarkdownInEditor(uri, {skipHistory: true});
}

export type RunEditorHistoryGoForwardDeps = EditorHistoryNavigationRefs & {
  flushInboxSave: () => Promise<void>;
  dispatchWorkspaceAction: DispatchWorkspaceModelAction;
  openMarkdownInEditor: OpenMarkdownInEditorFn;
  moveHomeHistory: (
    hubUri: string,
    state: WorkspaceHomeState,
    move: (state: WorkspaceHomeState) => WorkspaceHomeState,
  ) => Promise<boolean>;
  setEditorWorkspaceTabs: Dispatch<SetStateAction<EditorWorkspaceTab[]>>;
};

export async function runEditorHistoryGoForward(
  deps: RunEditorHistoryGoForwardDeps,
): Promise<void> {
  if (deps.composingNewEntryRef.current) {
    return;
  }
  await deps.flushInboxSave();
  const activeHub = deps.activeTodayHubUriRef.current;
  if (deps.activeEditorTabIdRef.current == null && activeHub != null) {
    const snap =
      deps.homeStatesByHubRef.current[activeHub]
      ?? createWorkspaceHomeState(activeHub);
    if (!homeCanGoForward(snap)) {
      return;
    }
    await deps.moveHomeHistory(activeHub, snap, homeGoForward);
    return;
  }
  const id = deps.activeEditorTabIdRef.current;
  const tabs = deps.editorWorkspaceTabsRef.current;
  const tab = id ? findTabById(tabs, id) : undefined;
  const snap = tab?.history ?? {entries: [], index: -1};
  if (snap.index < 0 || snap.index >= snap.entries.length - 1) {
    return;
  }
  const nextIndex = snap.index + 1;
  const uri = snap.entries[nextIndex]!;
  const nextTabs = tabs.map(t =>
    t.id === id ? {...t, history: {...t.history, index: nextIndex}} : t,
  );
  deps.editorWorkspaceTabsRef.current = nextTabs;
  deps.setEditorWorkspaceTabs(nextTabs);
  deps.dispatchWorkspaceAction('tab go forward', goForwardAction);
  await deps.openMarkdownInEditor(uri, {skipHistory: true});
}

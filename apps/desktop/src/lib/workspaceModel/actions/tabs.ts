import type {TabEntry, WorkspaceModel, WorkspaceState} from '../types';
import {normalizeWorkspaceUri} from '../types';

function patchActiveWorkspace(
  m: WorkspaceModel,
  patch: (ws: WorkspaceState) => WorkspaceState,
): WorkspaceModel {
  if (m.activeHub == null) {
    return m;
  }
  const cur = m.workspaces[m.activeHub];
  if (!cur) {
    return m;
  }
  return {
    ...m,
    workspaces: {
      ...m.workspaces,
      [m.activeHub]: patch(cur),
    },
  };
}

function autoTabId(ws: WorkspaceState, uri: string): string {
  const n = normalizeWorkspaceUri(uri);
  return `tab-${ws.tabs.length}-${n}`;
}

function neighborTabIdAfterClose(tabs: readonly TabEntry[], closedIndex: number): string {
  if (closedIndex < tabs.length - 1) {
    return tabs[closedIndex + 1]!.id;
  }
  return tabs[closedIndex - 1]!.id;
}

export function openTabForegroundAction(
  m: WorkspaceModel,
  uri: string,
  opts?: {tabId?: string},
): WorkspaceModel {
  return patchActiveWorkspace(m, ws => {
    const id = opts?.tabId ?? autoTabId(ws, uri);
    const entry: TabEntry = {
      id,
      history: {entries: [normalizeWorkspaceUri(uri)], index: 0},
    };
    return {
      ...ws,
      tabs: [...ws.tabs, entry],
      active: {kind: 'tab', id},
    };
  });
}

export function openTabBackgroundAction(
  m: WorkspaceModel,
  uri: string,
  opts?: {tabId?: string},
): WorkspaceModel {
  return patchActiveWorkspace(m, ws => {
    const id = opts?.tabId ?? autoTabId(ws, uri);
    const entry: TabEntry = {
      id,
      history: {entries: [normalizeWorkspaceUri(uri)], index: 0},
    };
    return {
      ...ws,
      tabs: [...ws.tabs, entry],
    };
  });
}

/** When tabs are already empty, closeTab is a no-op (transition table). */
export function closeTabAction(m: WorkspaceModel, tabId: string): WorkspaceModel {
  return patchActiveWorkspace(m, ws => {
    if (ws.tabs.length === 0) {
      return ws;
    }
    const idx = ws.tabs.findIndex(t => t.id === tabId);
    if (idx < 0) {
      return ws;
    }
    const nextTabs = ws.tabs.filter(t => t.id !== tabId);
    let nextActive = ws.active;
    if (ws.active.kind === 'tab' && ws.active.id === tabId) {
      if (ws.tabs.length === 1) {
        nextActive = {kind: 'home'};
      } else {
        nextActive = {kind: 'tab', id: neighborTabIdAfterClose(ws.tabs, idx)};
      }
    }
    return {...ws, tabs: nextTabs, active: nextActive};
  });
}

export function closeOtherTabsAction(m: WorkspaceModel, keepId: string): WorkspaceModel {
  return patchActiveWorkspace(m, ws => {
    if (!ws.tabs.some(t => t.id === keepId)) {
      return ws;
    }
    const nextTabs = ws.tabs.filter(t => t.id === keepId);
    let nextActive = ws.active;
    if (ws.active.kind === 'tab' && ws.active.id !== keepId) {
      nextActive = {kind: 'tab', id: keepId};
    }
    return {...ws, tabs: nextTabs, active: nextActive};
  });
}

export function closeAllTabsAction(m: WorkspaceModel): WorkspaceModel {
  return patchActiveWorkspace(m, ws => {
    if (ws.tabs.length === 0) {
      return ws;
    }
    return {
      ...ws,
      tabs: [],
      active: {kind: 'home'},
    };
  });
}

/**
 * Move tab from display index `fromIndex` to sit before `beforeIndex` (0-based, relative to
 * pre-move order). Out-of-range indices are a no-op.
 */
export function reorderTabsAction(
  m: WorkspaceModel,
  fromIndex: number,
  beforeIndex: number,
): WorkspaceModel {
  return patchActiveWorkspace(m, ws => {
    const tabs = [...ws.tabs];
    if (fromIndex < 0 || fromIndex >= tabs.length || beforeIndex < 0 || beforeIndex > tabs.length) {
      return ws;
    }
    if (fromIndex === beforeIndex) {
      return ws;
    }
    const [item] = tabs.splice(fromIndex, 1);
    if (!item) {
      return ws;
    }
    const insertAt = fromIndex < beforeIndex ? beforeIndex - 1 : beforeIndex;
    tabs.splice(insertAt, 0, item);
    return {...ws, tabs};
  });
}

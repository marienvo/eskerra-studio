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

/**
 * Background tab open options. A plain `{tabId?}` (no `placement`) appends (legacy shape).
 */
export type OpenTabBackgroundOptions =
  | {tabId?: string}
  | {
      tabId?: string;
      placement: 'append';
    }
  | {
      tabId?: string;
      placement: 'insertAtIndex';
      insertAtIndex: number;
    }
  | {
      tabId?: string;
      placement: 'insertAfterTab';
      insertAfterTabId: string | null;
    };

function normalizeOpenTabBackgroundPlacement(opts?: OpenTabBackgroundOptions): {
  kind: 'append' | 'insertAtIndex' | 'insertAfterTab';
  tabId?: string;
  insertAtIndex?: number;
  insertAfterTabId?: string | null;
} {
  if (opts == null) {
    return {kind: 'append'};
  }
  if ('placement' in opts && opts.placement === 'insertAtIndex') {
    return {
      kind: 'insertAtIndex',
      tabId: opts.tabId,
      insertAtIndex: opts.insertAtIndex,
    };
  }
  if ('placement' in opts && opts.placement === 'insertAfterTab') {
    return {
      kind: 'insertAfterTab',
      tabId: opts.tabId,
      insertAfterTabId: opts.insertAfterTabId,
    };
  }
  return {kind: 'append', tabId: opts.tabId};
}

export function openTabBackgroundAction(
  m: WorkspaceModel,
  uri: string,
  opts?: OpenTabBackgroundOptions,
): WorkspaceModel {
  const placement = normalizeOpenTabBackgroundPlacement(opts);
  return patchActiveWorkspace(m, ws => {
    const id = placement.tabId ?? autoTabId(ws, uri);
    const entry: TabEntry = {
      id,
      history: {entries: [normalizeWorkspaceUri(uri)], index: 0},
    };
    let nextTabs: TabEntry[];
    switch (placement.kind) {
      case 'insertAtIndex': {
        const at = placement.insertAtIndex ?? 0;
        const clamped = Math.max(0, Math.min(at, ws.tabs.length));
        nextTabs = [...ws.tabs];
        nextTabs.splice(clamped, 0, entry);
        break;
      }
      case 'insertAfterTab': {
        const aid = placement.insertAfterTabId;
        const idx = aid == null ? -1 : ws.tabs.findIndex(t => t.id === aid);
        const insertAt = idx < 0 ? 0 : idx + 1;
        nextTabs = [...ws.tabs];
        nextTabs.splice(insertAt, 0, entry);
        break;
      }
      default:
        nextTabs = [...ws.tabs, entry];
    }
    return {...ws, tabs: nextTabs};
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

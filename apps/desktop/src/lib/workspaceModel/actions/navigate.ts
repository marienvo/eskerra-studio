import {
  pushEditorHistoryEntry,
} from '../../editorDocumentHistory';
import type {WorkspaceModel} from '../types';

import {editorToStack, patchActiveWorkspace, stackToEditor} from './utils';

/**
 * pushHomeNavigationAction only mutates Home when the active surface is Home (transition table).
 * If active is a tab, this is a no-op (simplest behavior).
 */
export function pushHomeNavigationAction(m: WorkspaceModel, uri: string): WorkspaceModel {
  return patchActiveWorkspace(m, ws => {
    if (ws.active.kind !== 'home') {
      return ws;
    }
    const next = pushEditorHistoryEntry(stackToEditor(ws.homeHistory), uri);
    return {...ws, homeHistory: editorToStack(next)};
  });
}

/**
 * pushTabNavigationAction only mutates the active tab when the active surface is a tab.
 */
export function pushTabNavigationAction(m: WorkspaceModel, uri: string): WorkspaceModel {
  return patchActiveWorkspace(m, ws => {
    if (ws.active.kind !== 'tab') {
      return ws;
    }
    const tabId = ws.active.id;
    const nextTabs = ws.tabs.map(t => {
      if (t.id !== tabId) {
        return t;
      }
      const nextHist = pushEditorHistoryEntry(stackToEditor(t.history), uri);
      return {...t, history: editorToStack(nextHist)};
    });
    return {...ws, tabs: nextTabs};
  });
}

export function goBackAction(m: WorkspaceModel): WorkspaceModel {
  return patchActiveWorkspace(m, ws => {
    if (ws.active.kind === 'home') {
      const h = ws.homeHistory;
      if (h.entries.length === 0 || h.index <= 0) {
        return ws;
      }
      return {...ws, homeHistory: {...h, index: h.index - 1}};
    }
    const tabId = ws.active.id;
    const nextTabs = ws.tabs.map(t => {
      if (t.id !== tabId) {
        return t;
      }
      const {entries, index} = t.history;
      if (entries.length === 0 || index <= 0) {
        return t;
      }
      return {...t, history: {...t.history, index: index - 1}};
    });
    return {...ws, tabs: nextTabs};
  });
}

export function goForwardAction(m: WorkspaceModel): WorkspaceModel {
  return patchActiveWorkspace(m, ws => {
    if (ws.active.kind === 'home') {
      const h = ws.homeHistory;
      if (h.entries.length === 0 || h.index >= h.entries.length - 1) {
        return ws;
      }
      return {...ws, homeHistory: {...h, index: h.index + 1}};
    }
    const tabId = ws.active.id;
    const nextTabs = ws.tabs.map(t => {
      if (t.id !== tabId) {
        return t;
      }
      const {entries, index} = t.history;
      if (entries.length === 0 || index >= entries.length - 1) {
        return t;
      }
      return {...t, history: {...t.history, index: index + 1}};
    });
    return {...ws, tabs: nextTabs};
  });
}

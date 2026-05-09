import type {WorkspaceModel} from '../types';

import {patchActiveWorkspace} from './utils';

/**
 * Selector main-button click (plan rules 4–6):
 * - From a tab: activate Home without changing Home history.
 * - From Home with index > 0: reset Home index to 0 (Today).
 * - From Home at Today: no-op.
 */
export function activateWorkspaceSelectorAction(m: WorkspaceModel): WorkspaceModel {
  return patchActiveWorkspace(m, ws => {
    if (ws.active.kind === 'tab') {
      return {...ws, active: {kind: 'home'}};
    }
    const h = ws.homeHistory;
    if (h.index <= 0) {
      return ws;
    }
    return {...ws, homeHistory: {...h, index: 0}};
  });
}

/**
 * activateTabAction(other): focus that tab.
 * activateTabAction(activeTabId): no-op (transition table).
 */
export function activateTabAction(m: WorkspaceModel, tabId: string): WorkspaceModel {
  return patchActiveWorkspace(m, ws => {
    if (ws.active.kind === 'tab' && ws.active.id === tabId) {
      return ws;
    }
    if (!ws.tabs.some(t => t.id === tabId)) {
      return ws;
    }
    return {...ws, active: {kind: 'tab', id: tabId}};
  });
}

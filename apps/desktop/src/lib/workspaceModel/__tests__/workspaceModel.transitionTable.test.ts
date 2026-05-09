import {describe, expect, it} from 'vitest';
import {
  activateWorkspaceSelectorAction,
  closeAllTabsAction,
  closeTabAction,
  createDefaultWorkspaceState,
  goBackAction,
  goForwardAction,
  normalizeWorkspaceUri,
  openTabForegroundAction,
  pushHomeNavigationAction,
  pushTabNavigationAction,
  removeUrisAction,
  selectWorkspaceAction,
} from '../index';
import type {WorkspaceModel} from '../types';

const HUB = '/vault/Today.md';
const NOTE = '/vault/Note.md';
const OTHER = '/vault/Other.md';

function baseModel(overrides?: Partial<WorkspaceModel>): WorkspaceModel {
  const hub = normalizeWorkspaceUri(HUB);
  return {
    activeHub: hub,
    workspaces: {
      [hub]: createDefaultWorkspaceState(hub),
    },
    ...overrides,
  };
}

function withHomeSubPage(m: WorkspaceModel): WorkspaceModel {
  const hub = m.activeHub!;
  const ws = m.workspaces[hub]!;
  return {
    ...m,
    workspaces: {
      ...m.workspaces,
      [hub]: {
        ...ws,
        homeHistory: {entries: [hub, NOTE], index: 1},
      },
    },
  };
}

describe('workspaceModel transition table', () => {
  it('selector click from tab activates Home without resetting Home history', () => {
    let m = baseModel();
    m = withHomeSubPage(m);
    m = openTabForegroundAction(m, OTHER, {tabId: `id-${OTHER}`});
    const beforeHome = m.workspaces[m.activeHub!]!.homeHistory;
    m = activateWorkspaceSelectorAction(m);
    const ws = m.workspaces[m.activeHub!]!;
    expect(ws.active).toEqual({kind: 'home'});
    expect(ws.homeHistory).toEqual(beforeHome);
  });

  it('selector click from Home sub-page resets index to 0', () => {
    let m = withHomeSubPage(baseModel());
    expect(m.workspaces[m.activeHub!]!.homeHistory.index).toBe(1);
    m = activateWorkspaceSelectorAction(m);
    expect(m.workspaces[m.activeHub!]!.homeHistory.index).toBe(0);
  });

  it('selector click from Home Today is no-op', () => {
    const m0 = baseModel();
    const m1 = activateWorkspaceSelectorAction(m0);
    expect(m1).toEqual(m0);
  });

  it('home navigation pushes Home history', () => {
    let m = baseModel();
    m = pushHomeNavigationAction(m, NOTE);
    const h = m.workspaces[m.activeHub!]!.homeHistory;
    expect(h.entries.map(normalizeWorkspaceUri)).toContain(normalizeWorkspaceUri(NOTE));
    expect(h.index).toBeGreaterThan(0);
  });

  it('tab navigation pushes tab history', () => {
    let m = baseModel();
    m = openTabForegroundAction(m, OTHER, {tabId: `id-${OTHER}`});
    m = pushTabNavigationAction(m, NOTE);
    const tab = m.workspaces[m.activeHub!]!.tabs[0]!;
    expect(tab.history.entries.map(normalizeWorkspaceUri)).toContain(normalizeWorkspaceUri(NOTE));
  });

  it('goBack uses Home when Home is active', () => {
    let m = withHomeSubPage(baseModel());
    m = goBackAction(m);
    expect(m.workspaces[m.activeHub!]!.homeHistory.index).toBe(0);
  });

  it('goForward uses Home when Home is active', () => {
    let m = withHomeSubPage(baseModel());
    m = goBackAction(m);
    m = goForwardAction(m);
    expect(m.workspaces[m.activeHub!]!.homeHistory.index).toBe(1);
  });

  it('goBack uses tab history when tab is active (no spill to Home)', () => {
    let m = baseModel();
    m = openTabForegroundAction(m, OTHER, {tabId: `id-${OTHER}`});
    m = pushTabNavigationAction(m, NOTE);
    m = goBackAction(m);
    const tab = m.workspaces[m.activeHub!]!.tabs[0]!;
    expect(tab.history.index).toBe(0);
    expect(m.workspaces[m.activeHub!]!.homeHistory.index).toBe(0);
  });

  it('closing last tab activates Home without resetting Home history', () => {
    let m = withHomeSubPage(baseModel());
    m = openTabForegroundAction(m, NOTE, {tabId: `id-${NOTE}`});
    const histBefore = m.workspaces[m.activeHub!]!.homeHistory;
    const tabId = m.workspaces[m.activeHub!]!.tabs[0]!.id;
    m = closeTabAction(m, tabId);
    const ws = m.workspaces[m.activeHub!]!;
    expect(ws.active).toEqual({kind: 'home'});
    expect(ws.homeHistory).toEqual(histBefore);
  });

  it('closeAll activates Home without resetting Home history', () => {
    let m = withHomeSubPage(baseModel());
    m = openTabForegroundAction(m, OTHER, {tabId: `id-${OTHER}`});
    m = openTabForegroundAction(m, NOTE, {tabId: `id-${NOTE}`});
    const histBefore = m.workspaces[m.activeHub!]!.homeHistory;
    m = closeAllTabsAction(m);
    const ws = m.workspaces[m.activeHub!]!;
    expect(ws.tabs).toHaveLength(0);
    expect(ws.active).toEqual({kind: 'home'});
    expect(ws.homeHistory).toEqual(histBefore);
  });

  it('switching workspace restores that workspace active surface', () => {
    const hubA = normalizeWorkspaceUri('/vault/A/Today.md');
    const hubB = normalizeWorkspaceUri('/vault/B/Today.md');
    let m: WorkspaceModel = {
      activeHub: hubB,
      workspaces: {
        [hubA]: {
          ...createDefaultWorkspaceState(hubA),
          tabs: [{id: 't1', history: {entries: [hubA], index: 0}}],
          active: {kind: 'tab', id: 't1'},
        },
        [hubB]: createDefaultWorkspaceState(hubB),
      },
    };
    m = selectWorkspaceAction(m, hubA);
    expect(m.activeHub).toBe(hubA);
    expect(m.workspaces[hubA]!.active).toEqual({kind: 'tab', id: 't1'});
  });

  it('removeUris clamps histories; tabs with zero entries after prune are dropped', () => {
    const hub = normalizeWorkspaceUri(HUB);
    let m: WorkspaceModel = {
      activeHub: hub,
      workspaces: {
        [hub]: {
          tabs: [
            {
              id: 'a',
              history: {entries: [normalizeWorkspaceUri(NOTE)], index: 0},
            },
          ],
          homeHistory: {entries: [hub, normalizeWorkspaceUri(NOTE)], index: 1},
          active: {kind: 'tab', id: 'a'},
        },
      },
    };
    m = removeUrisAction(m, u => u === normalizeWorkspaceUri(NOTE));
    const ws = m.workspaces[hub]!;
    expect(ws.tabs).toHaveLength(0);
    expect(ws.active.kind).toBe('home');
    expect(ws.homeHistory.entries).toEqual([hub]);
    expect(ws.homeHistory.index).toBe(0);
  });

  it('removeUris removes workspace when hub matches predicate', () => {
    const hubA = normalizeWorkspaceUri('/vault/A/Today.md');
    const hubB = normalizeWorkspaceUri('/vault/B/Today.md');
    let m: WorkspaceModel = {
      activeHub: hubA,
      workspaces: {
        [hubA]: createDefaultWorkspaceState(hubA),
        [hubB]: createDefaultWorkspaceState(hubB),
      },
    };
    m = removeUrisAction(m, u => u === hubA);
    expect(m.workspaces[hubA]).toBeUndefined();
    expect(m.activeHub).toBe(hubB);
  });
});

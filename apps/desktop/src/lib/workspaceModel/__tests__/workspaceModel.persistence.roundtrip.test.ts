import {describe, expect, it} from 'vitest';
import {
  normalizeWorkspaceUri,
  parseWorkspaceModelFromPersistence,
  serializeWorkspaceModelToPersistence,
} from '../index';
import type {WorkspaceModel} from '../types';

const HUB = normalizeWorkspaceUri('/vault/Today/Today.md');
const NOTE = normalizeWorkspaceUri('/vault/Today/Note.md');

function expectModelsEqual(a: WorkspaceModel, b: WorkspaceModel): void {
  expect(a.activeHub).toBe(b.activeHub);
  const keys = sortedKeys(a.workspaces);
  expect(sortedKeys(b.workspaces)).toEqual(keys);
  for (const k of keys) {
    expect(b.workspaces[k]).toEqual(a.workspaces[k]);
  }
}

function sortedKeys(r: Record<string, unknown>): string[] {
  return Object.keys(r).sort((x, y) => x.localeCompare(y));
}

describe('workspaceModel persistence roundtrip', () => {
  it('serialize → parse returns equivalent canonical model', () => {
    const m: WorkspaceModel = {
      activeHub: HUB,
      workspaces: {
        [HUB]: {
          tabs: [
            {
              id: 't1',
              history: {entries: [HUB, NOTE], index: 1},
            },
          ],
          homeHistory: {entries: [HUB, NOTE], index: 0},
          active: {kind: 'tab', id: 't1'},
        },
      },
    };
    const blob = serializeWorkspaceModelToPersistence(m);
    const stored = blob.todayHubWorkspaces[HUB]!.editorWorkspaceTabs;
    expect(stored).toEqual([
      {id: 't1', entries: [HUB, NOTE], index: 1},
    ]);
    const back = parseWorkspaceModelFromPersistence({
      hubUris: [HUB],
      activeTodayHubUri: HUB,
      todayHubWorkspaces: blob.todayHubWorkspaces,
      editorWorkspaceTabs: undefined,
    });
    expectModelsEqual(back, m);
  });

  it('missing homeHistory creates default home history', () => {
    const m = parseWorkspaceModelFromPersistence({
      hubUris: [HUB],
      activeTodayHubUri: HUB,
      todayHubWorkspaces: {
        [HUB]: {
          editorWorkspaceTabs: [],
          activeEditorTabId: null,
        },
      },
    });
    expect(m.workspaces[HUB]!.homeHistory).toEqual({entries: [HUB], index: 0});
  });

  it('invalid home root resets to default', () => {
    const m = parseWorkspaceModelFromPersistence({
      hubUris: [HUB],
      activeTodayHubUri: HUB,
      todayHubWorkspaces: {
        [HUB]: {
          editorWorkspaceTabs: [],
          activeEditorTabId: null,
          homeHistory: {entries: [NOTE, HUB], index: 1},
        },
      },
    });
    expect(m.workspaces[HUB]!.homeHistory.entries[0]).toBe(HUB);
    expect(m.workspaces[HUB]!.homeHistory.index).toBe(0);
  });

  it('echo Today-tab is dropped', () => {
    const m = parseWorkspaceModelFromPersistence({
      hubUris: [HUB],
      activeTodayHubUri: HUB,
      todayHubWorkspaces: {
        [HUB]: {
          editorWorkspaceTabs: [
            {id: 'echo', entries: [HUB], index: 0},
            {id: 'ok', entries: [NOTE], index: 0},
          ],
          activeEditorTabId: 'ok',
          homeHistory: {entries: [HUB], index: 0},
        },
      },
    });
    expect(m.workspaces[HUB]!.tabs.map(t => t.id)).toEqual(['ok']);
  });

  it('activeEditorTabId: null stays null with tabs (active surface Home)', () => {
    const m = parseWorkspaceModelFromPersistence({
      hubUris: [HUB],
      activeTodayHubUri: HUB,
      todayHubWorkspaces: {
        [HUB]: {
          editorWorkspaceTabs: [
            {id: 't1', entries: [NOTE], index: 0},
          ],
          activeEditorTabId: null,
          homeHistory: {entries: [HUB], index: 0},
        },
      },
    });
    expect(m.workspaces[HUB]!.active).toEqual({kind: 'home'});
    const blob = serializeWorkspaceModelToPersistence(m);
    expect(blob.todayHubWorkspaces[HUB]!.activeEditorTabId).toBeNull();
  });

  it('invalid non-null active tab id clamps to a valid tab', () => {
    const m = parseWorkspaceModelFromPersistence({
      hubUris: [HUB],
      activeTodayHubUri: HUB,
      todayHubWorkspaces: {
        [HUB]: {
          editorWorkspaceTabs: [
            {id: 'a', entries: [NOTE], index: 0},
            {id: 'b', entries: [HUB, NOTE], index: 1},
          ],
          activeEditorTabId: 'nope',
          homeHistory: {entries: [HUB], index: 0},
        },
      },
    });
    expect(m.workspaces[HUB]!.active).toEqual({kind: 'tab', id: 'a'});
  });

  it('old top-level tabs migrate into active workspace when per-hub snapshot is absent', () => {
    const m = parseWorkspaceModelFromPersistence({
      hubUris: [HUB],
      activeTodayHubUri: HUB,
      todayHubWorkspaces: undefined,
      editorWorkspaceTabs: [{id: 'top', entries: [NOTE], index: 0}],
      activeEditorTabId: 'top',
    });
    expect(m.workspaces[HUB]!.tabs).toHaveLength(1);
    expect(m.workspaces[HUB]!.tabs[0]!.id).toBe('top');
    expect(m.activeHub).toBe(HUB);
  });

  it('old top-level tabs do not override existing per-hub canonical snapshot', () => {
    const m = parseWorkspaceModelFromPersistence({
      hubUris: [HUB],
      activeTodayHubUri: HUB,
      todayHubWorkspaces: {
        [HUB]: {
          editorWorkspaceTabs: [{id: 'snap', entries: [NOTE], index: 0}],
          activeEditorTabId: 'snap',
          homeHistory: {entries: [HUB], index: 0},
        },
      },
      editorWorkspaceTabs: [{id: 'top', entries: [HUB, NOTE], index: 1}],
      activeEditorTabId: 'top',
    });
    expect(m.workspaces[HUB]!.tabs[0]!.id).toBe('snap');
  });

  it('openTabUris migrates when snapshot absent and top-level tabs empty', () => {
    const m = parseWorkspaceModelFromPersistence({
      hubUris: [HUB],
      activeTodayHubUri: HUB,
      todayHubWorkspaces: undefined,
      editorWorkspaceTabs: [],
      openTabUris: [NOTE],
    });
    expect(m.workspaces[HUB]!.tabs.length).toBeGreaterThan(0);
    expect(m.workspaces[HUB]!.tabs[0]!.history.entries.map(normalizeWorkspaceUri)).toContain(NOTE);
  });

  it('no active hub (empty hubUris): persistence is ignored; model is empty', () => {
    const m = parseWorkspaceModelFromPersistence({
      hubUris: [],
      activeTodayHubUri: HUB,
      todayHubWorkspaces: {
        [HUB]: {
          editorWorkspaceTabs: [{id: 'x', entries: [NOTE], index: 0}],
          activeEditorTabId: 'x',
        },
      },
      editorWorkspaceTabs: [{id: 'y', entries: [NOTE], index: 0}],
    });
    expect(m).toEqual({activeHub: null, workspaces: {}});
  });

  it('remaps non-canonical todayHubWorkspaces keys (backslashes and duplicate slashes)', () => {
    const keyBackslashes = '/vault/Today/Today.md'.replace(/\//g, '\\');
    const keyDupSlashes = '/vault//Today//Today.md';

    const fromBackslashes = parseWorkspaceModelFromPersistence({
      hubUris: [HUB],
      activeTodayHubUri: HUB,
      todayHubWorkspaces: {
        [keyBackslashes]: {
          editorWorkspaceTabs: [{id: 't1', entries: [NOTE], index: 0}],
          activeEditorTabId: 't1',
          homeHistory: {entries: [HUB], index: 0},
        },
      },
    });
    expect(fromBackslashes.workspaces[HUB]!.tabs[0]!.id).toBe('t1');

    const fromDupSlashes = parseWorkspaceModelFromPersistence({
      hubUris: [HUB],
      activeTodayHubUri: HUB,
      todayHubWorkspaces: {
        [keyDupSlashes]: {
          editorWorkspaceTabs: [{id: 't2', entries: [NOTE], index: 0}],
          activeEditorTabId: 't2',
          homeHistory: {entries: [HUB], index: 0},
        },
      },
    });
    expect(fromDupSlashes.workspaces[HUB]!.tabs[0]!.id).toBe('t2');
  });

  it('remapped keys restore inactive hub snapshots in multi-hub vaults', () => {
    const hubA = normalizeWorkspaceUri('/vault/A/Today.md');
    const hubB = normalizeWorkspaceUri('/vault/B/Today.md');
    const noteB = normalizeWorkspaceUri('/vault/Inbox/B.md');
    const weirdKeyB = '/vault//B//Today.md';

    const m = parseWorkspaceModelFromPersistence({
      hubUris: [hubA, hubB],
      activeTodayHubUri: hubA,
      todayHubWorkspaces: {
        [weirdKeyB]: {
          editorWorkspaceTabs: [{id: 'tab-b', entries: [noteB], index: 0}],
          activeEditorTabId: 'tab-b',
        },
      },
    });

    expect(m.workspaces[hubB]!.tabs[0]!.id).toBe('tab-b');
    expect(m.workspaces[hubB]!.active).toEqual({kind: 'tab', id: 'tab-b'});
  });
});

import {describe, expect, it} from 'vitest';

import type {TodayHubWorkspaceSnapshot} from '../lib/mainWindowUiStore';
import type {WorkspaceHomeState} from '../lib/workspaceHomeNavigation';
import {
  closeAllTabsAction,
  closeOtherTabsAction,
  closeTabAction,
  createDefaultWorkspaceState,
  goBackAction,
  goForwardAction,
  normalizeWorkspaceUri,
  openTabBackgroundAction,
  remapPrefixAction,
  removeUrisAction,
  reorderTabsAction,
  serializeWorkspaceModelToPersistence,
  type WorkspaceModel,
} from '../lib/workspaceModel';
import {
  activeSurfaceTabIdFromWorkspaceModel,
  editorWorkspaceTabsFromModelTabEntries,
  projectWorkspaceRuntimeToModel,
  resolveModelBackedLegacyTabStrip,
  workspaceStateForIncomingHubSwitch,
} from './workspaceRuntimeProjection';

const HUB_A = '/vault/A/Today.md';
const HUB_B = '/vault/B/Today.md';
const NOTE_A = '/vault/Inbox/A.md';
const NOTE_B = '/vault/Inbox/B.md';
const NOTE_HOME = '/vault/Inbox/Home.md';

function runtimeTab(id: string, entries: string[], index = entries.length - 1) {
  return {id, history: {entries, index}};
}

describe('activeSurfaceTabIdFromWorkspaceModel', () => {
  it('returns null when active hub is Home', () => {
    expect(
      activeSurfaceTabIdFromWorkspaceModel({
        activeHub: HUB_A,
        workspaces: {
          [HUB_A]: {
            tabs: [{id: 'tab-a', history: {entries: [NOTE_A], index: 0}}],
            active: {kind: 'home'},
            homeHistory: {entries: [HUB_A], index: 0},
          },
        },
      }),
    ).toBeNull();
  });

  it('returns tab id when active hub surface is a tab', () => {
    expect(
      activeSurfaceTabIdFromWorkspaceModel({
        activeHub: HUB_A,
        workspaces: {
          [HUB_A]: {
            tabs: [{id: 'tab-a', history: {entries: [NOTE_A], index: 0}}],
            active: {kind: 'tab', id: 'tab-a'},
            homeHistory: {entries: [HUB_A], index: 0},
          },
        },
      }),
    ).toBe('tab-a');
  });

  it('returns null when activeHub or workspace entry is missing', () => {
    expect(activeSurfaceTabIdFromWorkspaceModel({activeHub: null, workspaces: {}})).toBeNull();
    expect(
      activeSurfaceTabIdFromWorkspaceModel({
        activeHub: HUB_A,
        workspaces: {},
      }),
    ).toBeNull();
  });
});

describe('editorWorkspaceTabsFromModelTabEntries', () => {
  it('maps TabEntry stacks to EditorWorkspaceTab histories', () => {
    const converted = editorWorkspaceTabsFromModelTabEntries([
      {id: 't1', history: {entries: [NOTE_A, NOTE_B], index: 1}},
    ]);
    expect(converted).toEqual([
      {id: 't1', history: {entries: [NOTE_A, NOTE_B], index: 1}},
    ]);
  });

  it('matches reorderTabsAction tab order and preserves active surface', () => {
    const hubNorm = normalizeWorkspaceUri(HUB_A);
    const base = createDefaultWorkspaceState(HUB_A);
    const model: WorkspaceModel = {
      activeHub: hubNorm,
      workspaces: {
        [hubNorm]: {
          ...base,
          tabs: [
            {id: 't1', history: {entries: [NOTE_A], index: 0}},
            {id: 't2', history: {entries: [NOTE_B], index: 0}},
          ],
          active: {kind: 'tab', id: 't1'},
        },
      },
    };
    const reordered = reorderTabsAction(model, 0, 2);
    const ws = reordered.workspaces[hubNorm];
    expect(ws?.active).toEqual({kind: 'tab', id: 't1'});
    const legacyOrder = editorWorkspaceTabsFromModelTabEntries(ws!.tabs).map(t => t.id);
    expect(legacyOrder).toEqual(['t2', 't1']);

    const persisted = serializeWorkspaceModelToPersistence(reordered);
    expect(persisted.todayHubWorkspaces[hubNorm]?.editorWorkspaceTabs.map(t => t.id)).toEqual([
      't2',
      't1',
    ]);
  });

  it('closeAllTabsAction clears tabs, activates Home, and persists empty tab strip', () => {
    const hubNorm = normalizeWorkspaceUri(HUB_A);
    const base = createDefaultWorkspaceState(HUB_A);
    const model: WorkspaceModel = {
      activeHub: hubNorm,
      workspaces: {
        [hubNorm]: {
          ...base,
          tabs: [{id: 't1', history: {entries: [NOTE_A], index: 0}}],
          active: {kind: 'tab', id: 't1'},
        },
      },
    };
    const closed = closeAllTabsAction(model);
    const ws = closed.workspaces[hubNorm];
    expect(ws?.tabs).toEqual([]);
    expect(ws?.active).toEqual({kind: 'home'});
    expect(activeSurfaceTabIdFromWorkspaceModel(closed)).toBeNull();
    expect(editorWorkspaceTabsFromModelTabEntries(ws!.tabs)).toEqual([]);
    const persisted = serializeWorkspaceModelToPersistence(closed);
    expect(persisted.todayHubWorkspaces[hubNorm]?.editorWorkspaceTabs ?? []).toEqual([]);
  });

  it('closeOtherTabsAction keeps only the requested tab, preserves order, and persists one tab', () => {
    const hubNorm = normalizeWorkspaceUri(HUB_A);
    const base = createDefaultWorkspaceState(HUB_A);
    const model: WorkspaceModel = {
      activeHub: hubNorm,
      workspaces: {
        [hubNorm]: {
          ...base,
          tabs: [
            {id: 't1', history: {entries: [NOTE_A], index: 0}},
            {id: 't2', history: {entries: [NOTE_B], index: 0}},
          ],
          active: {kind: 'tab', id: 't1'},
        },
      },
    };
    const closed = closeOtherTabsAction(model, 't2');
    const ws = closed.workspaces[hubNorm];
    expect(ws?.tabs.map(t => t.id)).toEqual(['t2']);
    expect(ws?.active).toEqual({kind: 'tab', id: 't2'});
    expect(activeSurfaceTabIdFromWorkspaceModel(closed)).toBe('t2');
    const legacy = editorWorkspaceTabsFromModelTabEntries(ws!.tabs);
    expect(legacy.map(t => t.id)).toEqual(['t2']);
    const persisted = serializeWorkspaceModelToPersistence(closed);
    expect(persisted.todayHubWorkspaces[hubNorm]?.editorWorkspaceTabs.map(x => x.id)).toEqual([
      't2',
    ]);
  });

  it('closeTabAction removes inactive tab without changing active tab id', () => {
    const hubNorm = normalizeWorkspaceUri(HUB_A);
    const base = createDefaultWorkspaceState(HUB_A);
    const model: WorkspaceModel = {
      activeHub: hubNorm,
      workspaces: {
        [hubNorm]: {
          ...base,
          tabs: [
            {id: 't1', history: {entries: [NOTE_A], index: 0}},
            {id: 't2', history: {entries: [NOTE_B], index: 0}},
          ],
          active: {kind: 'tab', id: 't1'},
        },
      },
    };
    const closed = closeTabAction(model, 't2');
    const ws = closed.workspaces[hubNorm];
    expect(ws?.tabs.map(t => t.id)).toEqual(['t1']);
    expect(ws?.active).toEqual({kind: 'tab', id: 't1'});
    expect(activeSurfaceTabIdFromWorkspaceModel(closed)).toBe('t1');
    const persisted = serializeWorkspaceModelToPersistence(closed);
    expect(persisted.todayHubWorkspaces[hubNorm]?.editorWorkspaceTabs.map(x => x.id)).toEqual([
      't1',
    ]);
  });

  it('closeTabAction activates right neighbor when closing active left tab', () => {
    const hubNorm = normalizeWorkspaceUri(HUB_A);
    const base = createDefaultWorkspaceState(HUB_A);
    const model: WorkspaceModel = {
      activeHub: hubNorm,
      workspaces: {
        [hubNorm]: {
          ...base,
          tabs: [
            {id: 't1', history: {entries: [NOTE_A], index: 0}},
            {id: 't2', history: {entries: [NOTE_B], index: 0}},
          ],
          active: {kind: 'tab', id: 't1'},
        },
      },
    };
    const closed = closeTabAction(model, 't1');
    const ws = closed.workspaces[hubNorm];
    expect(ws?.tabs.map(t => t.id)).toEqual(['t2']);
    expect(ws?.active).toEqual({kind: 'tab', id: 't2'});
    expect(activeSurfaceTabIdFromWorkspaceModel(closed)).toBe('t2');
    const legacy = editorWorkspaceTabsFromModelTabEntries(ws!.tabs);
    expect(legacy.map(t => t.id)).toEqual(['t2']);
    const persisted = serializeWorkspaceModelToPersistence(closed);
    expect(persisted.todayHubWorkspaces[hubNorm]?.editorWorkspaceTabs.map(x => x.id)).toEqual([
      't2',
    ]);
  });

  it('closeTabAction activates left neighbor when closing active right tab', () => {
    const hubNorm = normalizeWorkspaceUri(HUB_A);
    const base = createDefaultWorkspaceState(HUB_A);
    const model: WorkspaceModel = {
      activeHub: hubNorm,
      workspaces: {
        [hubNorm]: {
          ...base,
          tabs: [
            {id: 't1', history: {entries: [NOTE_A], index: 0}},
            {id: 't2', history: {entries: [NOTE_B], index: 0}},
          ],
          active: {kind: 'tab', id: 't2'},
        },
      },
    };
    const closed = closeTabAction(model, 't2');
    const ws = closed.workspaces[hubNorm];
    expect(ws?.tabs.map(t => t.id)).toEqual(['t1']);
    expect(ws?.active).toEqual({kind: 'tab', id: 't1'});
    expect(activeSurfaceTabIdFromWorkspaceModel(closed)).toBe('t1');
  });

  it('closeTabAction activates Home when closing sole tab', () => {
    const hubNorm = normalizeWorkspaceUri(HUB_A);
    const base = createDefaultWorkspaceState(HUB_A);
    const model: WorkspaceModel = {
      activeHub: hubNorm,
      workspaces: {
        [hubNorm]: {
          ...base,
          tabs: [{id: 't1', history: {entries: [NOTE_A], index: 0}}],
          active: {kind: 'tab', id: 't1'},
        },
      },
    };
    const closed = closeTabAction(model, 't1');
    const ws = closed.workspaces[hubNorm];
    expect(ws?.tabs).toEqual([]);
    expect(ws?.active).toEqual({kind: 'home'});
    expect(activeSurfaceTabIdFromWorkspaceModel(closed)).toBeNull();
    expect(editorWorkspaceTabsFromModelTabEntries(ws!.tabs)).toEqual([]);
    const persisted = serializeWorkspaceModelToPersistence(closed);
    expect(persisted.todayHubWorkspaces[hubNorm]?.editorWorkspaceTabs ?? []).toEqual([]);
  });

  it('openTabBackgroundAction appends with explicit tabId, preserves active tab, and persists', () => {
    const hubNorm = normalizeWorkspaceUri(HUB_A);
    const base = createDefaultWorkspaceState(HUB_A);
    const noteA = normalizeWorkspaceUri(NOTE_A);
    const model: WorkspaceModel = {
      activeHub: hubNorm,
      workspaces: {
        [hubNorm]: {
          ...base,
          tabs: [{id: 't1', history: {entries: [noteA], index: 0}}],
          active: {kind: 'tab', id: 't1'},
        },
      },
    };
    const opened = openTabBackgroundAction(model, NOTE_B, {tabId: 'bg1'});
    const ws = opened.workspaces[hubNorm];
    expect(ws?.tabs.map(t => t.id)).toEqual(['t1', 'bg1']);
    expect(ws?.active).toEqual({kind: 'tab', id: 't1'});
    expect(activeSurfaceTabIdFromWorkspaceModel(opened)).toBe('t1');
    const persisted = serializeWorkspaceModelToPersistence(opened);
    expect(persisted.todayHubWorkspaces[hubNorm]?.editorWorkspaceTabs?.map(t => t.id)).toEqual([
      't1',
      'bg1',
    ]);
  });

  it('openTabBackgroundAction insertAfterTab orders like legacy insertTabAfterActive', () => {
    const hubNorm = normalizeWorkspaceUri(HUB_A);
    const noteA = normalizeWorkspaceUri(NOTE_A);
    const noteB = normalizeWorkspaceUri(NOTE_B);
    const model: WorkspaceModel = {
      activeHub: hubNorm,
      workspaces: {
        [hubNorm]: {
          ...createDefaultWorkspaceState(HUB_A),
          tabs: [
            {id: 't1', history: {entries: [noteA], index: 0}},
            {id: 't2', history: {entries: [noteB], index: 0}},
          ],
          active: {kind: 'tab', id: 't1'},
        },
      },
    };
    const opened = openTabBackgroundAction(model, NOTE_HOME, {
      placement: 'insertAfterTab',
      tabId: 'new1',
      insertAfterTabId: 't1',
    });
    const ws = opened.workspaces[hubNorm];
    expect(ws?.tabs.map(t => t.id)).toEqual(['t1', 'new1', 't2']);
    expect(ws?.active).toEqual({kind: 'tab', id: 't1'});
  });

  it('openTabBackgroundAction insertAtIndex splices like legacy insertTabAtIndex', () => {
    const hubNorm = normalizeWorkspaceUri(HUB_A);
    const noteA = normalizeWorkspaceUri(NOTE_A);
    const noteB = normalizeWorkspaceUri(NOTE_B);
    const model: WorkspaceModel = {
      activeHub: hubNorm,
      workspaces: {
        [hubNorm]: {
          ...createDefaultWorkspaceState(HUB_A),
          tabs: [
            {id: 't1', history: {entries: [noteA], index: 0}},
            {id: 't2', history: {entries: [noteB], index: 0}},
          ],
          active: {kind: 'tab', id: 't2'},
        },
      },
    };
    const opened = openTabBackgroundAction(model, NOTE_HOME, {
      placement: 'insertAtIndex',
      tabId: 'n',
      insertAtIndex: 1,
    });
    const ws = opened.workspaces[hubNorm];
    expect(ws?.tabs.map(t => t.id)).toEqual(['t1', 'n', 't2']);
    expect(ws?.active).toEqual({kind: 'tab', id: 't2'});
  });

  it('openTabBackgroundAction keeps Home surface active when background-opening from Home', () => {
    const hubNorm = normalizeWorkspaceUri(HUB_A);
    const noteA = normalizeWorkspaceUri(NOTE_A);
    const model: WorkspaceModel = {
      activeHub: hubNorm,
      workspaces: {
        [hubNorm]: {
          ...createDefaultWorkspaceState(HUB_A),
          tabs: [{id: 't1', history: {entries: [noteA], index: 0}}],
          active: {kind: 'home'},
        },
      },
    };
    const opened = openTabBackgroundAction(model, NOTE_B, {tabId: 'bg'});
    const ws = opened.workspaces[hubNorm];
    expect(ws?.active).toEqual({kind: 'home'});
    expect(ws?.tabs.map(t => t.id)).toEqual(['t1', 'bg']);
    expect(activeSurfaceTabIdFromWorkspaceModel(opened)).toBeNull();
  });

  it('goBackAction moves active tab history to the previous entry and persists index', () => {
    const hubNorm = normalizeWorkspaceUri(HUB_A);
    const base = createDefaultWorkspaceState(HUB_A);
    const noteA = normalizeWorkspaceUri(NOTE_A);
    const noteB = normalizeWorkspaceUri(NOTE_B);
    const model: WorkspaceModel = {
      activeHub: hubNorm,
      workspaces: {
        [hubNorm]: {
          ...base,
          tabs: [
            {
              id: 't1',
              history: {entries: [noteA, noteB], index: 1},
            },
          ],
          active: {kind: 'tab', id: 't1'},
        },
      },
    };
    const after = goBackAction(model);
    const ws = after.workspaces[hubNorm];
    expect(ws?.tabs[0]?.history.index).toBe(0);
    expect(ws?.tabs[0]?.history.entries.map(normalizeWorkspaceUri)).toEqual([noteA, noteB]);
    expect(ws?.active).toEqual({kind: 'tab', id: 't1'});
    expect(activeSurfaceTabIdFromWorkspaceModel(after)).toBe('t1');
    const legacy = editorWorkspaceTabsFromModelTabEntries(ws!.tabs);
    expect(legacy[0]?.history.index).toBe(0);
    const persisted = serializeWorkspaceModelToPersistence(after);
    const row = persisted.todayHubWorkspaces[hubNorm]?.editorWorkspaceTabs?.[0];
    expect(row?.index).toBe(0);
    expect(row?.entries.map(normalizeWorkspaceUri)).toEqual([noteA, noteB]);
  });

  it('goForwardAction advances active tab history and persists index', () => {
    const hubNorm = normalizeWorkspaceUri(HUB_A);
    const base = createDefaultWorkspaceState(HUB_A);
    const noteA = normalizeWorkspaceUri(NOTE_A);
    const noteB = normalizeWorkspaceUri(NOTE_B);
    const model: WorkspaceModel = {
      activeHub: hubNorm,
      workspaces: {
        [hubNorm]: {
          ...base,
          tabs: [
            {
              id: 't1',
              history: {entries: [noteA, noteB], index: 0},
            },
          ],
          active: {kind: 'tab', id: 't1'},
        },
      },
    };
    const after = goForwardAction(model);
    const ws = after.workspaces[hubNorm];
    expect(ws?.tabs[0]?.history.index).toBe(1);
    expect(ws?.active).toEqual({kind: 'tab', id: 't1'});
    const persisted = serializeWorkspaceModelToPersistence(after);
    expect(persisted.todayHubWorkspaces[hubNorm]?.editorWorkspaceTabs?.[0]?.index).toBe(1);
  });

  it('goBackAction does not change inactive tabs or active tab id', () => {
    const hubNorm = normalizeWorkspaceUri(HUB_A);
    const base = createDefaultWorkspaceState(HUB_A);
    const noteA = normalizeWorkspaceUri(NOTE_A);
    const noteB = normalizeWorkspaceUri(NOTE_B);
    const noteHome = normalizeWorkspaceUri(NOTE_HOME);
    const model: WorkspaceModel = {
      activeHub: hubNorm,
      workspaces: {
        [hubNorm]: {
          ...base,
          tabs: [
            {
              id: 't1',
              history: {entries: [noteA, noteB], index: 1},
            },
            {
              id: 't2',
              history: {entries: [noteHome], index: 0},
            },
          ],
          active: {kind: 'tab', id: 't1'},
        },
      },
    };
    const after = goBackAction(model);
    const ws = after.workspaces[hubNorm];
    expect(ws?.tabs.map(t => t.id)).toEqual(['t1', 't2']);
    expect(ws?.tabs[1]?.history).toEqual({entries: [noteHome], index: 0});
    expect(ws?.active).toEqual({kind: 'tab', id: 't1'});
  });

  it('goBackAction does not mutate tabs when Home surface is active', () => {
    const hubNorm = normalizeWorkspaceUri(HUB_A);
    const base = createDefaultWorkspaceState(HUB_A);
    const noteA = normalizeWorkspaceUri(NOTE_A);
    const tabsBefore = [
      {
        id: 't1',
        history: {entries: [noteA], index: 0},
      },
    ];
    const model: WorkspaceModel = {
      activeHub: hubNorm,
      workspaces: {
        [hubNorm]: {
          ...base,
          tabs: tabsBefore,
          active: {kind: 'home'},
          homeHistory: {entries: [HUB_A, NOTE_A].map(normalizeWorkspaceUri), index: 1},
        },
      },
    };
    const after = goBackAction(model);
    const ws = after.workspaces[hubNorm];
    expect(ws?.tabs).toEqual(tabsBefore);
  });
});

describe('remapPrefixAction', () => {
  it('remaps URIs in active and inactive tab histories and preserves tab order and active id', () => {
    const hubNorm = normalizeWorkspaceUri(HUB_A);
    const oldNote = '/vault/Inbox/RenameNote.md';
    const newNote = '/vault/Inbox/RenamedNote.md';
    const other = '/vault/Inbox/Other.md';
    const model: WorkspaceModel = {
      activeHub: hubNorm,
      workspaces: {
        [hubNorm]: {
          ...createDefaultWorkspaceState(HUB_A),
          tabs: [
            {
              id: 't1',
              history: {
                entries: [
                  normalizeWorkspaceUri(oldNote),
                  normalizeWorkspaceUri(other),
                ],
                index: 0,
              },
            },
            {
              id: 't2',
              history: {entries: [normalizeWorkspaceUri(oldNote)], index: 0},
            },
          ],
          active: {kind: 'tab', id: 't1'},
        },
      },
    };
    const after = remapPrefixAction(model, oldNote, newNote);
    const ws = after.workspaces[hubNorm];
    expect(ws?.tabs.map(t => t.id)).toEqual(['t1', 't2']);
    expect(ws?.active).toEqual({kind: 'tab', id: 't1'});
    expect(ws?.tabs[0]?.history.entries.map(normalizeWorkspaceUri)).toEqual([
      normalizeWorkspaceUri(newNote),
      normalizeWorkspaceUri(other),
    ]);
    expect(ws?.tabs[1]?.history.entries.map(normalizeWorkspaceUri)).toEqual([
      normalizeWorkspaceUri(newNote),
    ]);
    const persisted = serializeWorkspaceModelToPersistence(after);
    const rows = persisted.todayHubWorkspaces[hubNorm]?.editorWorkspaceTabs ?? [];
    expect(rows.map(r => r.entries.map(normalizeWorkspaceUri))).toEqual([
      [normalizeWorkspaceUri(newNote), normalizeWorkspaceUri(other)],
      [normalizeWorkspaceUri(newNote)],
    ]);
  });

  it('remaps workspace hub key and activeHub for directory prefix moves while preserving tab order', () => {
    const oldHub = '/vault/Inbox/OldProj/Today.md';
    const newHub = '/vault/Inbox/NewProj/Today.md';
    const oldHubNorm = normalizeWorkspaceUri(oldHub);
    const newHubNorm = normalizeWorkspaceUri(newHub);
    const noteUnderOld = '/vault/Inbox/OldProj/Inbox/a.md';
    const noteUnderNew = '/vault/Inbox/NewProj/Inbox/a.md';
    const model: WorkspaceModel = {
      activeHub: oldHubNorm,
      workspaces: {
        [oldHubNorm]: {
          ...createDefaultWorkspaceState(oldHub),
          tabs: [
            {
              id: 'a',
              history: {entries: [normalizeWorkspaceUri(noteUnderOld)], index: 0},
            },
            {
              id: 'b',
              history: {entries: [normalizeWorkspaceUri('/vault/Else.md')], index: 0},
            },
          ],
          active: {kind: 'tab', id: 'a'},
        },
      },
    };
    const after = remapPrefixAction(
      model,
      '/vault/Inbox/OldProj',
      '/vault/Inbox/NewProj',
    );
    expect(after.activeHub).toBe(newHubNorm);
    expect(Object.keys(after.workspaces).sort()).toEqual([newHubNorm]);
    const ws = after.workspaces[newHubNorm];
    expect(ws?.tabs.map(t => t.id)).toEqual(['a', 'b']);
    expect(ws?.active).toEqual({kind: 'tab', id: 'a'});
    expect(ws?.tabs[0]?.history.entries[0]).toBe(normalizeWorkspaceUri(noteUnderNew));
  });
});

describe('removeUrisAction', () => {
  it('drops matching URIs from tab histories, removes emptied tabs, and keeps active when it survives', () => {
    const hubNorm = normalizeWorkspaceUri(HUB_A);
    const gone = normalizeWorkspaceUri('/vault/Inbox/Gone.md');
    const keep = normalizeWorkspaceUri(NOTE_A);
    const model: WorkspaceModel = {
      activeHub: hubNorm,
      workspaces: {
        [hubNorm]: {
          ...createDefaultWorkspaceState(HUB_A),
          tabs: [
            {id: 't1', history: {entries: [gone, keep], index: 1}},
            {id: 't2', history: {entries: [gone], index: 0}},
          ],
          active: {kind: 'tab', id: 't1'},
        },
      },
    };
    const after = removeUrisAction(model, u => u === gone);
    const ws = after.workspaces[hubNorm];
    expect(ws?.tabs.map(t => t.id)).toEqual(['t1']);
    expect(ws?.tabs[0]?.history.entries.map(normalizeWorkspaceUri)).toEqual([keep]);
    expect(ws?.active).toEqual({kind: 'tab', id: 't1'});
    const persisted = serializeWorkspaceModelToPersistence(after);
    const rows = persisted.todayHubWorkspaces[hubNorm]?.editorWorkspaceTabs ?? [];
    expect(rows.map(r => r.entries.map(normalizeWorkspaceUri))).toEqual([[keep]]);
  });

  it('preserves active tab when deleting a URI that only appeared on an inactive tab', () => {
    const hubNorm = normalizeWorkspaceUri(HUB_A);
    const gone = normalizeWorkspaceUri('/vault/Inbox/Gone.md');
    const keep = normalizeWorkspaceUri(NOTE_A);
    const model: WorkspaceModel = {
      activeHub: hubNorm,
      workspaces: {
        [hubNorm]: {
          ...createDefaultWorkspaceState(HUB_A),
          tabs: [
            {id: 't1', history: {entries: [keep], index: 0}},
            {id: 't2', history: {entries: [gone], index: 0}},
          ],
          active: {kind: 'tab', id: 't1'},
        },
      },
    };
    const after = removeUrisAction(model, u => u === gone);
    const ws = after.workspaces[hubNorm];
    expect(ws?.tabs.map(t => t.id)).toEqual(['t1']);
    expect(ws?.active).toEqual({kind: 'tab', id: 't1'});
  });

  it('prunes paths under a deleted folder prefix and persists remaining URIs', () => {
    const hubNorm = normalizeWorkspaceUri(HUB_A);
    const folder = '/vault/Inbox/OldDir';
    const under = normalizeWorkspaceUri(`${folder}/note.md`);
    const outside = normalizeWorkspaceUri(NOTE_A);
    const model: WorkspaceModel = {
      activeHub: hubNorm,
      workspaces: {
        [hubNorm]: {
          ...createDefaultWorkspaceState(HUB_A),
          tabs: [
            {
              id: 'a',
              history: {entries: [under, outside], index: 1},
            },
          ],
          active: {kind: 'tab', id: 'a'},
        },
      },
    };
    const pred = (u: string) => {
      const f = folder;
      return u === f || u.startsWith(`${f}/`);
    };
    const after = removeUrisAction(model, pred);
    const ws = after.workspaces[hubNorm];
    expect(ws?.tabs[0]?.history.entries.map(normalizeWorkspaceUri)).toEqual([outside]);
    expect(ws?.tabs[0]?.history.index).toBe(0);
    const persisted = serializeWorkspaceModelToPersistence(after);
    expect(
      persisted.todayHubWorkspaces[hubNorm]?.editorWorkspaceTabs?.[0]?.entries.map(
        normalizeWorkspaceUri,
      ),
    ).toEqual([outside]);
  });
});

describe('workspaceStateForIncomingHubSwitch', () => {
  it('matches projectWorkspaceRuntimeToModel active-hub slice for a tab surface', () => {
    const tabs = [runtimeTab('tab-a', [NOTE_A])];
    const hubNorm = normalizeWorkspaceUri(HUB_A);
    const fromSwitch = workspaceStateForIncomingHubSwitch({
      hubUri: HUB_A,
      nextTabs: tabs,
      nextActive: 'tab-a',
      snapshot: undefined,
      homeStatesByHub: {},
    });
    const projected = projectWorkspaceRuntimeToModel({
      activeTodayHubUri: HUB_A,
      editorWorkspaceTabs: tabs,
      activeEditorTabId: 'tab-a',
      legacyHubWorkspaceSnapshots: {},
      homeStatesByHub: {},
      hubUris: [HUB_A],
    });
    expect(fromSwitch).toEqual(projected.workspaces[hubNorm]);
  });

  it('matches active-hub slice for Home surface with runtime home stack override', () => {
    const snapshotA: TodayHubWorkspaceSnapshot = {
      editorWorkspaceTabs: [],
      activeEditorTabId: null,
      homeHistory: {entries: [HUB_A, NOTE_A], index: 1},
    };
    const homeStatesByHub: Record<string, WorkspaceHomeState> = {
      [HUB_A]: {history: {entries: [HUB_A, NOTE_HOME], index: 1}},
    };
    const hubNorm = normalizeWorkspaceUri(HUB_A);
    const fromSwitch = workspaceStateForIncomingHubSwitch({
      hubUri: HUB_A,
      nextTabs: [],
      nextActive: null,
      snapshot: snapshotA,
      homeStatesByHub,
    });
    const projected = projectWorkspaceRuntimeToModel({
      activeTodayHubUri: HUB_A,
      editorWorkspaceTabs: [],
      activeEditorTabId: null,
      legacyHubWorkspaceSnapshots: {[HUB_A]: snapshotA},
      homeStatesByHub,
      hubUris: [HUB_A],
    });
    expect(fromSwitch).toEqual(projected.workspaces[hubNorm]);
  });
});

describe('projectWorkspaceRuntimeToModel', () => {
  it('projects active hub with tabs while Home remains active', () => {
    const model = projectWorkspaceRuntimeToModel({
      activeTodayHubUri: HUB_A,
      editorWorkspaceTabs: [runtimeTab('tab-a', [NOTE_A])],
      activeEditorTabId: null,
      legacyHubWorkspaceSnapshots: {},
      homeStatesByHub: {},
      hubUris: [HUB_A],
    });

    expect(model.activeHub).toBe(HUB_A);
    expect(model.workspaces[HUB_A]?.tabs.map(t => t.id)).toEqual(['tab-a']);
    expect(model.workspaces[HUB_A]?.active).toEqual({kind: 'home'});
  });

  it('projects active hub with an active tab', () => {
    const model = projectWorkspaceRuntimeToModel({
      activeTodayHubUri: HUB_A,
      editorWorkspaceTabs: [runtimeTab('tab-a', [NOTE_A])],
      activeEditorTabId: 'tab-a',
      legacyHubWorkspaceSnapshots: {},
      homeStatesByHub: {},
      hubUris: [HUB_A],
    });

    expect(model.workspaces[HUB_A]?.active).toEqual({kind: 'tab', id: 'tab-a'});
  });

  it('preserves inactive hub snapshots', () => {
    const snapshotB: TodayHubWorkspaceSnapshot = {
      editorWorkspaceTabs: [{id: 'tab-b', entries: [NOTE_B], index: 0}],
      activeEditorTabId: 'tab-b',
    };

    const model = projectWorkspaceRuntimeToModel({
      activeTodayHubUri: HUB_A,
      editorWorkspaceTabs: [runtimeTab('tab-a', [NOTE_A])],
      activeEditorTabId: 'tab-a',
      legacyHubWorkspaceSnapshots: {[HUB_B]: snapshotB},
      homeStatesByHub: {},
      hubUris: [HUB_A, HUB_B],
    });

    expect(model.workspaces[HUB_B]?.tabs).toEqual([
      {id: 'tab-b', history: {entries: [NOTE_B], index: 0}},
    ]);
    expect(model.workspaces[HUB_B]?.active).toEqual({kind: 'tab', id: 'tab-b'});
  });

  it('lets runtime homeStatesByHub override snapshot homeHistory', () => {
    const snapshotA: TodayHubWorkspaceSnapshot = {
      editorWorkspaceTabs: [],
      activeEditorTabId: null,
      homeHistory: {entries: [HUB_A, NOTE_A], index: 1},
    };
    const homeStatesByHub: Record<string, WorkspaceHomeState> = {
      [HUB_A]: {history: {entries: [HUB_A, NOTE_HOME], index: 1}},
    };

    const model = projectWorkspaceRuntimeToModel({
      activeTodayHubUri: HUB_A,
      editorWorkspaceTabs: [],
      activeEditorTabId: null,
      legacyHubWorkspaceSnapshots: {[HUB_A]: snapshotA},
      homeStatesByHub,
      hubUris: [HUB_A],
    });

    expect(model.workspaces[HUB_A]?.homeHistory).toEqual({
      entries: [HUB_A, NOTE_HOME],
      index: 1,
    });
  });

  it('creates a default workspace state for missing hubs', () => {
    const model = projectWorkspaceRuntimeToModel({
      activeTodayHubUri: HUB_A,
      editorWorkspaceTabs: [],
      activeEditorTabId: null,
      legacyHubWorkspaceSnapshots: {},
      homeStatesByHub: {},
      hubUris: [HUB_A, HUB_B],
    });

    expect(model.workspaces[HUB_B]).toEqual({
      tabs: [],
      active: {kind: 'home'},
      homeHistory: {entries: [HUB_B], index: 0},
    });
  });
});

describe('resolveModelBackedLegacyTabStrip', () => {
  const hubNorm = normalizeWorkspaceUri(HUB_A);
  const noteA = normalizeWorkspaceUri(NOTE_A);
  const noteB = normalizeWorkspaceUri(NOTE_B);

  function modelWith(tabs: {id: string; entries: string[]; index?: number}[]): WorkspaceModel {
    return {
      activeHub: hubNorm,
      workspaces: {
        [hubNorm]: {
          tabs: tabs.map(t => ({
            id: t.id,
            history: {entries: t.entries, index: t.index ?? t.entries.length - 1},
          })),
          active: tabs.length > 0 ? {kind: 'tab', id: tabs[0]!.id} : {kind: 'home'},
          homeHistory: {entries: [hubNorm], index: 0},
        },
      },
    };
  }

  it('signature match returns derived tabs and mismatch null', () => {
    const legacy = [runtimeTab('t1', [noteA])];
    const model = modelWith([{id: 't1', entries: [noteA]}]);
    const result = resolveModelBackedLegacyTabStrip(model, legacy, 'signature');
    expect(result.matched).toBe(true);
    expect(result.mismatch).toBeNull();
    expect(result.derivedTabs).not.toBeNull();
    expect(result.nextTabs.map(t => t.id)).toEqual(['t1']);
    expect(result.nextTabs).toBe(result.derivedTabs);
  });

  it('signature mismatch returns legacy tabs and exact signature mismatch payload', () => {
    const legacy = [runtimeTab('t1', [noteA])];
    const model = modelWith([{id: 't1', entries: [noteA, noteB]}]);
    const result = resolveModelBackedLegacyTabStrip(model, legacy, 'signature');
    expect(result.matched).toBe(false);
    expect(result.nextTabs).toBe(legacy);
    expect(result.mismatch?.kind).toBe('signature');
    const m = result.mismatch as Extract<typeof result.mismatch, {kind: 'signature'}>;
    expect(typeof m.legacySig).toBe('string');
    expect(typeof m.derivedSig).toBe('string');
    expect(m.legacySig).not.toBe(m.derivedSig);
  });

  it('ids match returns derived tabs even when full histories differ', () => {
    const legacy = [runtimeTab('t1', [noteA]), runtimeTab('t2', [noteB])];
    const model = modelWith([
      {id: 't1', entries: [noteA, noteB]},
      {id: 't2', entries: [noteB]},
    ]);
    const result = resolveModelBackedLegacyTabStrip(model, legacy, 'ids');
    expect(result.matched).toBe(true);
    expect(result.mismatch).toBeNull();
    expect(result.nextTabs.map(t => t.id)).toEqual(['t1', 't2']);
    expect(result.nextTabs).toBe(result.derivedTabs);
  });

  it('ids mismatch returns legacy tabs and exact ids mismatch payload', () => {
    const legacy = [runtimeTab('t1', [noteA])];
    const model = modelWith([{id: 't2', entries: [noteA]}]);
    const result = resolveModelBackedLegacyTabStrip(model, legacy, 'ids');
    expect(result.matched).toBe(false);
    expect(result.nextTabs).toBe(legacy);
    expect(result.mismatch?.kind).toBe('ids');
    const m = result.mismatch as Extract<typeof result.mismatch, {kind: 'ids'}>;
    expect(m.legacyIds).toEqual(['t1']);
    expect(m.derivedIds).toEqual(['t2']);
  });

  it('missing active hub returns legacy tabs, derivedTabs null, matched false, mismatch null', () => {
    const legacy = [runtimeTab('t1', [noteA])];
    const result = resolveModelBackedLegacyTabStrip(
      {activeHub: null, workspaces: {}},
      legacy,
      'signature',
    );
    expect(result.nextTabs).toBe(legacy);
    expect(result.derivedTabs).toBeNull();
    expect(result.matched).toBe(false);
    expect(result.mismatch).toBeNull();
  });

  it('missing workspace for active hub returns legacy tabs, derivedTabs null, matched false, mismatch null', () => {
    const legacy = [runtimeTab('t1', [noteA])];
    const result = resolveModelBackedLegacyTabStrip(
      {activeHub: hubNorm, workspaces: {}},
      legacy,
      'ids',
    );
    expect(result.nextTabs).toBe(legacy);
    expect(result.derivedTabs).toBeNull();
    expect(result.matched).toBe(false);
    expect(result.mismatch).toBeNull();
  });
});

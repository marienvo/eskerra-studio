import {describe, expect, it} from 'vitest';

import {
  mergeHomeHistoryIntoHubSnapshotsForPersist,
} from '../../hooks/workspaceTodayHubDerived';
import {projectWorkspaceRuntimeToModel} from '../../hooks/workspaceRuntimeProjection';
import type {TodayHubWorkspaceSnapshot} from '../mainWindowUiStore';
import {serializeWorkspaceModelToPersistence} from '../workspaceModel';
import {
  describeWorkspacePersistenceDivergence,
  diffIsForHub,
  filterPersistenceDivergenceDiffsExcludingKnownTiming,
  isKnownPersistenceTimingDivergence,
  type RuntimePersistencePayload,
} from '../workspacePersistenceShadow';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HUB_A = '/vault/A/Today.md';
const HUB_B = '/vault/B/Today.md';
const NOTE_A = '/vault/Inbox/A.md';
const NOTE_B = '/vault/Inbox/B.md';
const NOTE_C = '/vault/Inbox/C.md';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function snap(
  tabs: Array<{id: string; uri: string}>,
  activeEditorTabId: string | null,
  homeEntries: string[] = [],
  homeIndex = 0,
): TodayHubWorkspaceSnapshot {
  return {
    editorWorkspaceTabs: tabs.map(({id, uri}) => ({id, entries: [uri], index: 0})),
    activeEditorTabId,
    homeHistory: {entries: homeEntries, index: homeIndex},
  };
}

function runtimePayload(
  activeTodayHubUri: string | null,
  workspaces: RuntimePersistencePayload['todayHubWorkspaces'],
): RuntimePersistencePayload {
  return {activeTodayHubUri, todayHubWorkspaces: workspaces};
}

function runtimeTab(id: string, uri: string) {
  return {id, history: {entries: [uri], index: 0}};
}

// ---------------------------------------------------------------------------
// Unit tests: describeWorkspacePersistenceDivergence
// ---------------------------------------------------------------------------

describe('describeWorkspacePersistenceDivergence', () => {
  it('returns empty when both payloads are identical', () => {
    const model = serializeWorkspaceModelToPersistence({
      activeHub: HUB_A,
      workspaces: {
        [HUB_A]: {
          tabs: [{id: 't1', history: {entries: [NOTE_A], index: 0}}],
          active: {kind: 'tab', id: 't1'},
          homeHistory: {entries: [HUB_A], index: 0},
        },
      },
    });
    const runtime = runtimePayload(HUB_A, {
      [HUB_A]: {
        editorWorkspaceTabs: [{id: 't1', entries: [NOTE_A], index: 0}],
        activeEditorTabId: 't1',
        homeHistory: {entries: [HUB_A], index: 0},
      },
    });
    expect(describeWorkspacePersistenceDivergence(model, runtime)).toHaveLength(0);
  });

  it('detects activeTodayHubUri mismatch', () => {
    const model = serializeWorkspaceModelToPersistence({
      activeHub: HUB_A,
      workspaces: {},
    });
    const runtime = runtimePayload(HUB_B, {});
    const diffs = describeWorkspacePersistenceDivergence(model, runtime);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toContain('activeTodayHubUri');
    expect(diffs[0]).toContain(HUB_A);
    expect(diffs[0]).toContain(HUB_B);
  });

  it('active hub with Home active: no divergence when activeEditorTabId is null both sides', () => {
    const model = serializeWorkspaceModelToPersistence({
      activeHub: HUB_A,
      workspaces: {
        [HUB_A]: {
          tabs: [{id: 't1', history: {entries: [NOTE_A], index: 0}}],
          active: {kind: 'home'},
          homeHistory: {entries: [HUB_A], index: 0},
        },
      },
    });
    const runtime = runtimePayload(HUB_A, {
      [HUB_A]: {
        editorWorkspaceTabs: [{id: 't1', entries: [NOTE_A], index: 0}],
        activeEditorTabId: null,
        homeHistory: {entries: [HUB_A], index: 0},
      },
    });
    expect(describeWorkspacePersistenceDivergence(model, runtime)).toHaveLength(0);
  });

  it('active hub with active tab: no divergence', () => {
    const model = serializeWorkspaceModelToPersistence({
      activeHub: HUB_A,
      workspaces: {
        [HUB_A]: {
          tabs: [{id: 't1', history: {entries: [NOTE_A], index: 0}}],
          active: {kind: 'tab', id: 't1'},
          homeHistory: {entries: [HUB_A], index: 0},
        },
      },
    });
    const runtime = runtimePayload(HUB_A, {
      [HUB_A]: {
        editorWorkspaceTabs: [{id: 't1', entries: [NOTE_A], index: 0}],
        activeEditorTabId: 't1',
        homeHistory: {entries: [HUB_A], index: 0},
      },
    });
    expect(describeWorkspacePersistenceDivergence(model, runtime)).toHaveLength(0);
  });

  it('multiple hubs with different tabs/history: no divergence when both match', () => {
    const model = serializeWorkspaceModelToPersistence({
      activeHub: HUB_A,
      workspaces: {
        [HUB_A]: {
          tabs: [{id: 'a1', history: {entries: [NOTE_A], index: 0}}],
          active: {kind: 'tab', id: 'a1'},
          homeHistory: {entries: [HUB_A, NOTE_B], index: 1},
        },
        [HUB_B]: {
          tabs: [{id: 'b1', history: {entries: [NOTE_B], index: 0}}],
          active: {kind: 'home'},
          homeHistory: {entries: [HUB_B], index: 0},
        },
      },
    });
    const runtime = runtimePayload(HUB_A, {
      [HUB_A]: {
        editorWorkspaceTabs: [{id: 'a1', entries: [NOTE_A], index: 0}],
        activeEditorTabId: 'a1',
        homeHistory: {entries: [HUB_A, NOTE_B], index: 1},
      },
      [HUB_B]: {
        editorWorkspaceTabs: [{id: 'b1', entries: [NOTE_B], index: 0}],
        activeEditorTabId: null,
        homeHistory: {entries: [HUB_B], index: 0},
      },
    });
    expect(describeWorkspacePersistenceDivergence(model, runtime)).toHaveLength(0);
  });

  it('detects per-hub tab divergence', () => {
    const model = serializeWorkspaceModelToPersistence({
      activeHub: HUB_A,
      workspaces: {
        [HUB_A]: {
          tabs: [{id: 't1', history: {entries: [NOTE_A], index: 0}}],
          active: {kind: 'tab', id: 't1'},
          homeHistory: {entries: [HUB_A], index: 0},
        },
      },
    });
    const runtime = runtimePayload(HUB_A, {
      [HUB_A]: {
        editorWorkspaceTabs: [{id: 't1', entries: [NOTE_B], index: 0}],
        activeEditorTabId: 't1',
        homeHistory: {entries: [HUB_A], index: 0},
      },
    });
    const diffs = describeWorkspacePersistenceDivergence(model, runtime);
    expect(diffs.some(d => d.includes('editorWorkspaceTabs') && d.includes(HUB_A))).toBe(true);
  });

  it('detects inactive hub tab divergence', () => {
    const model = serializeWorkspaceModelToPersistence({
      activeHub: HUB_A,
      workspaces: {
        [HUB_A]: {
          tabs: [],
          active: {kind: 'home'},
          homeHistory: {entries: [HUB_A], index: 0},
        },
        [HUB_B]: {
          tabs: [{id: 'b1', history: {entries: [NOTE_B], index: 0}}],
          active: {kind: 'tab', id: 'b1'},
          homeHistory: {entries: [HUB_B], index: 0},
        },
      },
    });
    const runtime = runtimePayload(HUB_A, {
      [HUB_A]: {
        editorWorkspaceTabs: [],
        activeEditorTabId: null,
        homeHistory: {entries: [HUB_A], index: 0},
      },
      [HUB_B]: {
        editorWorkspaceTabs: [{id: 'b1', entries: [NOTE_C], index: 0}],
        activeEditorTabId: 'b1',
        homeHistory: {entries: [HUB_B], index: 0},
      },
    });
    const diffs = describeWorkspacePersistenceDivergence(model, runtime);
    expect(diffs.some(d => d.includes('editorWorkspaceTabs') && d.includes(HUB_B))).toBe(true);
  });

  it('detects per-hub activeEditorTabId divergence', () => {
    const model = serializeWorkspaceModelToPersistence({
      activeHub: HUB_A,
      workspaces: {
        [HUB_A]: {
          tabs: [
            {id: 't1', history: {entries: [NOTE_A], index: 0}},
            {id: 't2', history: {entries: [NOTE_B], index: 0}},
          ],
          active: {kind: 'tab', id: 't1'},
          homeHistory: {entries: [HUB_A], index: 0},
        },
      },
    });
    const runtime = runtimePayload(HUB_A, {
      [HUB_A]: {
        editorWorkspaceTabs: [
          {id: 't1', entries: [NOTE_A], index: 0},
          {id: 't2', entries: [NOTE_B], index: 0},
        ],
        activeEditorTabId: 't2',
        homeHistory: {entries: [HUB_A], index: 0},
      },
    });
    const diffs = describeWorkspacePersistenceDivergence(model, runtime);
    expect(diffs.some(d => d.includes('activeEditorTabId') && d.includes(HUB_A))).toBe(true);
  });

  it('detects per-hub homeHistory divergence', () => {
    const model = serializeWorkspaceModelToPersistence({
      activeHub: HUB_A,
      workspaces: {
        [HUB_A]: {
          tabs: [],
          active: {kind: 'home'},
          homeHistory: {entries: [HUB_A, NOTE_A], index: 1},
        },
      },
    });
    const runtime = runtimePayload(HUB_A, {
      [HUB_A]: {
        editorWorkspaceTabs: [],
        activeEditorTabId: null,
        homeHistory: {entries: [HUB_A], index: 0},
      },
    });
    const diffs = describeWorkspacePersistenceDivergence(model, runtime);
    expect(diffs.some(d => d.includes('homeHistory') && d.includes(HUB_A))).toBe(true);
  });

  it('detects hub presence mismatch (model has hub, runtime does not)', () => {
    const model = serializeWorkspaceModelToPersistence({
      activeHub: HUB_A,
      workspaces: {
        [HUB_A]: {tabs: [], active: {kind: 'home'}, homeHistory: {entries: [HUB_A], index: 0}},
        [HUB_B]: {tabs: [], active: {kind: 'home'}, homeHistory: {entries: [HUB_B], index: 0}},
      },
    });
    const runtime = runtimePayload(HUB_A, {
      [HUB_A]: {
        editorWorkspaceTabs: [],
        activeEditorTabId: null,
        homeHistory: {entries: [HUB_A], index: 0},
      },
    });
    const diffs = describeWorkspacePersistenceDivergence(model, runtime);
    expect(diffs.some(d => d.includes('presence') && d.includes(HUB_B))).toBe(true);
  });

  it('restart-style restored snapshot: no divergence after round-trip through runtime helpers', () => {
    const hubWorkspaces: Record<string, TodayHubWorkspaceSnapshot> = {
      [HUB_A]: snap([{id: 't1', uri: NOTE_A}], 't1', [HUB_A, NOTE_B], 1),
      [HUB_B]: snap([{id: 't2', uri: NOTE_B}], null, [HUB_B], 0),
    };
    const homeStatesByHub = {
      [HUB_A]: {history: {entries: [HUB_A, NOTE_B], index: 1}},
      [HUB_B]: {history: {entries: [HUB_B], index: 0}},
    };
    const filteredWithHome = mergeHomeHistoryIntoHubSnapshotsForPersist(
      hubWorkspaces,
      homeStatesByHub,
    );

    const projectedModel = projectWorkspaceRuntimeToModel({
      activeTodayHubUri: HUB_A,
      editorWorkspaceTabs: [runtimeTab('t1', NOTE_A)],
      activeEditorTabId: 't1',
      legacyHubWorkspaceSnapshots: hubWorkspaces,
      homeStatesByHub,
      hubUris: [HUB_A, HUB_B],
    });

    const modelDerived = serializeWorkspaceModelToPersistence(projectedModel);
    const runtime = runtimePayload(HUB_A, filteredWithHome);
    expect(describeWorkspacePersistenceDivergence(modelDerived, runtime)).toHaveLength(0);
  });

  it('prune: hub removed from runtime does not appear in model after reprojection', () => {
    // Start with two hubs; then B is pruned from vault refs so only A remains
    const hubWorkspaces: Record<string, TodayHubWorkspaceSnapshot> = {
      [HUB_A]: snap([{id: 't1', uri: NOTE_A}], 't1', [HUB_A], 0),
    };
    const homeStatesByHub = {[HUB_A]: {history: {entries: [HUB_A], index: 0}}};
    const filteredWithHome = mergeHomeHistoryIntoHubSnapshotsForPersist(
      hubWorkspaces,
      homeStatesByHub,
    );

    const projectedModel = projectWorkspaceRuntimeToModel({
      activeTodayHubUri: HUB_A,
      editorWorkspaceTabs: [runtimeTab('t1', NOTE_A)],
      activeEditorTabId: 't1',
      legacyHubWorkspaceSnapshots: hubWorkspaces,
      homeStatesByHub,
      hubUris: [HUB_A], // HUB_B pruned
    });

    const modelDerived = serializeWorkspaceModelToPersistence(projectedModel);
    const runtime = runtimePayload(HUB_A, filteredWithHome);
    expect(describeWorkspacePersistenceDivergence(modelDerived, runtime)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Model-derived persistence correctness (authoritative path)
// ---------------------------------------------------------------------------

describe('model-derived persistence correctness', () => {
  it('includes inactive workspace tabs after a hub switch', () => {
    // HUB_A is active with live runtime tabs.
    // HUB_B is inactive; its tabs survive only via the frozen snapshot.
    const hubWorkspaces: Record<string, TodayHubWorkspaceSnapshot> = {
      [HUB_A]: snap([{id: 'a1', uri: NOTE_A}], 'a1', [HUB_A], 0),
      [HUB_B]: snap([{id: 'b1', uri: NOTE_B}, {id: 'b2', uri: NOTE_C}], 'b1', [HUB_B], 0),
    };

    const model = projectWorkspaceRuntimeToModel({
      activeTodayHubUri: HUB_A,
      editorWorkspaceTabs: [runtimeTab('a1', NOTE_A)],
      activeEditorTabId: 'a1',
      legacyHubWorkspaceSnapshots: hubWorkspaces,
      homeStatesByHub: {
        [HUB_A]: {history: {entries: [HUB_A], index: 0}},
        [HUB_B]: {history: {entries: [HUB_B], index: 0}},
      },
      hubUris: [HUB_A, HUB_B],
    });

    const derived = serializeWorkspaceModelToPersistence(model);

    expect(derived.todayHubWorkspaces[HUB_B]?.editorWorkspaceTabs.map(t => t.id)).toEqual([
      'b1',
      'b2',
    ]);
    expect(derived.todayHubWorkspaces[HUB_B]?.activeEditorTabId).toBe('b1');
  });

  it('includes active workspace tabs immediately after tab mutations (no microtask lag)', () => {
    // The legacy hub snapshot map is stale for the active hub —
    // simulating the microtask lag window where the snapshot has not yet been updated.
    const staleSnapshot: Record<string, TodayHubWorkspaceSnapshot> = {
      [HUB_A]: snap([{id: 'old-tab', uri: NOTE_A}], 'old-tab', [HUB_A], 0),
    };

    const model = projectWorkspaceRuntimeToModel({
      activeTodayHubUri: HUB_A,
      editorWorkspaceTabs: [runtimeTab('new-tab', NOTE_B)], // current, ahead of snapshot
      activeEditorTabId: 'new-tab',
      legacyHubWorkspaceSnapshots: staleSnapshot, // stale
      homeStatesByHub: {},
      hubUris: [HUB_A],
    });

    const derived = serializeWorkspaceModelToPersistence(model);

    expect(derived.todayHubWorkspaces[HUB_A]?.editorWorkspaceTabs).toHaveLength(1);
    expect(derived.todayHubWorkspaces[HUB_A]?.editorWorkspaceTabs[0]?.id).toBe('new-tab');
    expect(derived.todayHubWorkspaces[HUB_A]?.activeEditorTabId).toBe('new-tab');
  });

  it('includes homeHistory for all hubs including inactive ones', () => {
    const hubWorkspaces: Record<string, TodayHubWorkspaceSnapshot> = {
      [HUB_A]: snap([], null, [HUB_A], 0),
      [HUB_B]: snap([], null, [HUB_B], 0),
    };

    const model = projectWorkspaceRuntimeToModel({
      activeTodayHubUri: HUB_A,
      editorWorkspaceTabs: [],
      activeEditorTabId: null,
      legacyHubWorkspaceSnapshots: hubWorkspaces,
      homeStatesByHub: {
        [HUB_A]: {history: {entries: [HUB_A, NOTE_A], index: 1}},
        [HUB_B]: {history: {entries: [HUB_B, NOTE_B, NOTE_C], index: 2}},
      },
      hubUris: [HUB_A, HUB_B],
    });

    const derived = serializeWorkspaceModelToPersistence(model);

    expect(derived.todayHubWorkspaces[HUB_A]?.homeHistory).toEqual({
      entries: [HUB_A, NOTE_A],
      index: 1,
    });
    expect(derived.todayHubWorkspaces[HUB_B]?.homeHistory).toEqual({
      entries: [HUB_B, NOTE_B, NOTE_C],
      index: 2,
    });
  });

  it('legacy runtime snapshot lag does not affect model-derived persistence payload', () => {
    // Even when the legacy runtime snapshot for the active hub is stale,
    // the model-derived payload reflects the current editorWorkspaceTabs.
    const staleSnapshot: Record<string, TodayHubWorkspaceSnapshot> = {
      [HUB_A]: snap([{id: 'tab-old', uri: NOTE_A}], 'tab-old', [HUB_A], 0),
    };

    const model = projectWorkspaceRuntimeToModel({
      activeTodayHubUri: HUB_A,
      editorWorkspaceTabs: [
        runtimeTab('tab-new-1', NOTE_B),
        runtimeTab('tab-new-2', NOTE_C),
      ],
      activeEditorTabId: 'tab-new-2',
      legacyHubWorkspaceSnapshots: staleSnapshot,
      homeStatesByHub: {[HUB_A]: {history: {entries: [HUB_A], index: 0}}},
      hubUris: [HUB_A],
    });

    const derived = serializeWorkspaceModelToPersistence(model);

    // Model-derived has the current tabs, not the stale snapshot
    expect(derived.todayHubWorkspaces[HUB_A]?.editorWorkspaceTabs.map(t => t.id)).toEqual([
      'tab-new-1',
      'tab-new-2',
    ]);
    expect(derived.todayHubWorkspaces[HUB_A]?.activeEditorTabId).toBe('tab-new-2');
  });
});

// ---------------------------------------------------------------------------
// Integration: full sequence – open tabs, switch hubs, Home nav, reorder, restart restore
// ---------------------------------------------------------------------------

describe('workspacePersistenceShadow integration', () => {
  it('model-derived and runtime persistence match after a realistic multi-step sequence', () => {
    // Step 1: initial state – HUB_A active, one tab open
    let hubWorkspaces: Record<string, TodayHubWorkspaceSnapshot> = {
      [HUB_A]: snap([{id: 't1', uri: NOTE_A}], 't1', [HUB_A], 0),
      [HUB_B]: snap([], null, [HUB_B], 0),
    };
    let homeStatesByHub = {
      [HUB_A]: {history: {entries: [HUB_A], index: 0}},
      [HUB_B]: {history: {entries: [HUB_B], index: 0}},
    };

    // Step 2: open a second tab on HUB_A
    hubWorkspaces = {
      ...hubWorkspaces,
      [HUB_A]: snap([{id: 't1', uri: NOTE_A}, {id: 't2', uri: NOTE_B}], 't2', [HUB_A], 0),
    };

    // Step 3: switch to HUB_B – HUB_A snapshot is frozen, HUB_B becomes active
    const runtimeTabsB = [runtimeTab('b1', NOTE_C)];
    hubWorkspaces = {
      ...hubWorkspaces,
      [HUB_B]: snap([{id: 'b1', uri: NOTE_C}], 'b1', [HUB_B], 0),
    };

    // Step 4: Home navigation on HUB_B
    homeStatesByHub = {
      ...homeStatesByHub,
      [HUB_B]: {history: {entries: [HUB_B, NOTE_A], index: 1}},
    };

    // Step 5: reorder HUB_A tabs (t2 first, t1 second) – mutate the snapshot
    hubWorkspaces = {
      ...hubWorkspaces,
      [HUB_A]: snap([{id: 't2', uri: NOTE_B}, {id: 't1', uri: NOTE_A}], 't2', [HUB_A], 0),
    };

    // Build runtime persistence payload (as mergeHomeHistoryIntoHubSnapshotsForPersist would produce)
    const filteredWithHome = mergeHomeHistoryIntoHubSnapshotsForPersist(
      hubWorkspaces,
      homeStatesByHub,
    );

    // Build projected model (HUB_B is active with runtimeTabsB)
    const projectedModel = projectWorkspaceRuntimeToModel({
      activeTodayHubUri: HUB_B,
      editorWorkspaceTabs: runtimeTabsB,
      activeEditorTabId: 'b1',
      legacyHubWorkspaceSnapshots: hubWorkspaces,
      homeStatesByHub,
      hubUris: [HUB_A, HUB_B],
    });

    const modelDerived = serializeWorkspaceModelToPersistence(projectedModel);
    const runtime = runtimePayload(HUB_B, filteredWithHome);
    const diffs = describeWorkspacePersistenceDivergence(modelDerived, runtime);
    expect(diffs).toHaveLength(0);
  });

  it('restart-restore sequence: parse → reproject → serialize matches runtime payload', () => {
    // Simulate what happens on app restart: persisted data is rehydrated, then
    // the hook projects runtime state. After projection, model-derived persistence
    // must equal what would be saved from the runtime snapshot path.

    const persistedHubWorkspaces: Record<string, TodayHubWorkspaceSnapshot> = {
      [HUB_A]: snap(
        [{id: 't1', uri: NOTE_A}, {id: 't2', uri: NOTE_B}],
        't1',
        [HUB_A, NOTE_C],
        1,
      ),
      [HUB_B]: snap([{id: 'b1', uri: NOTE_B}], null, [HUB_B], 0),
    };
    const restoredHomeStates = {
      [HUB_A]: {history: {entries: [HUB_A, NOTE_C], index: 1}},
      [HUB_B]: {history: {entries: [HUB_B], index: 0}},
    };
    // After restore, runtime tabs for the active hub come from the persisted snapshot
    const restoredRuntimeTabs = persistedHubWorkspaces[HUB_A]!.editorWorkspaceTabs.map(t => ({
      id: t.id,
      history: {entries: t.entries, index: t.index},
    }));

    const filteredWithHome = mergeHomeHistoryIntoHubSnapshotsForPersist(
      persistedHubWorkspaces,
      restoredHomeStates,
    );

    const projectedModel = projectWorkspaceRuntimeToModel({
      activeTodayHubUri: HUB_A,
      editorWorkspaceTabs: restoredRuntimeTabs,
      activeEditorTabId: 't1',
      legacyHubWorkspaceSnapshots: persistedHubWorkspaces,
      homeStatesByHub: restoredHomeStates,
      hubUris: [HUB_A, HUB_B],
    });

    const modelDerived = serializeWorkspaceModelToPersistence(projectedModel);
    const runtime = runtimePayload(HUB_A, filteredWithHome);
    expect(describeWorkspacePersistenceDivergence(modelDerived, runtime)).toHaveLength(0);
  });
});

describe('isKnownPersistenceTimingDivergence', () => {
  const keys = (xs: string[]) => new Set(xs);

  it('treats pending projection hub presence mismatch as known timing noise', () => {
    expect(
      isKnownPersistenceTimingDivergence({
        diff: 'hub /vault/X.md presence model=no runtime=yes',
        activeHub: '/vault/X.md',
        runtimeActiveHub: null,
        projectionActiveHub: null,
        restoredActiveHub: null,
        modelHubKeys: keys([]),
        legacyHubKeys: keys([]),
        hasPendingProjectionHubs: true,
      }),
    ).toBe(true);
  });

  it('treats empty legacy keys with model-only hub presence as known', () => {
    expect(
      isKnownPersistenceTimingDivergence({
        diff: 'hub /vault/A.md presence model=yes runtime=no',
        activeHub: '/vault/A.md',
        runtimeActiveHub: '/vault/A.md',
        projectionActiveHub: '/vault/A.md',
        restoredActiveHub: null,
        modelHubKeys: keys(['/vault/A.md']),
        legacyHubKeys: keys([]),
        hasPendingProjectionHubs: false,
      }),
    ).toBe(true);
  });

  it('treats active-hub presence mismatch as known when diff targets active hub', () => {
    expect(
      isKnownPersistenceTimingDivergence({
        diff: 'hub /vault/A.md presence model=yes runtime=no',
        activeHub: '/vault/A.md',
        runtimeActiveHub: '/vault/A.md',
        projectionActiveHub: '/vault/A.md',
        restoredActiveHub: null,
        modelHubKeys: keys(['/vault/A.md']),
        legacyHubKeys: keys(['/vault/A.md']),
        hasPendingProjectionHubs: false,
      }),
    ).toBe(true);
  });

  it('treats activeTodayHubUri row when projection or runtime hub unset as known', () => {
    expect(
      isKnownPersistenceTimingDivergence({
        diff: 'activeTodayHubUri model=/a runtime=/b',
        activeHub: '/a',
        runtimeActiveHub: null,
        projectionActiveHub: '/x',
        restoredActiveHub: null,
        modelHubKeys: keys([]),
        legacyHubKeys: keys([]),
        hasPendingProjectionHubs: false,
      }),
    ).toBe(true);
  });

  it('treats tab timing diff as known when hub exists in both model and legacy', () => {
    expect(
      isKnownPersistenceTimingDivergence({
        diff: 'hub /vault/A.md editorWorkspaceTabs model=[] runtime=[]',
        activeHub: '/vault/A.md',
        runtimeActiveHub: '/vault/A.md',
        projectionActiveHub: '/vault/A.md',
        restoredActiveHub: null,
        modelHubKeys: keys(['/vault/A.md']),
        legacyHubKeys: keys(['/vault/A.md']),
        hasPendingProjectionHubs: false,
      }),
    ).toBe(true);
  });

  it('does not suppress tab timing diff when hub is missing from legacy keys', () => {
    expect(
      isKnownPersistenceTimingDivergence({
        diff: 'hub /vault/A.md editorWorkspaceTabs model=[] runtime=[]',
        activeHub: '/vault/A.md',
        runtimeActiveHub: '/vault/A.md',
        projectionActiveHub: '/vault/A.md',
        restoredActiveHub: null,
        modelHubKeys: keys(['/vault/A.md']),
        legacyHubKeys: keys([]),
        hasPendingProjectionHubs: false,
      }),
    ).toBe(false);
  });
});

describe('diffIsForHub', () => {
  it('matches hub-prefixed divergence lines', () => {
    expect(diffIsForHub('hub /x.md foo', '/x.md')).toBe(true);
    expect(diffIsForHub('activeTodayHubUri model=a runtime=b', '/x.md')).toBe(false);
  });
});

describe('filterPersistenceDivergenceDiffsExcludingKnownTiming', () => {
  it('removes diffs classified as known timing noise', () => {
    const out = filterPersistenceDivergenceDiffsExcludingKnownTiming(
      ['hub /a presence model=no runtime=yes', 'hub /a editorWorkspaceTabs model=x runtime=y'],
      {
        activeHub: '/a',
        runtimeActiveHub: '/a',
        projectionActiveHub: '/a',
        restoredActiveHub: null,
        modelHubKeys: new Set(['/a']),
        legacyHubKeys: new Set(['/a']),
        hasPendingProjectionHubs: true,
      },
    );
    expect(out).toEqual([]);
  });
});

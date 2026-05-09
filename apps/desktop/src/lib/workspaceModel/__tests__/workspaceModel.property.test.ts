import fc from 'fast-check';
import {describe, expect, it} from 'vitest';
import {
  activateTabAction,
  activateWorkspaceSelectorAction,
  closeAllTabsAction,
  closeOtherTabsAction,
  closeTabAction,
  ensureWorkspaceForHubsAction,
  goBackAction,
  goForwardAction,
  openTabBackgroundAction,
  openTabForegroundAction,
  parseWorkspaceModelFromPersistence,
  pushHomeNavigationAction,
  pushTabNavigationAction,
  remapPrefixAction,
  removeUrisAction,
  reorderTabsAction,
  selectWorkspaceAction,
  serializeWorkspaceModelToPersistence,
  sortedNormalizedHubs,
  validateWorkspaceModel,
} from '../index';
import type {HistoryStack, TabEntry, WorkspaceModel, WorkspaceState} from '../types';
import {normalizeWorkspaceUri} from '../types';

/** Small remap pairs; all generated hub/note paths live under `/v/`. */
const REMAP_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['/v', '/vR'],
  ['/v/w0', '/v/m0'],
  ['/v/n', '/v/N'],
];

type PropContext = {
  readonly initialHubs: readonly string[];
  readonly initialNotes: readonly string[];
};

type WorkspacePropAction =
  | {t: 'selectWorkspace'; hubIdx: number}
  | {t: 'ensureWorkspaceForHubs'; mask: number}
  | {t: 'activateWorkspaceSelector'}
  | {t: 'activateTab'; tabIdx: number}
  | {t: 'pushHomeNavigation'; noteIdx: number}
  | {t: 'pushTabNavigation'; noteIdx: number}
  | {t: 'goBack'}
  | {t: 'goForward'}
  | {t: 'openTabForeground'; noteIdx: number; explicitId: boolean; salt: number}
  | {t: 'openTabBackground'; noteIdx: number; explicitId: boolean; salt: number}
  | {t: 'closeTab'; tabIdx: number}
  | {t: 'closeOtherTabs'; keepIdx: number}
  | {t: 'closeAllTabs'}
  | {t: 'reorderTabs'; fromIdx: number; beforeIdx: number}
  | {t: 'remapPrefix'; pairIdx: number}
  | {t: 'removeUris'; targetMask: number};

type SurfaceNavAction = Extract<
  WorkspacePropAction,
  | {t: 'selectWorkspace'}
  | {t: 'ensureWorkspaceForHubs'}
  | {t: 'activateWorkspaceSelector'}
  | {t: 'activateTab'}
  | {t: 'pushHomeNavigation'}
  | {t: 'pushTabNavigation'}
  | {t: 'goBack'}
  | {t: 'goForward'}
>;

type TabMutationAction = Extract<
  WorkspacePropAction,
  | {t: 'openTabForeground'}
  | {t: 'openTabBackground'}
  | {t: 'closeTab'}
  | {t: 'closeOtherTabs'}
  | {t: 'closeAllTabs'}
  | {t: 'reorderTabs'}
>;

type ExternalWorkspaceAction = Extract<
  WorkspacePropAction,
  {t: 'remapPrefix'} | {t: 'removeUris'}
>;

function assertValid(m: WorkspaceModel, label: string): void {
  const issues = validateWorkspaceModel(m);
  expect(issues, label).toEqual([]);
}

function sortedWorkspaceHubKeys(m: WorkspaceModel): string[] {
  return sortedNormalizedHubs(Object.keys(m.workspaces));
}

function arbHistoryStack(root: string, notes: readonly string[]): fc.Arbitrary<HistoryStack> {
  const maxNote = Math.max(0, notes.length - 1);
  return fc
    .array(fc.integer({min: 0, max: maxNote}), {maxLength: 5})
    .chain(extraNoteIdxs => {
      const extras = extraNoteIdxs.map(i => notes[i]!);
      const entries = [root, ...extras];
      return fc.integer({min: 0, max: entries.length - 1}).map(index => ({
        entries,
        index,
      }));
    });
}

function arbTabEntry(tabIndex: number, notes: readonly string[]): fc.Arbitrary<TabEntry> {
  const maxNote = Math.max(0, notes.length - 1);
  return fc
    .array(fc.integer({min: 0, max: maxNote}), {minLength: 1, maxLength: 4})
    .chain(noteIdxs => {
      const entries = noteIdxs.map(i => notes[i]!);
      return fc.integer({min: 0, max: entries.length - 1}).map(index => ({
        id: `t${tabIndex}`,
        history: {entries, index},
      }));
    });
}

function arbWorkspaceState(hub: string, hubIndex: number, notes: readonly string[]): fc.Arbitrary<WorkspaceState> {
  return fc.integer({min: 0, max: 5}).chain((nTabs): fc.Arbitrary<WorkspaceState> => {
    const homeArb = arbHistoryStack(hub, notes);
    if (nTabs === 0) {
      return homeArb.map(
        (homeHistory): WorkspaceState => ({
          tabs: [],
          homeHistory,
          active: {kind: 'home'},
        }),
      );
    }
    const tabArbs = Array.from({length: nTabs}, (_, ti) => arbTabEntry(hubIndex * 10 + ti, notes));
    return fc
      .tuple(homeArb, fc.tuple(...tabArbs), fc.boolean(), fc.integer({min: 0, max: nTabs - 1}))
      .map(([homeHistory, tabs, useHome, tabIdx]): WorkspaceState => ({
        tabs,
        homeHistory,
        active: useHome ? {kind: 'home'} : {kind: 'tab', id: tabs[tabIdx]!.id},
      }));
  });
}

function arbValidWorkspaceSeed(): fc.Arbitrary<{
  initialHubs: string[];
  initialNotes: string[];
  model: WorkspaceModel;
}> {
  return fc.tuple(fc.integer({min: 2, max: 4}), fc.integer({min: 3, max: 8})).chain(([hubCount, noteCount]) => {
    const initialHubs = Array.from({length: hubCount}, (_, i) =>
      normalizeWorkspaceUri(`/v/w${i}/Today.md`),
    );
    const initialNotes = Array.from({length: noteCount}, (_, i) =>
      normalizeWorkspaceUri(`/v/n${i}.md`),
    );
    return fc
      .tuple(...initialHubs.map((h, i) => arbWorkspaceState(h, i, initialNotes)))
      .map(states => {
        const workspaces: Record<string, WorkspaceState> = {};
        for (let i = 0; i < initialHubs.length; i++) {
          workspaces[initialHubs[i]!] = states[i]!;
        }
        return {
          initialHubs,
          initialNotes,
          model: {activeHub: initialHubs[0]!, workspaces},
        };
      });
  });
}

function arbWorkspacePropAction(): fc.Arbitrary<WorkspacePropAction> {
  return fc.oneof(
    fc.record({t: fc.constant('selectWorkspace' as const), hubIdx: fc.nat()}),
    fc.record({t: fc.constant('ensureWorkspaceForHubs' as const), mask: fc.integer({min: 0, max: 0xff})}),
    fc.record({t: fc.constant('activateWorkspaceSelector' as const)}),
    fc.record({t: fc.constant('activateTab' as const), tabIdx: fc.nat()}),
    fc.record({t: fc.constant('pushHomeNavigation' as const), noteIdx: fc.nat()}),
    fc.record({t: fc.constant('pushTabNavigation' as const), noteIdx: fc.nat()}),
    fc.record({t: fc.constant('goBack' as const)}),
    fc.record({t: fc.constant('goForward' as const)}),
    fc.record({
      t: fc.constant('openTabForeground' as const),
      noteIdx: fc.nat(),
      explicitId: fc.boolean(),
      salt: fc.integer({min: 0, max: 0xffff}),
    }),
    fc.record({
      t: fc.constant('openTabBackground' as const),
      noteIdx: fc.nat(),
      explicitId: fc.boolean(),
      salt: fc.integer({min: 0, max: 0xffff}),
    }),
    fc.record({t: fc.constant('closeTab' as const), tabIdx: fc.nat()}),
    fc.record({t: fc.constant('closeOtherTabs' as const), keepIdx: fc.nat()}),
    fc.record({t: fc.constant('closeAllTabs' as const)}),
    fc.record({
      t: fc.constant('reorderTabs' as const),
      fromIdx: fc.nat(),
      beforeIdx: fc.nat(),
    }),
    fc.record({t: fc.constant('remapPrefix' as const), pairIdx: fc.nat()}),
    fc.record({t: fc.constant('removeUris' as const), targetMask: fc.integer({min: 0, max: 0xfff})}),
  ) as fc.Arbitrary<WorkspacePropAction>;
}

function activeWorkspaceTabs(m: WorkspaceModel): readonly TabEntry[] {
  const ws = m.activeHub != null ? m.workspaces[m.activeHub] : undefined;
  return ws?.tabs ?? [];
}

function applySurfaceNavAction(m: WorkspaceModel, a: SurfaceNavAction, ctx: PropContext): WorkspaceModel {
  const hubs = sortedWorkspaceHubKeys(m);
  const notes = ctx.initialNotes;

  switch (a.t) {
    case 'selectWorkspace': {
      if (hubs.length === 0) {
        return m;
      }
      return selectWorkspaceAction(m, hubs[a.hubIdx % hubs.length]!);
    }
    case 'ensureWorkspaceForHubs': {
      const listed = ctx.initialHubs.filter((_, i) => (a.mask >> i) & 1);
      const toPass = listed.length > 0 ? listed : [...ctx.initialHubs];
      return ensureWorkspaceForHubsAction(m, toPass);
    }
    case 'activateWorkspaceSelector':
      return activateWorkspaceSelectorAction(m);
    case 'activateTab': {
      const tabs = activeWorkspaceTabs(m);
      if (tabs.length === 0) {
        return m;
      }
      return activateTabAction(m, tabs[a.tabIdx % tabs.length]!.id);
    }
    case 'pushHomeNavigation':
      return pushHomeNavigationAction(m, notes[a.noteIdx % (notes.length || 1)]!);
    case 'pushTabNavigation':
      return pushTabNavigationAction(m, notes[a.noteIdx % (notes.length || 1)]!);
    case 'goBack':
      return goBackAction(m);
    case 'goForward':
      return goForwardAction(m);
  }
}

function applyTabMutationAction(
  m: WorkspaceModel,
  a: TabMutationAction,
  step: number,
  ctx: PropContext,
): WorkspaceModel {
  const notes = ctx.initialNotes;
  const tabs = activeWorkspaceTabs(m);

  switch (a.t) {
    case 'openTabForeground': {
      const uri = notes[a.noteIdx % (notes.length || 1)]!;
      const opts = a.explicitId ? {tabId: `fg-${a.salt}-${step}`} : undefined;
      return openTabForegroundAction(m, uri, opts);
    }
    case 'openTabBackground': {
      const uri = notes[a.noteIdx % (notes.length || 1)]!;
      const opts = a.explicitId ? {tabId: `bg-${a.salt}-${step}`} : undefined;
      return openTabBackgroundAction(m, uri, opts);
    }
    case 'closeTab': {
      if (tabs.length === 0) {
        return m;
      }
      return closeTabAction(m, tabs[a.tabIdx % tabs.length]!.id);
    }
    case 'closeOtherTabs': {
      if (tabs.length === 0) {
        return m;
      }
      return closeOtherTabsAction(m, tabs[a.keepIdx % tabs.length]!.id);
    }
    case 'closeAllTabs':
      return closeAllTabsAction(m);
    case 'reorderTabs': {
      const len = tabs.length;
      if (len === 0) {
        return m;
      }
      return reorderTabsAction(m, a.fromIdx % len, a.beforeIdx % (len + 1));
    }
  }
}

function applyExternalAction(m: WorkspaceModel, a: ExternalWorkspaceAction, ctx: PropContext): WorkspaceModel {
  switch (a.t) {
    case 'remapPrefix': {
      const [oldP, newP] = REMAP_PAIRS[a.pairIdx % REMAP_PAIRS.length]!;
      return remapPrefixAction(m, oldP, newP);
    }
    case 'removeUris': {
      const targets: string[] = [...ctx.initialHubs, ...ctx.initialNotes];
      const removeSet = new Set<string>();
      for (let i = 0; i < targets.length; i++) {
        if ((a.targetMask >> i) & 1) {
          removeSet.add(normalizeWorkspaceUri(targets[i]!));
        }
      }
      if (removeSet.size === 0) {
        return m;
      }
      return removeUrisAction(m, u => removeSet.has(normalizeWorkspaceUri(u)));
    }
  }
}

function applyWorkspacePropAction(
  m: WorkspaceModel,
  a: WorkspacePropAction,
  step: number,
  ctx: PropContext,
): WorkspaceModel {
  switch (a.t) {
    case 'remapPrefix':
    case 'removeUris':
      return applyExternalAction(m, a, ctx);
    case 'openTabForeground':
    case 'openTabBackground':
    case 'closeTab':
    case 'closeOtherTabs':
    case 'closeAllTabs':
    case 'reorderTabs':
      return applyTabMutationAction(m, a, step, ctx);
    default:
      return applySurfaceNavAction(m, a, ctx);
  }
}

describe('workspaceModel property tests', () => {
  it('random action sequences preserve invariants (max 30 steps)', () => {
    fc.assert(
      fc.property(
        arbValidWorkspaceSeed(),
        fc.array(arbWorkspacePropAction(), {maxLength: 30}),
        (seed, actions) => {
          let m = seed.model;
          assertValid(m, 'initial model');
          const ctx: PropContext = {initialHubs: seed.initialHubs, initialNotes: seed.initialNotes};
          for (let step = 0; step < actions.length; step++) {
            m = applyWorkspacePropAction(m, actions[step]!, step, ctx);
            assertValid(m, `after step ${step} (${JSON.stringify(actions[step])})`);
          }
        },
      ),
      {numRuns: 80},
    );
  });

  it('serialize → parse preserves invariants for generated valid models', () => {
    fc.assert(
      fc.property(arbValidWorkspaceSeed(), seed => {
        const blob = serializeWorkspaceModelToPersistence(seed.model);
        const hubUris = sortedNormalizedHubs(Object.keys(seed.model.workspaces));
        const restored = parseWorkspaceModelFromPersistence({
          hubUris,
          activeTodayHubUri: blob.activeTodayHubUri,
          todayHubWorkspaces: blob.todayHubWorkspaces,
        });
        assertValid(restored, 'after serialize → parse');
      }),
      {numRuns: 120},
    );
  });
});

import {act, renderHook} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';

import type {TodayHubWorkspaceSnapshot} from '../lib/mainWindowUiStore';
import type {WorkspaceHomeState} from '../lib/workspaceHomeNavigation';
import {tabsToStored, type EditorWorkspaceTab} from '../lib/editorWorkspaceTabs';
import {useWorkspaceTodayHubSwitch, type UseWorkspaceTodayHubSwitchArgs} from './workspaceTodayHubSwitch';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const HUB_A = '/vault/A/Today.md';
const HUB_B = '/vault/B/Today.md';
const NOT_A_HUB = '/vault/Inbox/Note.md';

type StubWorkspaces = Record<string, TodayHubWorkspaceSnapshot>;

function createMutatingWorkspaceSetter(hubWorkspaces: StubWorkspaces) {
  return vi.fn(
    (
      updaterOrValue:
        | StubWorkspaces
        | ((prev: StubWorkspaces) => StubWorkspaces),
    ) => {
      const next =
        typeof updaterOrValue === 'function'
          ? updaterOrValue({...hubWorkspaces})
          : updaterOrValue;
      for (const k of Object.keys(hubWorkspaces)) {
        delete hubWorkspaces[k];
      }
      Object.assign(hubWorkspaces, next);
    },
  );
}

/**
 * Build a full args object for the hook. Every option can be overridden; defaults are
 * reasonable stubs for tests that don't care about a specific field.
 */
function makeArgs(overrides: {
  activeTodayHubUri?: string | null;
  vaultMarkdownRefs?: {name: string; uri: string}[];
  composingNewEntry?: boolean;
  editorWorkspaceTabs?: {id: string; entries: string[]; index: number}[];
  activeEditorTabId?: string | null;
  hubWorkspaces?: StubWorkspaces;
  selectNote?: ReturnType<typeof vi.fn>;
  selectHomeCurrentNote?: ReturnType<typeof vi.fn>;
  activateWorkspaceHomeSelector?: ReturnType<typeof vi.fn>;
  activateOpenTab?: ReturnType<typeof vi.fn>;
  setActiveTodayHubUri?: ReturnType<typeof vi.fn>;
  setEditorWorkspaceTabs?: ReturnType<typeof vi.fn>;
  setActiveEditorTabId?: ReturnType<typeof vi.fn>;
  setTodayHubWorkspacesForSave?: ReturnType<typeof vi.fn>;
  /** Initial `homeStatesByHubRef.current` for outgoing hub snapshot tests. */
  homeStatesByHubSeed?: Record<string, WorkspaceHomeState>;
}): {
  args: UseWorkspaceTodayHubSwitchArgs;
  mocks: {
    selectNote: ReturnType<typeof vi.fn>;
    selectHomeCurrentNote: ReturnType<typeof vi.fn>;
    activateWorkspaceHomeSelector: ReturnType<typeof vi.fn>;
    activateOpenTab: ReturnType<typeof vi.fn>;
    setActiveTodayHubUri: ReturnType<typeof vi.fn>;
    setEditorWorkspaceTabs: ReturnType<typeof vi.fn>;
    setActiveEditorTabId: ReturnType<typeof vi.fn>;
    setComposingNewEntry: ReturnType<typeof vi.fn>;
    setEditorBody: ReturnType<typeof vi.fn>;
    setInboxEditorResetNonce: ReturnType<typeof vi.fn>;
    setTodayHubWorkspacesForSave: ReturnType<typeof vi.fn>;
  };
  hubWorkspaces: StubWorkspaces;
} {
  const hubWorkspaces: StubWorkspaces =
    overrides.hubWorkspaces !== undefined ? overrides.hubWorkspaces : {};

  const selectNote = overrides.selectNote ?? vi.fn();
  const selectHomeCurrentNote = overrides.selectHomeCurrentNote ?? vi.fn();
  const activateWorkspaceHomeSelector =
    overrides.activateWorkspaceHomeSelector ?? vi.fn();
  const activateOpenTab = overrides.activateOpenTab ?? vi.fn();
  const setActiveTodayHubUri = overrides.setActiveTodayHubUri ?? vi.fn();
  const setEditorWorkspaceTabs = overrides.setEditorWorkspaceTabs ?? vi.fn();
  const setActiveEditorTabId = overrides.setActiveEditorTabId ?? vi.fn();
  const setComposingNewEntry = vi.fn();
  const setEditorBody = vi.fn();
  const setInboxEditorResetNonce = vi.fn();

  const setTodayHubWorkspacesForSave =
    overrides.setTodayHubWorkspacesForSave ?? createMutatingWorkspaceSetter(hubWorkspaces);

  const args: UseWorkspaceTodayHubSwitchArgs = {
    state: {todayHubWorkspacesForSave: hubWorkspaces},
    refs: {
      vaultMarkdownRefsRef: {current: overrides.vaultMarkdownRefs ?? [{name: 'Today', uri: HUB_A}, {name: 'Today', uri: HUB_B}]},
      activeTodayHubUriRef: {current: overrides.activeTodayHubUri !== undefined ? overrides.activeTodayHubUri : HUB_A},
      flushInboxSaveRef: {current: vi.fn().mockResolvedValue(undefined)},
      composingNewEntryRef: {current: overrides.composingNewEntry ?? false},
      inboxYamlFrontmatterInnerRef: {current: null},
      inboxEditorYamlLeadingBeforeFrontmatterRef: {current: ''},
      editorWorkspaceTabsRef: {current: (overrides.editorWorkspaceTabs ?? []).map(s => ({
        id: s.id,
        history: {entries: s.entries, index: s.index},
      }))},
      activeEditorTabIdRef: {current: overrides.activeEditorTabId ?? null},
      homeStatesByHubRef: {current: {...(overrides.homeStatesByHubSeed ?? {})}},
    },
    setters: {
      setComposingNewEntry,
      setInboxYamlFrontmatterInner: vi.fn(),
      setInboxEditorYamlLeadingBeforeFrontmatter: vi.fn(),
      setEditorBody,
      setInboxEditorResetNonce,
      setTodayHubWorkspacesForSave,
      setEditorWorkspaceTabs,
      setActiveEditorTabId,
      setActiveTodayHubUri,
    },
    callbacks: {
      selectNote,
      selectHomeCurrentNote,
      activateOpenTab,
      activateWorkspaceHomeSelector,
    },
  };

  return {
    args,
    hubWorkspaces,
    mocks: {
      selectNote,
      selectHomeCurrentNote,
      activateWorkspaceHomeSelector,
      activateOpenTab,
      setActiveTodayHubUri,
      setEditorWorkspaceTabs,
      setActiveEditorTabId,
      setComposingNewEntry,
      setEditorBody,
      setInboxEditorResetNonce,
      setTodayHubWorkspacesForSave,
    },
  };
}

// ---------------------------------------------------------------------------
// switchTodayHubWorkspace
// ---------------------------------------------------------------------------

describe('switchTodayHubWorkspace', () => {
  it('no-op for unknown URI: does not set active hub or call selectNote', async () => {
    const {args, mocks} = makeArgs({});
    const {result} = renderHook(() => useWorkspaceTodayHubSwitch(args));

    await act(async () => {
      await result.current.switchTodayHubWorkspace(NOT_A_HUB);
    });

    expect(mocks.setActiveTodayHubUri).not.toHaveBeenCalled();
    expect(mocks.selectNote).not.toHaveBeenCalled();
  });

  it('same-hub re-select: only calls selectNote(norm), no setters', async () => {
    // activeTodayHubUriRef already points to HUB_A
    const {args, mocks} = makeArgs({activeTodayHubUri: HUB_A});
    const {result} = renderHook(() => useWorkspaceTodayHubSwitch(args));

    await act(async () => {
      await result.current.switchTodayHubWorkspace(HUB_A);
    });

    expect(mocks.selectNote).toHaveBeenCalledOnce();
    expect(mocks.selectNote).toHaveBeenCalledWith(HUB_A);
    expect(mocks.setActiveTodayHubUri).not.toHaveBeenCalled();
    expect(mocks.setEditorWorkspaceTabs).not.toHaveBeenCalled();
  });

  it('compose-mode reset: clears compose state before snapshotting tabs', async () => {
    const {args, mocks} = makeArgs({
      activeTodayHubUri: HUB_A,
      composingNewEntry: true,
    });
    const {result} = renderHook(() => useWorkspaceTodayHubSwitch(args));

    await act(async () => {
      await result.current.switchTodayHubWorkspace(HUB_B);
    });

    expect(mocks.setComposingNewEntry).toHaveBeenCalledWith(false);
    expect(mocks.setEditorBody).toHaveBeenCalledWith('');
    expect(mocks.setInboxEditorResetNonce).toHaveBeenCalledOnce();
    // Switch should still complete and activate hub B.
    expect(mocks.setActiveTodayHubUri).toHaveBeenCalledWith(HUB_B);
  });

  it('snapshots outgoing hub homeHistory from homeStatesByHubRef when switching hubs', async () => {
    const NOTE_A = '/vault/Inbox/OutgoingHomeNote.md';
    const {args, hubWorkspaces} = makeArgs({
      activeTodayHubUri: HUB_A,
      hubWorkspaces: {
        [HUB_B]: {editorWorkspaceTabs: [], activeEditorTabId: null},
      },
      homeStatesByHubSeed: {
        [HUB_A]: {history: {entries: [HUB_A, NOTE_A], index: 1}},
      },
    });
    const {result} = renderHook(() => useWorkspaceTodayHubSwitch(args));

    await act(async () => {
      await result.current.switchTodayHubWorkspace(HUB_B);
    });

    expect(hubWorkspaces[HUB_A]?.homeHistory).toEqual({
      entries: [HUB_A, NOTE_A],
      index: 1,
    });
  });

  it('snapshot-then-restore (target has tabs): saves outgoing hub A, keeps B snapshot, activates restored tab, does NOT call selectNote(B)', async () => {
    const bSnapshot: TodayHubWorkspaceSnapshot = {
      editorWorkspaceTabs: [{id: 'tab-b1', entries: [HUB_B], index: 0}],
      activeEditorTabId: 'tab-b1',
    };
    const tabsA = [
      {id: 'tab-a1', entries: ['/vault/Inbox/Note1.md'], index: 0},
      {id: 'tab-a2', entries: [HUB_A, '/vault/Inbox/Z.md'], index: 1},
    ];
    const {args, mocks, hubWorkspaces} = makeArgs({
      activeTodayHubUri: HUB_A,
      hubWorkspaces: {[HUB_B]: bSnapshot},
      editorWorkspaceTabs: tabsA,
      activeEditorTabId: 'tab-a2',
    });
    const {result} = renderHook(() => useWorkspaceTodayHubSwitch(args));

    await act(async () => {
      await result.current.switchTodayHubWorkspace(HUB_B);
    });

    const expectedOutgoing = tabsToStored(
      tabsA.map(s => ({id: s.id, history: {entries: s.entries, index: s.index}})),
    );
    expect(hubWorkspaces[HUB_A]).toEqual({
      editorWorkspaceTabs: expectedOutgoing,
      activeEditorTabId: 'tab-a2',
    });
    expect(hubWorkspaces[HUB_B]).toEqual(bSnapshot);

    expect(mocks.setEditorWorkspaceTabs).toHaveBeenCalledOnce();
    const restoredTabs = mocks.setEditorWorkspaceTabs.mock.calls[0]![0] as unknown[];
    expect(restoredTabs).toHaveLength(1);

    expect(mocks.setActiveEditorTabId).toHaveBeenCalledWith('tab-b1');
    expect(mocks.activateOpenTab).toHaveBeenCalledWith('tab-b1');
    expect(mocks.selectNote).not.toHaveBeenCalledWith(HUB_B);
    expect(mocks.setActiveTodayHubUri).toHaveBeenCalledWith(HUB_B);
  });

  it('back-to-back hub switches restore from queued snapshot when setTodayHubWorkspacesForSave defers updaters', async () => {
    const bSnapshot: TodayHubWorkspaceSnapshot = {
      editorWorkspaceTabs: [{id: 'tab-b1', entries: [HUB_B], index: 0}],
      activeEditorTabId: 'tab-b1',
    };
    const tabsA = [
      {id: 'tab-a1', entries: ['/vault/Inbox/Note1.md'], index: 0},
      {id: 'tab-a2', entries: [HUB_A, '/vault/Inbox/Z.md'], index: 1},
    ];
    const hubWorkspaces: StubWorkspaces = {[HUB_B]: bSnapshot};
    const recordedUpdaters: Array<(prev: StubWorkspaces) => StubWorkspaces> = [];
    const setTodayHubWorkspacesForSave = vi.fn(
      (updaterOrValue: StubWorkspaces | ((prev: StubWorkspaces) => StubWorkspaces)) => {
        if (typeof updaterOrValue === 'function') {
          recordedUpdaters.push(updaterOrValue);
        }
      },
    );

    const {args, mocks} = makeArgs({
      activeTodayHubUri: HUB_A,
      hubWorkspaces,
      editorWorkspaceTabs: tabsA,
      activeEditorTabId: 'tab-a2',
      setTodayHubWorkspacesForSave,
    });
    const {result} = renderHook(() => useWorkspaceTodayHubSwitch(args));

    await act(async () => {
      await result.current.switchTodayHubWorkspace(HUB_B);
      await result.current.switchTodayHubWorkspace(HUB_A);
    });

    expect(recordedUpdaters.length).toBe(2);
    const expectedOutgoingA = tabsToStored(
      tabsA.map(s => ({id: s.id, history: {entries: s.entries, index: s.index}})),
    );
    const expectedOutgoingB = tabsToStored([
      {id: 'tab-b1', history: {entries: [HUB_B], index: 0}},
    ]);

    let state: StubWorkspaces = {...hubWorkspaces};
    for (const up of recordedUpdaters) {
      state = up(state);
    }
    expect(state[HUB_A]).toEqual({
      editorWorkspaceTabs: expectedOutgoingA,
      activeEditorTabId: 'tab-a2',
    });
    expect(state[HUB_B]).toEqual({
      editorWorkspaceTabs: expectedOutgoingB,
      activeEditorTabId: 'tab-b1',
    });

    expect(mocks.setActiveTodayHubUri).toHaveBeenLastCalledWith(HUB_A);
    const lastTabs = mocks.setEditorWorkspaceTabs.mock.calls.at(-1)![0] as unknown[];
    expect(lastTabs).toHaveLength(2);
    expect((lastTabs as EditorWorkspaceTab[]).map(t => t.id)).toEqual([
      'tab-a1',
      'tab-a2',
    ]);
    expect(mocks.activateOpenTab).toHaveBeenLastCalledWith('tab-a2');
  });

  it('restore does not depend on synchronous execution of setTodayHubWorkspacesForSave updater', async () => {
    const bSnapshot: TodayHubWorkspaceSnapshot = {
      editorWorkspaceTabs: [{id: 'tab-b1', entries: [HUB_B], index: 0}],
      activeEditorTabId: 'tab-b1',
    };
    const hubWorkspaces: StubWorkspaces = {[HUB_B]: bSnapshot};
    const recordedUpdaters: Array<(prev: StubWorkspaces) => StubWorkspaces> = [];
    const setTodayHubWorkspacesForSave = vi.fn(
      (updaterOrValue: StubWorkspaces | ((prev: StubWorkspaces) => StubWorkspaces)) => {
        if (typeof updaterOrValue === 'function') {
          recordedUpdaters.push(updaterOrValue);
        }
      },
    );

    const {args, mocks} = makeArgs({
      activeTodayHubUri: HUB_A,
      hubWorkspaces,
      setTodayHubWorkspacesForSave,
    });
    const {result} = renderHook(() => useWorkspaceTodayHubSwitch(args));

    await act(async () => {
      await result.current.switchTodayHubWorkspace(HUB_B);
    });

    expect(recordedUpdaters.length).toBeGreaterThanOrEqual(1);
    expect(mocks.activateOpenTab).toHaveBeenCalledWith('tab-b1');
    expect(mocks.selectNote).not.toHaveBeenCalledWith(HUB_B);
    expect(mocks.setActiveTodayHubUri).toHaveBeenCalledWith(HUB_B);
  });

  it('empty target tabs: opens the current Home entry after clearing tabs', async () => {
    const {args, mocks} = makeArgs({
      activeTodayHubUri: HUB_A,
      hubWorkspaces: {},
    });
    const {result} = renderHook(() => useWorkspaceTodayHubSwitch(args));

    await act(async () => {
      await result.current.switchTodayHubWorkspace(HUB_B);
    });

    expect(mocks.setEditorWorkspaceTabs).toHaveBeenCalledWith([]);
    expect(mocks.setActiveEditorTabId).toHaveBeenCalledWith(null);
    expect(mocks.selectHomeCurrentNote).toHaveBeenCalledWith(HUB_B);
    expect(mocks.selectNote).not.toHaveBeenCalledWith(HUB_B);
    expect(mocks.activateOpenTab).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// focusActiveTodayHubNote
// ---------------------------------------------------------------------------

describe('focusActiveTodayHubNote', () => {
  it('delegates to activateWorkspaceHomeSelector (workspace title-bar main control)', () => {
    const {args, mocks} = makeArgs({activeTodayHubUri: HUB_A});
    const {result} = renderHook(() => useWorkspaceTodayHubSwitch(args));

    act(() => {
      result.current.focusActiveTodayHubNote();
    });

    expect(mocks.activateWorkspaceHomeSelector).toHaveBeenCalledTimes(1);
    expect(mocks.selectNote).not.toHaveBeenCalled();
  });

  it('still invokes activateWorkspaceHomeSelector when hub ref is null (parent decides no-op)', () => {
    const {args, mocks} = makeArgs({activeTodayHubUri: null});
    const {result} = renderHook(() => useWorkspaceTodayHubSwitch(args));

    act(() => {
      result.current.focusActiveTodayHubNote();
    });

    expect(mocks.activateWorkspaceHomeSelector).toHaveBeenCalledTimes(1);
  });
});

import {describe, expect, it} from 'vitest';

import type {TodayHubWorkspaceSnapshot} from '../lib/mainWindowUiStore';
import type {WorkspaceHomeState} from '../lib/workspaceHomeNavigation';
import {
  activeSurfaceTabIdFromWorkspaceModel,
  projectWorkspaceRuntimeToModel,
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

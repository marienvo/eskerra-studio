import {describe, expect, it} from 'vitest';

import type {EditorWorkspaceTab} from '../lib/editorWorkspaceTabs';
import type {TodayHubWorkspaceSnapshot} from '../lib/mainWindowUiStore';
import {normalizeWorkspaceUri} from '../lib/workspaceModel';

import {restoreShadowWorkspaceModelFromInboxState} from './workspaceShellRestoreModel';

const HUB_A = '/vault/A/Today.md';
const HUB_B = '/vault/B/Today.md';
const NOTE_A = '/vault/Inbox/A.md';
const NOTE_B = '/vault/Inbox/B.md';
const NOTE_HOME_A = '/vault/Inbox/HomeA.md';

function liveTab(id: string, entries: string[], index = entries.length - 1): EditorWorkspaceTab {
  return {id, history: {entries, index}};
}

describe('restoreShadowWorkspaceModelFromInboxState (JSON→model path)', () => {
  it('returns an empty model when the vault has no hubs', () => {
    const model = restoreShadowWorkspaceModelFromInboxState({
      hubUris: [],
      activeTodayHubUri: null,
      todayHubWorkspaces: null,
      editorWorkspaceTabs: [],
      activeEditorTabId: null,
      homeStatesByHub: {},
    });

    expect(model).toEqual({activeHub: null, workspaces: {}});
  });

  it('uses the live tab strip for the single active hub', () => {
    const hubNorm = normalizeWorkspaceUri(HUB_A);
    const liveTabs: EditorWorkspaceTab[] = [liveTab('tab-a', [NOTE_A])];

    const model = restoreShadowWorkspaceModelFromInboxState({
      hubUris: [HUB_A],
      activeTodayHubUri: HUB_A,
      todayHubWorkspaces: {
        [HUB_A]: {
          editorWorkspaceTabs: [{id: 'stale-from-disk', entries: [NOTE_B], index: 0}],
          activeEditorTabId: 'stale-from-disk',
        },
      },
      editorWorkspaceTabs: liveTabs,
      activeEditorTabId: 'tab-a',
      homeStatesByHub: {
        [HUB_A]: {history: {entries: [HUB_A], index: 0}},
      },
    });

    expect(model.activeHub).toBe(hubNorm);
    expect(model.workspaces[hubNorm]?.tabs).toEqual([
      {id: 'tab-a', history: {entries: [NOTE_A], index: 0}},
    ]);
    expect(model.workspaces[hubNorm]?.active).toEqual({kind: 'tab', id: 'tab-a'});
    expect(model.workspaces[hubNorm]?.homeHistory).toEqual({entries: [hubNorm], index: 0});
  });

  it('preserves the inactive hub snapshot while overriding the active hub from live tabs', () => {
    const hubA = normalizeWorkspaceUri(HUB_A);
    const hubB = normalizeWorkspaceUri(HUB_B);
    const inactiveSnapshot: TodayHubWorkspaceSnapshot = {
      editorWorkspaceTabs: [{id: 'tab-b', entries: [NOTE_B], index: 0}],
      activeEditorTabId: 'tab-b',
    };

    const model = restoreShadowWorkspaceModelFromInboxState({
      hubUris: [HUB_A, HUB_B],
      activeTodayHubUri: HUB_A,
      todayHubWorkspaces: {
        [HUB_A]: {
          editorWorkspaceTabs: [{id: 'stale-active', entries: [NOTE_B], index: 0}],
          activeEditorTabId: 'stale-active',
        },
        [HUB_B]: inactiveSnapshot,
      },
      editorWorkspaceTabs: [liveTab('tab-a', [NOTE_A])],
      activeEditorTabId: 'tab-a',
      homeStatesByHub: {
        [HUB_A]: {history: {entries: [HUB_A], index: 0}},
        [HUB_B]: {history: {entries: [HUB_B], index: 0}},
      },
    });

    expect(model.activeHub).toBe(hubA);

    expect(model.workspaces[hubA]?.tabs).toEqual([
      {id: 'tab-a', history: {entries: [NOTE_A], index: 0}},
    ]);
    expect(model.workspaces[hubA]?.active).toEqual({kind: 'tab', id: 'tab-a'});

    expect(model.workspaces[hubB]?.tabs).toEqual([
      {id: 'tab-b', history: {entries: [NOTE_B], index: 0}},
    ]);
    expect(model.workspaces[hubB]?.active).toEqual({kind: 'tab', id: 'tab-b'});
  });

  it('keeps per-hub home history across restore (runtime override + snapshot fallback)', () => {
    const hubA = normalizeWorkspaceUri(HUB_A);
    const hubB = normalizeWorkspaceUri(HUB_B);

    const model = restoreShadowWorkspaceModelFromInboxState({
      hubUris: [HUB_A, HUB_B],
      activeTodayHubUri: HUB_A,
      todayHubWorkspaces: {
        [HUB_A]: {
          editorWorkspaceTabs: [],
          activeEditorTabId: null,
          homeHistory: {entries: [HUB_A, NOTE_A], index: 1},
        },
        [HUB_B]: {
          editorWorkspaceTabs: [],
          activeEditorTabId: null,
          homeHistory: {entries: [HUB_B, NOTE_B], index: 1},
        },
      },
      editorWorkspaceTabs: [],
      activeEditorTabId: null,
      homeStatesByHub: {
        [HUB_A]: {history: {entries: [HUB_A, NOTE_HOME_A], index: 1}},
      },
    });

    expect(model.workspaces[hubA]?.homeHistory).toEqual({
      entries: [hubA, NOTE_HOME_A],
      index: 1,
    });
    expect(model.workspaces[hubB]?.homeHistory).toEqual({
      entries: [hubB, NOTE_B],
      index: 1,
    });
  });

  it('drops persisted echo rows (tab whose current URI is the hub itself) for inactive hubs', () => {
    const hubB = normalizeWorkspaceUri(HUB_B);

    const model = restoreShadowWorkspaceModelFromInboxState({
      hubUris: [HUB_A, HUB_B],
      activeTodayHubUri: HUB_A,
      todayHubWorkspaces: {
        [HUB_B]: {
          editorWorkspaceTabs: [
            {id: 'echo', entries: [HUB_B], index: 0},
            {id: 'tab-b', entries: [NOTE_B], index: 0},
          ],
          activeEditorTabId: 'tab-b',
        },
      },
      editorWorkspaceTabs: [liveTab('tab-a', [NOTE_A])],
      activeEditorTabId: 'tab-a',
      homeStatesByHub: {},
    });

    expect(model.workspaces[hubB]?.tabs.map(t => t.id)).toEqual(['tab-b']);
  });
});

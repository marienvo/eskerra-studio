import {describe, expect, it} from 'vitest';

import {homeCurrentUri} from './workspaceHomeNavigation';
import {
  hydrateWorkspaceHomeStatesFromPersisted,
  parseTodayHubSnapshotHomeHistoryForStore,
} from './workspaceHomePersistence';

const HUB = '/vault/Daily/Today.md';
const NOTE = '/vault/Inbox/X.md';

describe('hydrateWorkspaceHomeStatesFromPersisted', () => {
  it('maps persisted homeHistory into WorkspaceHomeState', () => {
    const map = hydrateWorkspaceHomeStatesFromPersisted({
      hubUris: [HUB],
      activeTodayHubUri: HUB,
      todayHubWorkspaces: {
        [HUB]: {
          editorWorkspaceTabs: [],
          activeEditorTabId: null,
          homeHistory: {entries: [HUB, NOTE], index: 1},
        },
      },
    });
    expect(homeCurrentUri(map[HUB]!)).toBe(NOTE);
  });

  it('defaults when homeHistory key is absent', () => {
    const map = hydrateWorkspaceHomeStatesFromPersisted({
      hubUris: [HUB],
      activeTodayHubUri: HUB,
      todayHubWorkspaces: {
        [HUB]: {
          editorWorkspaceTabs: [],
          activeEditorTabId: null,
        },
      },
    });
    expect(homeCurrentUri(map[HUB]!)).toBe(HUB);
  });

  it('finds persisted homeHistory when hubUris are not normalized but JSON keys are', () => {
    const denorm = `  ${HUB.replace(/\//g, '\\')}  `;
    const map = hydrateWorkspaceHomeStatesFromPersisted({
      hubUris: [denorm],
      activeTodayHubUri: denorm,
      todayHubWorkspaces: {
        [HUB]: {
          editorWorkspaceTabs: [],
          activeEditorTabId: null,
          homeHistory: {entries: [HUB, NOTE], index: 1},
        },
      },
    });
    expect(homeCurrentUri(map[denorm]!)).toBe(NOTE);
  });
});

describe('parseTodayHubSnapshotHomeHistoryForStore', () => {
  const HUB = '/vault/Daily/Today.md';
  const NOTE = '/vault/Inbox/X.md';

  it('reads homeHistory when hubUri is not normalized', () => {
    const denorm = `  ${HUB.replace(/\//g, '\\')}  `;
    const hist = parseTodayHubSnapshotHomeHistoryForStore(denorm, {
      homeHistory: {entries: [HUB, NOTE], index: 1},
    });
    expect(hist).toEqual({
      entries: [HUB, NOTE],
      index: 1,
    });
  });
});

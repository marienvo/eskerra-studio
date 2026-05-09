import {describe, expect, it} from 'vitest';

import {homeCurrentUri} from './workspaceHomeNavigation';
import {hydrateWorkspaceHomeStatesFromPersisted} from './workspaceHomePersistence';

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
});

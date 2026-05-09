import {describe, expect, it} from 'vitest';

import type {TodayHubWorkspaceSnapshot} from '../lib/mainWindowUiStore';
import {
  buildRestoredEditorWorkspace,
  restoredTodayHubWorkspaceUrisForRestore,
} from './inboxShellRestoreHelpers';

const emptySnap = {} as TodayHubWorkspaceSnapshot;

describe('restoredTodayHubWorkspaceUrisForRestore', () => {
  const root = '/vault';

  it('merges persisted hub keys under vault root that are Today markdown files', () => {
    const hubs = restoredTodayHubWorkspaceUrisForRestore({
      currentHubUris: ['/vault/A/Today.md'],
      restored: {
        '/vault/B/Today.md': emptySnap,
      },
      root,
    });
    expect(hubs).toEqual(['/vault/A/Today.md', '/vault/B/Today.md']);
  });

  it('skips restored keys outside vault root', () => {
    expect(
      restoredTodayHubWorkspaceUrisForRestore({
        currentHubUris: ['/vault/A/Today.md'],
        restored: {
          '/other/Today.md': emptySnap,
        },
        root,
      }),
    ).toEqual(['/vault/A/Today.md']);
  });

  it('dedupes hubs already in current list', () => {
    expect(
      restoredTodayHubWorkspaceUrisForRestore({
        currentHubUris: ['/vault/A/Today.md'],
        restored: {
          '/vault/A/Today.md': emptySnap,
        },
        root,
      }),
    ).toEqual(['/vault/A/Today.md']);
  });
});

describe('buildRestoredEditorWorkspace', () => {
  it('returns current URIs from tab history without crashing', () => {
    const restored = buildRestoredEditorWorkspace({
      chosenTabsSource: [
        {
          id: 'tab-1',
          entries: ['file:///vault/Inbox/A.md', 'file:///vault/Inbox/B.md'],
          index: 1,
        },
        {
          id: 'tab-2',
          entries: ['file:///vault/General/C.md'],
          index: 0,
        },
      ],
      chosenActiveEditorTabId: 'tab-2',
      filter: () => true,
    });

    expect(restored).not.toBeNull();
    expect(restored!.uris).toEqual([
      'file:///vault/Inbox/B.md',
      'file:///vault/General/C.md',
    ]);
    expect(restored!.activeEditorTabId).toBe('tab-2');
  });
});

import {describe, expect, it} from 'vitest';

import type {TodayHubWorkspaceSnapshot} from '../lib/mainWindowUiStore';
import {
  buildRestoredEditorWorkspace,
  makeStoredTabFilter,
  restoredTodayHubWorkspaceKeysForVault,
  restoredTodayHubWorkspaceUrisForRestore,
  sanitizeTodayHubWorkspacesWithStoredTabFilter,
} from './inboxShellRestoreHelpers';

const emptySnap = {} as TodayHubWorkspaceSnapshot;

describe('restoredTodayHubWorkspaceKeysForVault', () => {
  const root = '/vault';

  it('returns Today.md hub paths under the vault root only', () => {
    expect(
      restoredTodayHubWorkspaceKeysForVault(
        {
          '/vault/Areas/X/Today.md': emptySnap,
          '/other-vault/Areas/Y/Today.md': emptySnap,
          '/vault/Inbox/Z.md': emptySnap,
        },
        root,
      ).sort(),
    ).toEqual(['/vault/Areas/X/Today.md']);
  });
});

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

describe('sanitizeTodayHubWorkspacesWithStoredTabFilter', () => {
  it('strips invalid tab URIs from every hub snapshot and reclamps active tab id', () => {
    const root = '/vault';
    const filter = makeStoredTabFilter({
      root,
      knownNoteUris: new Set(['/vault/Inbox/keep.md']),
    });
    const hubA = '/vault/A/Today.md';
    const hubB = '/vault/B/Today.md';
    const out = sanitizeTodayHubWorkspacesWithStoredTabFilter(
      {
        [hubA]: {
          editorWorkspaceTabs: [
            {id: 'ok', entries: ['/vault/Inbox/keep.md'], index: 0},
            {id: 'outside', entries: ['/other-vault/Inbox/x.md'], index: 0},
          ],
          activeEditorTabId: 'outside',
        },
        [hubB]: {
          editorWorkspaceTabs: [{id: 'non-md', entries: ['/vault/Inbox/readme.txt'], index: 0}],
          activeEditorTabId: 'non-md',
        },
      },
      filter,
    );

    expect(out![hubA]!.editorWorkspaceTabs.map(t => t.id)).toEqual(['ok']);
    expect(out![hubA]!.activeEditorTabId).toBe('ok');
    expect(out![hubB]!.editorWorkspaceTabs).toEqual([]);
    expect(out![hubB]!.activeEditorTabId).toBeNull();
  });

  it('keeps explicit Home (activeEditorTabId null) when tabs remain after filtering', () => {
    const root = '/vault';
    const filter = makeStoredTabFilter({
      root,
      knownNoteUris: new Set(['/vault/Inbox/keep.md']),
    });
    const hub = '/vault/A/Today.md';
    const out = sanitizeTodayHubWorkspacesWithStoredTabFilter(
      {
        [hub]: {
          editorWorkspaceTabs: [
            {id: 't1', entries: ['/vault/Inbox/keep.md'], index: 0},
            {id: 't2', entries: ['/vault/Inbox/keep.md'], index: 0},
          ],
          activeEditorTabId: null,
        },
      },
      filter,
    );

    expect(out![hub]!.editorWorkspaceTabs).toHaveLength(2);
    expect(out![hub]!.activeEditorTabId).toBeNull();
  });

  it('defaults to first tab when activeEditorTabId is absent (legacy snapshots)', () => {
    const filter = () => true;
    const hub = '/vault/A/Today.md';
    const out = sanitizeTodayHubWorkspacesWithStoredTabFilter(
      {
        [hub]: {
          editorWorkspaceTabs: [
            {id: 'a', entries: ['/vault/x.md'], index: 0},
            {id: 'b', entries: ['/vault/y.md'], index: 0},
          ],
        },
      },
      filter,
    );

    expect(out![hub]!.activeEditorTabId).toBe('a');
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

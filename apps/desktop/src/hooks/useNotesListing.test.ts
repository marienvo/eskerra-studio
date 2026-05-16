import {act, renderHook} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';

import {useNotesListing} from './useNotesListing';
import {listInboxNotes} from '../lib/vaultBootstrap';

vi.mock('../lib/vaultBootstrap', () => ({
  listInboxNotes: vi.fn(),
}));

describe('useNotesListing', () => {
  it('refreshes notes and mirrors notesRef', async () => {
    vi.mocked(listInboxNotes).mockResolvedValueOnce([
      {uri: '/vault/Inbox/a.md', name: 'a.md', lastModified: null},
    ]);
    const {result} = renderHook(() => useNotesListing({fs: {} as never}));

    await act(async () => {
      await result.current.refreshNotes('/vault');
    });

    expect(result.current.notes).toEqual([
      {uri: '/vault/Inbox/a.md', name: 'a.md', lastModified: null},
    ]);
    expect(result.current.notesRef.current).toEqual(result.current.notes);
  });

  it('drops stale refresh results when a newer refresh wins', async () => {
    let resolveFirst: ((value: Array<{uri: string; name: string; lastModified: number | null}>) => void) | null =
      null;
    let resolveSecond: ((value: Array<{uri: string; name: string; lastModified: number | null}>) => void) | null =
      null;

    vi.mocked(listInboxNotes)
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            resolveFirst = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            resolveSecond = resolve;
          }),
      );

    const {result} = renderHook(() => useNotesListing({fs: {} as never}));

    let p1: Promise<void> | null = null;
    let p2: Promise<void> | null = null;
    await act(async () => {
      p1 = result.current.refreshNotes('/vault');
      p2 = result.current.refreshNotes('/vault');
    });

    await act(async () => {
      resolveSecond?.([{uri: '/vault/Inbox/new.md', name: 'new.md', lastModified: 2}]);
      await p2;
    });

    await act(async () => {
      resolveFirst?.([{uri: '/vault/Inbox/old.md', name: 'old.md', lastModified: 1}]);
      await p1;
    });

    expect(result.current.notes).toEqual([
      {uri: '/vault/Inbox/new.md', name: 'new.md', lastModified: 2},
    ]);
  });
});

import {act, renderHook} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';

import {useDiskConflictState} from './useDiskConflictState';

describe('useDiskConflictState', () => {
  it('reloads from disk for the selected note and clears conflict UI', () => {
    const selectedUriRef = {current: '/note.md'};
    const lastPersistedRef = {current: null as {uri: string; markdown: string} | null};
    const lastPersistedExternalMutationSeqRef = {current: 0};
    const inboxContentByUriRef = {current: {} as Record<string, string>};
    const skipRecencyDeferForUriRef = {current: new Set<string>()};
    let inboxCacheState: Record<string, string> = {};
    const setInboxContentByUri = vi.fn((update: unknown) => {
      if (typeof update === 'function') {
        inboxCacheState = (update as (prev: Record<string, string>) => Record<string, string>)(
          inboxCacheState,
        );
        return;
      }
      inboxCacheState = update as Record<string, string>;
    });
    const setErr = vi.fn();
    const loadFullMarkdownIntoInboxEditor = vi.fn();
    const scheduleBacklinksDeferOneFrameAfterLoad = vi.fn();
    const cancelAutosave = vi.fn();

    const {result} = renderHook(() =>
      useDiskConflictState({
        loadFullMarkdownIntoInboxEditor,
        scheduleBacklinksDeferOneFrameAfterLoad,
        cancelAutosave,
        selectedUriRef,
        lastPersistedRef,
        lastPersistedExternalMutationSeqRef,
        inboxContentByUriRef,
        skipRecencyDeferForUriRef,
        setInboxContentByUri,
        setErr,
      }),
    );

    act(() => {
      result.current.setDiskConflict({uri: '/note.md', diskMarkdown: '# disk'});
    });
    act(() => {
      result.current.resolveDiskConflictReloadFromDisk();
    });

    expect(loadFullMarkdownIntoInboxEditor).toHaveBeenCalledWith(
      '# disk',
      '/note.md',
      'start',
    );
    expect(scheduleBacklinksDeferOneFrameAfterLoad).toHaveBeenCalledTimes(1);
    expect(lastPersistedRef.current).toEqual({uri: '/note.md', markdown: '# disk'});
    expect(lastPersistedExternalMutationSeqRef.current).toBe(1);
    expect(result.current.diskConflict).toBeNull();
    expect(result.current.diskConflictSoft).toBeNull();
    expect(setErr).toHaveBeenLastCalledWith(null);
    expect(setInboxContentByUri).toHaveBeenCalledTimes(1);
    expect(inboxCacheState['/note.md']).toBe('# disk');
  });

  it('elevates a soft conflict to blocking and clears recency skip on dismiss', () => {
    const selectedUriRef = {current: '/note.md'};
    const lastPersistedRef = {current: null as {uri: string; markdown: string} | null};
    const lastPersistedExternalMutationSeqRef = {current: 0};
    const inboxContentByUriRef = {current: {} as Record<string, string>};
    const skipRecencyDeferForUriRef = {current: new Set<string>(['/note.md'])};
    const cancelAutosave = vi.fn();

    const {result} = renderHook(() =>
      useDiskConflictState({
        loadFullMarkdownIntoInboxEditor: vi.fn(),
        scheduleBacklinksDeferOneFrameAfterLoad: vi.fn(),
        cancelAutosave,
        selectedUriRef,
        lastPersistedRef,
        lastPersistedExternalMutationSeqRef,
        inboxContentByUriRef,
        skipRecencyDeferForUriRef,
        setInboxContentByUri: vi.fn(),
        setErr: vi.fn(),
      }),
    );

    act(() => {
      result.current.setDiskConflictSoft({uri: '/note.md', diskMarkdown: '# stale'});
    });
    act(() => {
      result.current.elevateDiskConflictSoftToBlocking();
    });

    expect(cancelAutosave).toHaveBeenCalledTimes(1);
    expect(result.current.diskConflict).toEqual({
      uri: '/note.md',
      diskMarkdown: '# stale',
    });
    expect(result.current.diskConflictSoft).toBeNull();

    act(() => {
      result.current.dismissDiskConflictSoft();
    });
    expect(skipRecencyDeferForUriRef.current.size).toBe(0);
  });

  it('clearBlockingDiskConflictForMergedBody records disk as last persisted and clears UI', () => {
    const selectedUriRef = {current: '/note.md'};
    const lastPersistedRef = {current: {uri: '/other.md', markdown: 'x'} as {uri: string; markdown: string}};
    const lastPersistedExternalMutationSeqRef = {current: 2};
    const inboxContentByUriRef = {current: {} as Record<string, string>};
    const skipRecencyDeferForUriRef = {current: new Set<string>()};
    const cancelAutosave = vi.fn();

    const {result} = renderHook(() =>
      useDiskConflictState({
        loadFullMarkdownIntoInboxEditor: vi.fn(),
        scheduleBacklinksDeferOneFrameAfterLoad: vi.fn(),
        cancelAutosave,
        selectedUriRef,
        lastPersistedRef,
        lastPersistedExternalMutationSeqRef,
        inboxContentByUriRef,
        skipRecencyDeferForUriRef,
        setInboxContentByUri: vi.fn(),
        setErr: vi.fn(),
      }),
    );

    act(() => {
      result.current.setDiskConflict({uri: '/note.md', diskMarkdown: '# from disk'});
    });
    act(() => {
      result.current.clearBlockingDiskConflictForMergedBody();
    });

    expect(cancelAutosave).toHaveBeenCalledTimes(1);
    expect(lastPersistedRef.current).toEqual({uri: '/note.md', markdown: '# from disk'});
    expect(lastPersistedExternalMutationSeqRef.current).toBe(3);
    expect(result.current.diskConflict).toBeNull();
    expect(result.current.diskConflictSoft).toBeNull();
  });
});

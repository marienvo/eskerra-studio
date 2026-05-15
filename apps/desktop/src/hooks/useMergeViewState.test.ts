import {act, renderHook} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';

import {useMergeViewState} from './useMergeViewState';

describe('useMergeViewState', () => {
  it('ignores non-backup paths when opening backup merge mode', async () => {
    const {result} = renderHook(() =>
      useMergeViewState({
        fs: {readFile: vi.fn()} as unknown as Parameters<typeof useMergeViewState>[0]['fs'],
        openMarkdownInEditor: vi.fn(async () => undefined),
        selectedUriRef: {current: '/note.md'},
        composingNewEntryRef: {current: false},
        showTodayHubCanvasRef: {current: false},
        todayHubWikiNavParentRef: {current: null},
        diskConflictRef: {current: null},
        diskConflictSoftRef: {current: null},
        setDiskConflict: vi.fn(),
        setDiskConflictSoft: vi.fn(),
        resolveDiskConflictReloadFromDisk: vi.fn(),
        resolveDiskConflictKeepLocal: vi.fn(),
        cancelAutosave: vi.fn(),
        setErr: vi.fn(),
        inboxEditorRef: {current: null},
        loadFullMarkdownIntoInboxEditor: vi.fn(),
        editorBodyRef: {current: ''},
        setEditorBody: vi.fn(),
        suppressEditorOnChangeRef: {current: false},
        inboxYamlFrontmatterInnerRef: {current: null},
        inboxEditorYamlLeadingBeforeFrontmatterRef: {current: ''},
        inboxContentByUriRef: {current: {}},
        setInboxContentByUri: vi.fn(),
        backlinksActiveBodyRef: {current: ''},
        setBacklinksActiveBody: vi.fn(),
        enqueuePersistOutgoingNoteMarkdown: vi.fn(),
        scheduleBacklinksDeferOneFrameAfterLoad: vi.fn(),
        lastPersistedRef: {current: null},
        lastPersistedExternalMutationSeqRef: {current: 0},
      }),
    );

    await act(async () => {
      const entered = await result.current.tryEnterBackupMergeView('/vault/Notes/note.md');
      expect(entered).toBe(false);
    });
    expect(result.current.mergeView).toBeNull();
  });

  it('promotes soft conflict into disk-conflict merge view and keeps local edits', () => {
    const diskConflictRef = {current: null as {uri: string; diskMarkdown: string} | null};
    const diskConflictSoftRef = {
      current: {uri: '/note.md', diskMarkdown: '# disk'} as {uri: string; diskMarkdown: string} | null,
    };
    const resolveDiskConflictKeepLocal = vi.fn();
    const cancelAutosave = vi.fn();

    const {result} = renderHook(() =>
      useMergeViewState({
        fs: {readFile: vi.fn()} as unknown as Parameters<typeof useMergeViewState>[0]['fs'],
        openMarkdownInEditor: vi.fn(async () => undefined),
        selectedUriRef: {current: '/note.md'},
        composingNewEntryRef: {current: false},
        showTodayHubCanvasRef: {current: false},
        todayHubWikiNavParentRef: {current: null},
        diskConflictRef,
        diskConflictSoftRef,
        setDiskConflict: vi.fn(),
        setDiskConflictSoft: vi.fn(),
        resolveDiskConflictReloadFromDisk: vi.fn(),
        resolveDiskConflictKeepLocal,
        cancelAutosave,
        setErr: vi.fn(),
        inboxEditorRef: {current: null},
        loadFullMarkdownIntoInboxEditor: vi.fn(),
        editorBodyRef: {current: ''},
        setEditorBody: vi.fn(),
        suppressEditorOnChangeRef: {current: false},
        inboxYamlFrontmatterInnerRef: {current: null},
        inboxEditorYamlLeadingBeforeFrontmatterRef: {current: ''},
        inboxContentByUriRef: {current: {}},
        setInboxContentByUri: vi.fn(),
        backlinksActiveBodyRef: {current: ''},
        setBacklinksActiveBody: vi.fn(),
        enqueuePersistOutgoingNoteMarkdown: vi.fn(),
        scheduleBacklinksDeferOneFrameAfterLoad: vi.fn(),
        lastPersistedRef: {current: null},
        lastPersistedExternalMutationSeqRef: {current: 0},
      }),
    );

    act(() => {
      result.current.enterDiskConflictMergeView();
    });
    expect(cancelAutosave).toHaveBeenCalledTimes(1);
    expect(result.current.mergeView).toEqual({
      kind: 'diskConflict',
      baseUri: '/note.md',
      diskMarkdown: '# disk',
    });
    expect(diskConflictRef.current).toEqual({
      uri: '/note.md',
      diskMarkdown: '# disk',
    });
    expect(diskConflictSoftRef.current).toBeNull();

    act(() => {
      result.current.keepMyEditsFromMerge();
    });
    expect(resolveDiskConflictKeepLocal).toHaveBeenCalledTimes(1);
    expect(result.current.mergeView).toBeNull();
  });
});

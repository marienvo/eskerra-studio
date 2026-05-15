import {act, renderHook} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';

import {useMergeViewState} from './useMergeViewState';

const baseMergeOptions = {
  fs: {readFile: vi.fn()} as unknown as Parameters<typeof useMergeViewState>[0]['fs'],
  openMarkdownInEditor: vi.fn(async () => undefined),
  selectedUriRef: {current: '/note.md'},
  composingNewEntryRef: {current: false},
  showTodayHubCanvasRef: {current: false},
  todayHubWikiNavParentRef: {current: null},
  diskConflictRef: {current: null},
  diskConflictSoftRef: {current: null},
  resolveDiskConflictReloadFromDisk: vi.fn(),
  resolveDiskConflictKeepLocal: vi.fn(),
  elevateDiskConflictSoftToBlocking: vi.fn(),
  clearBlockingDiskConflictForMergedBody: vi.fn(),
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
};

describe('useMergeViewState', () => {
  it('ignores non-backup paths when opening backup merge mode', async () => {
    const {result} = renderHook(() =>
      useMergeViewState({
        ...baseMergeOptions,
        selectedUriRef: {current: '/note.md'},
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
      current: {uri: '/note.md', diskMarkdown: '# disk'} as {
        uri: string;
        diskMarkdown: string;
      } | null,
    };
    const resolveDiskConflictKeepLocal = vi.fn();
    const cancelAutosave = vi.fn();
    const elevateDiskConflictSoftToBlocking = vi.fn(() => {
      const s = diskConflictSoftRef.current;
      if (!s) return;
      cancelAutosave();
      diskConflictRef.current = {uri: s.uri, diskMarkdown: s.diskMarkdown};
      diskConflictSoftRef.current = null;
    });

    const {result} = renderHook(() =>
      useMergeViewState({
        ...baseMergeOptions,
        diskConflictRef,
        diskConflictSoftRef,
        resolveDiskConflictKeepLocal,
        elevateDiskConflictSoftToBlocking,
      }),
    );

    act(() => {
      result.current.enterDiskConflictMergeView();
    });
    expect(elevateDiskConflictSoftToBlocking).toHaveBeenCalledTimes(1);
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

  it('delegates disk-conflict merge apply to clearBlockingDiskConflictForMergedBody', () => {
    const clearBlockingDiskConflictForMergedBody = vi.fn();
    const diskConflictRef = {
      current: {uri: '/note.md', diskMarkdown: '# on disk'} as {
        uri: string;
        diskMarkdown: string;
      } | null,
    };
    const loadMarkdown = vi.fn();
    const {result} = renderHook(() =>
      useMergeViewState({
        ...baseMergeOptions,
        diskConflictRef,
        clearBlockingDiskConflictForMergedBody,
        inboxEditorRef: {current: {loadMarkdown} as never},
      }),
    );

    act(() => {
      result.current.enterDiskConflictMergeView();
    });
    expect(result.current.mergeView?.kind).toBe('diskConflict');

    act(() => {
      result.current.applyMergedBodyFromMerge('# merged body');
    });

    expect(clearBlockingDiskConflictForMergedBody).toHaveBeenCalledTimes(1);
    expect(loadMarkdown).toHaveBeenCalledWith('# merged body', {selection: 'preserve'});
    expect(result.current.mergeView).toBeNull();
  });
});

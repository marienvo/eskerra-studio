import {describe, expect, it, vi} from 'vitest';

import {createEditorWorkspaceTab, tabCurrentUri} from '../lib/editorWorkspaceTabs';
import {normalizeWorkspaceUri, type WorkspaceModel} from '../lib/workspaceModel/types';
import {runOpenMarkdownInEditorCommand} from './workspaceOpenMarkdownCommand';
import * as workspaceRuntimeProjection from './workspaceRuntimeProjection';

function createBaseContext() {
  const selectedState = {value: null as string | null};
  const composingState = {value: false};
  const tabsState = {value: [] as Array<{id: string; history: {entries: string[]; index: number}}>} ;
  const activeTabState = {value: null as string | null};
  const backlinksState = {value: ''};
  const cacheState: Record<string, string> = {};

  const ctx = {
    fs: {readFile: vi.fn()} as never,
    openMarkdownGenerationRef: {current: 0},
    clearMergeViewForOpenRef: {current: vi.fn()},
    autosaveSchedulerRef: {current: {cancel: vi.fn()}},
    todayHubBridgeRef: {
      current: {
        getLiveRowUri: () => null,
        hasPendingHubFlush: () => false,
        flushPendingEdits: vi.fn(async () => undefined),
      },
    },
    diskConflictDeferTimerRef: {current: null as number | null},
    inboxEditorShellScrollRef: {current: null},
    selectedUriRef: {current: null as string | null},
    composingNewEntryRef: {current: false},
    editorShellScrollByUriRef: {current: new Map<string, {top: number; left: number}>()},
    inboxEditorShellScrollDirectiveRef: {current: null},
    clearStaleDiskConflictsForOpen: vi.fn(),
    vaultRootRef: {current: '/vault'},
    inboxContentByUriRef: {current: cacheState},
    lastPersistedRef: {current: null as {uri: string; markdown: string} | null},
    lastPersistedExternalMutationSeqRef: {current: 0},
    setLastPersistedSnapshot: vi.fn((next: {uri: string; markdown: string}) => {
      ctx.lastPersistedRef.current = next;
      ctx.lastPersistedExternalMutationSeqRef.current += 1;
    }),
    eagerEditorLoadUriRef: {current: null as string | null},
    backlinksActiveBodyRef: {current: ''},
    loadFullMarkdownIntoInboxEditor: vi.fn(),
    scheduleBacklinksDeferOneFrameAfterLoad: vi.fn(),
    setInboxContentByUri: vi.fn((update: unknown) => {
      if (typeof update === 'function') {
        const next = (update as (prev: Record<string, string>) => Record<string, string>)(
          ctx.inboxContentByUriRef.current,
        );
        ctx.inboxContentByUriRef.current = next;
      } else {
        ctx.inboxContentByUriRef.current = update as Record<string, string>;
      }
    }),
    setBacklinksActiveBody: vi.fn((v: string) => {
      backlinksState.value = v;
    }),
    setComposingNewEntry: vi.fn((v: boolean) => {
      composingState.value = v;
    }),
    setSelectedUri: vi.fn((v: string | null) => {
      selectedState.value = v;
    }),
    inboxEditorRef: {current: null},
    editorBodyRef: {current: ''},
    inboxYamlFrontmatterInnerRef: {current: null as string | null},
    inboxEditorYamlLeadingBeforeFrontmatterRef: {current: ''},
    mergeInboxNoteBodyCacheRefAndState: vi.fn(),
    enqueuePersistOutgoingNoteMarkdown: vi.fn(),
    setErr: vi.fn(),
    dispatchWorkspaceActionSync: vi.fn(),
    mirrorShadowActiveWorkspaceTabs: vi.fn(),
    mirrorShadowHomeSurface: vi.fn(),
    mirrorShadowActiveTab: vi.fn(),
    editorWorkspaceTabsRef: {current: tabsState.value},
    activeEditorTabIdRef: {current: null as string | null},
    activeTodayHubUriRef: {current: '/vault/A/Today.md' as string | null},
    setEditorWorkspaceTabs: vi.fn((tabs: Array<{id: string; history: {entries: string[]; index: number}}>) => {
      tabsState.value = tabs;
    }),
    setActiveEditorTabId: vi.fn((id: string | null) => {
      activeTabState.value = id;
    }),
    pushHomeHistoryForHub: vi.fn(),
  };

  return {ctx, selectedState, composingState, tabsState, activeTabState, backlinksState};
}

function workspaceModelWithRuntimeTabs(
  hubUri: string,
  tabs: ReturnType<typeof createEditorWorkspaceTab>[],
  activeTabId: string,
): WorkspaceModel {
  const hub = normalizeWorkspaceUri(hubUri);
  return {
    activeHub: hub,
    workspaces: {
      [hub]: {
        tabs: tabs.map(t => ({
          id: t.id,
          history: {
            entries: t.history.entries.map(e => normalizeWorkspaceUri(e)),
            index: t.history.index,
          },
        })),
        homeHistory: {entries: [hub], index: 0},
        active: {kind: 'tab', id: activeTabId},
      },
    },
  };
}

describe('workspaceOpenMarkdownCommand', () => {
  it('foreground open loads cached body and updates selection/tab state', async () => {
    const {ctx, selectedState, tabsState, activeTabState} = createBaseContext();
    ctx.inboxContentByUriRef.current['/vault/Inbox/a.md'] = '# cached';

    await runOpenMarkdownInEditorCommand(ctx as never, '/vault/Inbox/a.md');

    expect(ctx.loadFullMarkdownIntoInboxEditor).toHaveBeenCalledWith(
      '# cached',
      '/vault/Inbox/a.md',
      'start',
    );
    expect(selectedState.value).toBe('/vault/Inbox/a.md');
    expect(tabsState.value.length).toBe(1);
    expect(activeTabState.value).toBe(tabsState.value[0]!.id);
    expect(ctx.mirrorShadowActiveTab).toHaveBeenCalledTimes(1);
  });

  it('home open keeps Home surface and pushes hub history', async () => {
    const {ctx, tabsState, activeTabState} = createBaseContext();
    ctx.inboxContentByUriRef.current['/vault/A/Today.md'] = 'today';

    await runOpenMarkdownInEditorCommand(ctx as never, '/vault/A/Today.md', {home: true});

    expect(activeTabState.value).toBeNull();
    expect(ctx.mirrorShadowHomeSurface).toHaveBeenCalledTimes(1);
    expect(ctx.pushHomeHistoryForHub).toHaveBeenCalledWith(
      '/vault/A/Today.md',
      '/vault/A/Today.md',
    );
    expect(tabsState.value).toEqual([]);
  });

  it('background new tab warns in non-production when tab strip signature mismatches', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const resolveSpy = vi
      .spyOn(workspaceRuntimeProjection, 'resolveModelBackedLegacyTabStrip')
      .mockReturnValue({
        nextTabs: [
          {
            id: 'tab-bg',
            history: {entries: ['/vault/Inbox/bg.md'], index: 0},
          },
        ],
        derivedTabs: [],
        matched: false,
        mismatch: {kind: 'signature', legacySig: 'legacy-sig', derivedSig: 'derived-sig'},
      });

    const emptyModel: WorkspaceModel = {activeHub: null, workspaces: {}};
    const {ctx} = createBaseContext();
    ctx.inboxContentByUriRef.current['/vault/Inbox/bg.md'] = '# cached';
    ctx.dispatchWorkspaceActionSync = vi.fn((_reason, reducer) => reducer(emptyModel));

    try {
      await runOpenMarkdownInEditorCommand(ctx as never, '/vault/Inbox/bg.md', {
        newTab: true,
        activateNewTab: false,
      });

      expect(warnSpy).toHaveBeenCalledWith(
        '[workspaceModel] applyBackgroundNewTabOpen: model strip signature mismatch vs legacy; using legacy strip',
        {
          targetNorm: '/vault/Inbox/bg.md',
          legacySig: 'legacy-sig',
          derivedSig: 'derived-sig',
        },
      );
    } finally {
      warnSpy.mockRestore();
      resolveSpy.mockRestore();
    }
  });

  it('prefetch success updates inbox cache, last persisted snapshot, and external mutation seq before editor load runs', async () => {
    const {ctx} = createBaseContext();
    const target = '/vault/Inbox/prefetch.md';
    ctx.inboxContentByUriRef.current = {};
    ctx.fs.readFile = vi.fn(async () => '# from disk\n');

    ctx.loadFullMarkdownIntoInboxEditor = vi.fn(() => {
      expect(ctx.inboxContentByUriRef.current[target]).toBe('# from disk');
      expect(ctx.lastPersistedRef.current).toEqual({uri: target, markdown: '# from disk'});
      // Prefetch path bumps seq when merging disk-known body and again when wiring the editor load.
      expect(ctx.lastPersistedExternalMutationSeqRef.current).toBe(2);
    });

    await runOpenMarkdownInEditorCommand(ctx as never, target);

    expect(ctx.fs.readFile).toHaveBeenCalledWith(target, {encoding: 'utf8'});
    expect(ctx.loadFullMarkdownIntoInboxEditor).toHaveBeenCalledWith(
      '# from disk',
      target,
      'start',
    );
    expect(ctx.lastPersistedExternalMutationSeqRef.current).toBe(2);
  });

  it('snapshotAndPersistCurrentNoteBeforeOpen skips persist when composingNewEntryRef is true', async () => {
    const {ctx} = createBaseContext();
    ctx.selectedUriRef.current = '/vault/Inbox/current.md';
    ctx.composingNewEntryRef.current = true;
    ctx.inboxContentByUriRef.current['/vault/Inbox/current.md'] = '# cached current';
    ctx.inboxContentByUriRef.current['/vault/Inbox/other.md'] = '# other';

    await runOpenMarkdownInEditorCommand(ctx as never, '/vault/Inbox/other.md');

    expect(ctx.mergeInboxNoteBodyCacheRefAndState).not.toHaveBeenCalled();
    expect(ctx.enqueuePersistOutgoingNoteMarkdown).not.toHaveBeenCalled();
  });

  it('background new tab insertAtIndex vs insertAfterActive produce distinct tab order (three tabs)', async () => {
    const resolveSpy = vi
      .spyOn(workspaceRuntimeProjection, 'resolveModelBackedLegacyTabStrip')
      .mockImplementation((_m, nextTabsLegacy) => ({
        nextTabs: nextTabsLegacy,
        derivedTabs: nextTabsLegacy,
        matched: true,
        mismatch: null,
      }));

    const hub = '/vault/A/Today.md';
    const threeTabs = [
      createEditorWorkspaceTab('/vault/Inbox/0.md', 'tab-0'),
      createEditorWorkspaceTab('/vault/Inbox/1.md', 'tab-1'),
      createEditorWorkspaceTab('/vault/Inbox/2.md', 'tab-2'),
    ];
    const newUri = '/vault/Inbox/new.md';

    try {
      const baseModel = workspaceModelWithRuntimeTabs(hub, threeTabs, 'tab-1');

      const {ctx: ctxAt} = createBaseContext();
      ctxAt.editorWorkspaceTabsRef.current = threeTabs;
      ctxAt.activeEditorTabIdRef.current = 'tab-1';
      ctxAt.inboxContentByUriRef.current[newUri] = '# new';
      ctxAt.dispatchWorkspaceActionSync = vi.fn((_reason, reducer) => reducer(baseModel));

      await runOpenMarkdownInEditorCommand(ctxAt as never, newUri, {
        newTab: true,
        activateNewTab: false,
        insertAtIndex: 1,
      });

      const atIndexTabs = ctxAt.setEditorWorkspaceTabs.mock.calls.at(-1)?.[0] ?? [];
      const atIndexOrder = atIndexTabs.map(t => t.id);
      const newIdAt = atIndexTabs.find(t => tabCurrentUri(t) === newUri)!.id;
      expect(atIndexOrder).toEqual(['tab-0', newIdAt, 'tab-1', 'tab-2']);

      vi.mocked(ctxAt.setEditorWorkspaceTabs).mockClear();

      const {ctx: ctxAfter} = createBaseContext();
      ctxAfter.editorWorkspaceTabsRef.current = threeTabs;
      ctxAfter.activeEditorTabIdRef.current = 'tab-1';
      ctxAfter.inboxContentByUriRef.current[newUri] = '# new';
      ctxAfter.dispatchWorkspaceActionSync = vi.fn((_reason, reducer) => reducer(baseModel));

      await runOpenMarkdownInEditorCommand(ctxAfter as never, newUri, {
        newTab: true,
        activateNewTab: false,
        insertAfterActive: true,
      });

      const afterActiveTabs = ctxAfter.setEditorWorkspaceTabs.mock.calls.at(-1)?.[0] ?? [];
      const afterActiveOrder = afterActiveTabs.map(t => t.id);
      const newIdAfter = afterActiveTabs.find(t => tabCurrentUri(t) === newUri)!.id;
      expect(afterActiveOrder).toEqual(['tab-0', 'tab-1', newIdAfter, 'tab-2']);
    } finally {
      resolveSpy.mockRestore();
    }
  });

  it('bumps openMarkdownGenerationRef so an in-flight prefetch open is abandoned', async () => {
    const {ctx} = createBaseContext();
    ctx.inboxContentByUriRef.current = {};

    const readResolvers: Array<(v: string) => void> = [];
    ctx.fs.readFile = vi.fn(
      () =>
        new Promise<string>(resolve => {
          readResolvers.push(resolve);
        }),
    );

    const p1 = runOpenMarkdownInEditorCommand(ctx as never, '/vault/Inbox/a.md');
    const p2 = runOpenMarkdownInEditorCommand(ctx as never, '/vault/Inbox/b.md');

    expect(readResolvers.length).toBe(2);

    readResolvers[0]!('# A\n');
    await Promise.resolve();
    readResolvers[1]!('# B\n');

    await Promise.all([p1, p2]);

    expect(ctx.loadFullMarkdownIntoInboxEditor).toHaveBeenCalledTimes(1);
    expect(ctx.loadFullMarkdownIntoInboxEditor).toHaveBeenCalledWith(
      '# B',
      '/vault/Inbox/b.md',
      'start',
    );
    expect(ctx.selectedUriRef.current).toBe('/vault/Inbox/b.md');
  });
});

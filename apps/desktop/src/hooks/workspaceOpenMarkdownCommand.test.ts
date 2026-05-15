import {describe, expect, it, vi} from 'vitest';

import type {WorkspaceModel} from '../lib/workspaceModel/types';
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
});

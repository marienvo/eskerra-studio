import {describe, expect, it, vi} from 'vitest';

import {createEditorWorkspaceTab} from '../lib/editorWorkspaceTabs';
import {
  runActivateOpenTab,
  runRefocusAfterActiveTabRemoved,
  runReorderEditorWorkspaceTabs,
  runSelectNote,
  type TabCommandContext,
} from './workspaceTabCommands';

function buildCtx(overrides: Partial<TabCommandContext> = {}): TabCommandContext {
  const tab = createEditorWorkspaceTab('/vault/Inbox/a.md');
  const editorWorkspaceTabsRef = {current: [tab]};
  const activeEditorTabIdRef = {current: tab.id};
  const base: TabCommandContext = {
    busy: false,
    refs: {
      editorWorkspaceTabsRef,
      activeEditorTabIdRef,
      selectedUriRef: {current: null},
      composingNewEntryRef: {current: false},
      activeTodayHubUriRef: {current: null},
      flushInboxSaveRef: {current: vi.fn().mockResolvedValue(undefined)},
      saveChainRef: {current: Promise.resolve()},
      vaultRootRef: {current: '/vault'},
      notesRef: {current: []},
      editorClosedTabsStackRef: {current: []},
      editorShellScrollByUriRef: {current: new Map()},
      inboxYamlFrontmatterInnerRef: {current: null},
      inboxEditorYamlLeadingBeforeFrontmatterRef: {current: ''},
    },
    callbacks: {
      bumpEditorClosedStack: vi.fn(),
      dispatchWorkspaceActionSync: vi.fn(),
      replaceEditorWorkspaceTabs: vi.fn(),
      mirrorShadowActiveTab: vi.fn(),
      mirrorShadowHomeSurface: vi.fn(),
      openMarkdownInEditor: vi.fn().mockResolvedValue(undefined),
      selectHomeCurrentNote: vi.fn().mockResolvedValue(undefined),
      clearInboxSelection: vi.fn(),
    },
    setters: {
      setActiveEditorTabId: vi.fn(),
      setSelectedUri: vi.fn(),
      setComposingNewEntry: vi.fn(),
      setEditorBody: vi.fn(),
      setInboxYamlFrontmatterInner: vi.fn(),
      setInboxEditorYamlLeadingBeforeFrontmatter: vi.fn(),
      setInboxEditorResetNonce: vi.fn(),
      clearLastPersistedSnapshot: vi.fn(),
    },
  };
  return {...base, ...overrides, refs: {...base.refs, ...overrides.refs}, callbacks: {...base.callbacks, ...overrides.callbacks}, setters: {...base.setters, ...overrides.setters}};
}

describe('workspaceTabCommands', () => {
  it('runActivateOpenTab mirrors shadow and opens markdown for the tab URI', () => {
    const ctx = buildCtx();
    runActivateOpenTab(ctx, ctx.refs.editorWorkspaceTabsRef.current[0]!.id);
    expect(ctx.callbacks.mirrorShadowActiveTab).toHaveBeenCalledWith(
      ctx.refs.editorWorkspaceTabsRef.current[0]!.id,
      'activate open tab',
    );
    expect(ctx.callbacks.openMarkdownInEditor).toHaveBeenCalledWith('/vault/Inbox/a.md', {
      skipHistory: true,
    });
  });

  it('runReorderEditorWorkspaceTabs is a no-op when busy', () => {
    const ctx = buildCtx({busy: true});
    runReorderEditorWorkspaceTabs(ctx, 0, 1);
    expect(ctx.callbacks.dispatchWorkspaceActionSync).not.toHaveBeenCalled();
  });

  it('runSelectNote activates an existing tab instead of opening a duplicate', () => {
    const ctx = buildCtx();
    const tabId = ctx.refs.editorWorkspaceTabsRef.current[0]!.id;
    runSelectNote(ctx, '/vault/Inbox/a.md');
    expect(ctx.callbacks.mirrorShadowActiveTab).toHaveBeenCalledWith(tabId, 'activate open tab');
    expect(ctx.callbacks.openMarkdownInEditor).toHaveBeenCalledWith('/vault/Inbox/a.md', {
      skipHistory: true,
    });
  });

  it('runRefocusAfterActiveTabRemoved routes to hub home when wasOnHomeNoActiveTab is true', async () => {
    const tab = createEditorWorkspaceTab('/vault/Inbox/other.md');
    const ctx = buildCtx({
      refs: {
        editorWorkspaceTabsRef: {current: [tab]},
        activeEditorTabIdRef: {current: null},
        activeTodayHubUriRef: {current: '/vault/General/2025-01-06.md'},
      },
    });

    await runRefocusAfterActiveTabRemoved(
      ctx,
      '/vault/Inbox/deleted.md',
      [tab],
      null,
      {wasOnHomeNoActiveTab: true},
    );

    expect(ctx.callbacks.selectHomeCurrentNote).toHaveBeenCalledWith('/vault/General/2025-01-06.md');
    expect(ctx.callbacks.openMarkdownInEditor).not.toHaveBeenCalled();
  });

  it('runRefocusAfterActiveTabRemoved opens surviving tab URI when wasOnHomeNoActiveTab is false', async () => {
    const tab = createEditorWorkspaceTab('/vault/Inbox/other.md');
    const ctx = buildCtx({
      refs: {
        editorWorkspaceTabsRef: {current: [tab]},
        activeEditorTabIdRef: {current: tab.id},
        activeTodayHubUriRef: {current: '/vault/General/2025-01-06.md'},
      },
    });

    await runRefocusAfterActiveTabRemoved(
      ctx,
      '/vault/Inbox/deleted.md',
      [tab],
      tab.id,
      {wasOnHomeNoActiveTab: false},
    );

    expect(ctx.callbacks.openMarkdownInEditor).toHaveBeenCalledWith('/vault/Inbox/other.md', {
      skipHistory: true,
    });
    expect(ctx.callbacks.selectHomeCurrentNote).not.toHaveBeenCalled();
  });
});

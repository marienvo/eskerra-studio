import {describe, expect, it, vi, beforeEach} from 'vitest';

import {SubtreeMarkdownPresenceCache} from '@eskerra/core';

import {
  createEditorWorkspaceTab,
  remapAllTabsUriPrefix,
  tabCurrentUri,
  type EditorWorkspaceTab,
} from '../lib/editorWorkspaceTabs';
import {normalizeEditorDocUri} from '../lib/editorDocumentHistory';
import * as vaultBootstrap from '../lib/vaultBootstrap';
import {
  runBulkDeletePruneTabsAndScroll,
  runBulkDeleteRemoveVaultEntry,
  runBulkMoveVaultTreeItems,
  runCommitMoveVaultTreeResult,
  runDeleteFolder,
  runDeleteNote,
  runMoveVaultTreeItem,
  runRenameFolder,
  type TreeCommandContext,
} from './workspaceTreeCommands';
import type {VaultTreeBulkItem} from '../lib/vaultTreeBulkPlan';

vi.mock('../lib/vaultBootstrap', async importOriginal => {
  const actual = await importOriginal<typeof import('../lib/vaultBootstrap')>();
  return {
    ...actual,
    deleteVaultMarkdownNote: vi.fn(async () => undefined),
    deleteVaultTreeDirectory: vi.fn(async () => undefined),
    renameVaultTreeDirectory: vi.fn(async () => '/vault/Inbox/Renamed'),
    moveVaultTreeItemToDirectory: vi.fn(async () => ({
      previousUri: '/vault/Inbox/x.md',
      nextUri: '/vault/Inbox/y.md',
      movedKind: 'article' as const,
    })),
  };
});

function buildCtx(overrides: Partial<TreeCommandContext> = {}): TreeCommandContext {
  const tab = createEditorWorkspaceTab('/vault/Inbox/a.md');

  const editorWorkspaceTabsRef = {current: [tab]};
  const replaceEditorWorkspaceTabs = vi.fn((nextTabs: EditorWorkspaceTab[]) => {
    editorWorkspaceTabsRef.current = nextTabs;
  });
  const activeEditorTabIdRef = {current: tab.id};
  const selectedUriRef = {current: normalizeEditorDocUri('/vault/Inbox/a.md')};
  const composingNewEntryRef = {current: false};
  const inboxYamlFrontmatterInnerRef = {current: null as string | null};
  const inboxEditorYamlLeadingBeforeFrontmatterRef = {current: ''};
  const lastPersistedRef = {current: {uri: '/vault/Inbox/a.md', markdown: '# x'}};
  const lastPersistedExternalMutationSeqRef = {current: 0};
  const editorShellScrollByUriRef = {
    current: new Map<string, {top: number; left: number}>(),
  };

  const base: TreeCommandContext = {
    vaultRoot: '/vault',
    fs: {} as never,
    subtreeMarkdownCache: new SubtreeMarkdownPresenceCache(),
    refs: {
      autosaveSchedulerRef: {current: {cancel: vi.fn(), schedule: vi.fn()}},
      saveChainRef: {current: Promise.resolve()},
      editorWorkspaceTabsRef,
      activeEditorTabIdRef,
      selectedUriRef,
      composingNewEntryRef,
      editorShellScrollByUriRef,
      inboxYamlFrontmatterInnerRef,
      inboxEditorYamlLeadingBeforeFrontmatterRef,
      lastPersistedRef,
      lastPersistedExternalMutationSeqRef,
    },
    setters: {
      setEditorWorkspaceTabs: vi.fn(),
      setActiveEditorTabId: vi.fn(),
      setInboxContentByUri: vi.fn(),
      setBusy: vi.fn(),
      setErr: vi.fn(),
      setFsRefreshNonce: vi.fn(),
      setSelectedUri: vi.fn(),
      setComposingNewEntry: vi.fn(),
      setEditorBody: vi.fn(),
      setInboxYamlFrontmatterInner: vi.fn(),
      setInboxEditorYamlLeadingBeforeFrontmatter: vi.fn(),
      setInboxEditorResetNonce: vi.fn(),
    },
    mirrorShadowHomeSurface: vi.fn(),
    mirrorShadowActiveTab: vi.fn(),
    removeHomeHistoryUris: vi.fn(),
    markVaultWriteSettled: vi.fn(),
    refreshNotes: vi.fn(async () => undefined),
    refocusAfterActiveTabRemoved: vi.fn(async () => undefined),
    openMarkdownInEditor: vi.fn(async () => undefined),
    flushInboxSaveRef: {current: vi.fn(async () => undefined)},
    clearRenameNotice: vi.fn(),
    replaceEditorWorkspaceTabs,
    remapHomeStatesPrefix: vi.fn(),
    clearInboxSelection: vi.fn(),
    setVaultTreeSelectionClearNonce: vi.fn(),
  };

  return {...base, ...overrides};
}

describe('workspaceTreeCommands', () => {
  beforeEach(() => {
    vi.mocked(vaultBootstrap.deleteVaultMarkdownNote).mockClear();
    vi.mocked(vaultBootstrap.deleteVaultTreeDirectory).mockClear();
    vi.mocked(vaultBootstrap.renameVaultTreeDirectory).mockClear();
    vi.mocked(vaultBootstrap.renameVaultTreeDirectory).mockResolvedValue('/vault/Inbox/Renamed');
    vi.mocked(vaultBootstrap.moveVaultTreeItemToDirectory).mockClear();
    vi.mocked(vaultBootstrap.moveVaultTreeItemToDirectory).mockResolvedValue({
      previousUri: '/vault/Inbox/x.md',
      nextUri: '/vault/Inbox/y.md',
      movedKind: 'article',
    });
  });

  it('runDeleteNote returns early when vaultRoot is null', async () => {
    const ctx = buildCtx({vaultRoot: null});
    await runDeleteNote(ctx, '/vault/Inbox/a.md');
    expect(vaultBootstrap.deleteVaultMarkdownNote).not.toHaveBeenCalled();
  });

  it('runDeleteNote removes file, prunes tabs, and calls refocus when the note was open', async () => {
    const ctx = buildCtx();
    const uri = '/vault/Inbox/a.md';
    const norm = normalizeEditorDocUri(uri);
    await runDeleteNote(ctx, uri);

    expect(vaultBootstrap.deleteVaultMarkdownNote).toHaveBeenCalledWith('/vault', uri, ctx.fs);
    expect(ctx.setters.setEditorWorkspaceTabs).toHaveBeenCalled();
    expect(ctx.removeHomeHistoryUris).toHaveBeenCalled();
    expect(ctx.refs.editorShellScrollByUriRef.current.has(norm)).toBe(false);
    expect(ctx.refocusAfterActiveTabRemoved).toHaveBeenCalledWith(
      norm,
      ctx.refs.editorWorkspaceTabsRef.current,
      ctx.refs.activeEditorTabIdRef.current,
    );
    expect(ctx.markVaultWriteSettled).toHaveBeenCalled();
    expect(ctx.refreshNotes).toHaveBeenCalledWith('/vault');
  });

  it('runDeleteFolder clears inbox selection under the folder and opens next survivor', async () => {
    const tabKeep = createEditorWorkspaceTab('/vault/Inbox/keep.md');
    const tabNested = createEditorWorkspaceTab('/vault/Inbox/Sub/nested.md');

    const editorWorkspaceTabsRef = {current: [tabKeep, tabNested]};
    const activeEditorTabIdRef = {current: tabNested.id};
    const selectedUriRef = {current: normalizeEditorDocUri('/vault/Inbox/Sub/nested.md')};
    const lastPersistedRef = {current: {uri: '/vault/Inbox/Sub/nested.md', markdown: 'x'}};
    const lastPersistedExternalMutationSeqRef = {current: 0};
    const composingNewEntryRef = {current: false};
    const inboxYamlFrontmatterInnerRef = {current: null as string | null};
    const inboxEditorYamlLeadingBeforeFrontmatterRef = {current: ''};
    const editorShellScrollByUriRef = {
      current: new Map<string, {top: number; left: number}>(),
    };

    const ctx = buildCtx({
      refs: {
        autosaveSchedulerRef: {current: {cancel: vi.fn(), schedule: vi.fn()}},
        saveChainRef: {current: Promise.resolve()},
        editorWorkspaceTabsRef,
        activeEditorTabIdRef,
        selectedUriRef,
        composingNewEntryRef,
        editorShellScrollByUriRef,
        inboxYamlFrontmatterInnerRef,
        inboxEditorYamlLeadingBeforeFrontmatterRef,
        lastPersistedRef,
        lastPersistedExternalMutationSeqRef,
      },
    });

    await runDeleteFolder(ctx, '/vault/Inbox/Sub');

    expect(vaultBootstrap.deleteVaultTreeDirectory).toHaveBeenCalledWith(
      '/vault',
      '/vault/Inbox/Sub',
      ctx.fs,
    );
    expect(ctx.setters.setSelectedUri).toHaveBeenCalledWith(null);
    expect(ctx.setters.setComposingNewEntry).toHaveBeenCalledWith(false);
    expect(ctx.refs.lastPersistedRef.current).toBe(null);
    expect(ctx.openMarkdownInEditor).toHaveBeenCalledWith('/vault/Inbox/keep.md', {
      skipHistory: true,
    });
  });

  it('runRenameFolder returns early when vaultRoot is null', async () => {
    const ctx = buildCtx({vaultRoot: null});
    await runRenameFolder(ctx, '/vault/Inbox/Old', 'New');
    expect(vaultBootstrap.renameVaultTreeDirectory).not.toHaveBeenCalled();
  });

  it('runRenameFolder flushes inbox save, clears rename notice, then renames on disk', async () => {
    const order: string[] = [];
    const ctx = buildCtx({
      flushInboxSaveRef: {
        current: vi.fn(async () => {
          order.push('flush');
        }),
      },
      clearRenameNotice: vi.fn(() => {
        order.push('clear');
      }),
    });
    vi.mocked(vaultBootstrap.renameVaultTreeDirectory).mockImplementation(async () => {
      order.push('rename');
      return '/vault/Inbox/Renamed';
    });

    await runRenameFolder(ctx, '/vault/Inbox/Old', 'Renamed');

    expect(order).toEqual(['flush', 'clear', 'rename']);
    expect(vaultBootstrap.renameVaultTreeDirectory).toHaveBeenCalledWith(
      '/vault',
      '/vault/Inbox/Old',
      'Renamed',
      ctx.fs,
    );
  });

  it('runRenameFolder remaps tabs and home history the same way as wiki-link rename commit', async () => {
    const oldPrefix = '/vault/Inbox/OldDir';
    const newPrefix = '/vault/Inbox/NewDir';
    const tab = createEditorWorkspaceTab(`${oldPrefix}/note.md`);
    const editorWorkspaceTabsRef = {current: [tab]};
    const replaceEditorWorkspaceTabs = vi.fn((nextTabs: EditorWorkspaceTab[]) => {
      editorWorkspaceTabsRef.current = nextTabs;
    });
    const remapHomeStatesPrefix = vi.fn();

    vi.mocked(vaultBootstrap.renameVaultTreeDirectory).mockResolvedValue(newPrefix);

    const ctx = buildCtx({
      refs: {
        autosaveSchedulerRef: {current: {cancel: vi.fn(), schedule: vi.fn()}},
        saveChainRef: {current: Promise.resolve()},
        editorWorkspaceTabsRef,
        activeEditorTabIdRef: {current: tab.id},
        selectedUriRef: {current: normalizeEditorDocUri(`${oldPrefix}/note.md`)},
        composingNewEntryRef: {current: false},
        editorShellScrollByUriRef: {
          current: new Map<string, {top: number; left: number}>(),
        },
        inboxYamlFrontmatterInnerRef: {current: null},
        inboxEditorYamlLeadingBeforeFrontmatterRef: {current: ''},
        lastPersistedRef: {current: {uri: `${oldPrefix}/note.md`, markdown: 'x'}},
        lastPersistedExternalMutationSeqRef: {current: 0},
      },
      replaceEditorWorkspaceTabs,
      remapHomeStatesPrefix,
    });

    const expectedTabs = remapAllTabsUriPrefix([tab], oldPrefix, newPrefix);

    await runRenameFolder(ctx, oldPrefix, 'NewDir');

    expect(replaceEditorWorkspaceTabs).toHaveBeenCalledWith(expectedTabs);
    expect(remapHomeStatesPrefix).toHaveBeenCalledWith(oldPrefix, newPrefix);
    expect(ctx.refs.selectedUriRef.current).toBe(normalizeEditorDocUri(`${newPrefix}/note.md`));
  });

  it('runCommitMoveVaultTreeResult skips tab and home updates when URIs are unchanged', () => {
    const ctx = buildCtx();
    runCommitMoveVaultTreeResult(ctx, {
      previousUri: '/vault/Inbox/same.md',
      nextUri: '/vault/Inbox/same.md',
      movedKind: 'article',
    });
    expect(ctx.replaceEditorWorkspaceTabs).not.toHaveBeenCalled();
    expect(ctx.remapHomeStatesPrefix).not.toHaveBeenCalled();
  });

  it('runMoveVaultTreeItem updates the tab strip via replaceEditorWorkspaceTabs', async () => {
    const prev = '/vault/Inbox/moveMe.md';
    const next = '/vault/Inbox/Dest/moveMe.md';
    const tab = createEditorWorkspaceTab(prev);
    const editorWorkspaceTabsRef = {current: [tab]};
    const replaceEditorWorkspaceTabs = vi.fn((nextTabs: EditorWorkspaceTab[]) => {
      editorWorkspaceTabsRef.current = nextTabs;
    });
    const remapHomeStatesPrefix = vi.fn();

    vi.mocked(vaultBootstrap.moveVaultTreeItemToDirectory).mockResolvedValue({
      previousUri: prev,
      nextUri: next,
      movedKind: 'article',
    });

    const ctx = buildCtx({
      refs: {
        autosaveSchedulerRef: {current: {cancel: vi.fn(), schedule: vi.fn()}},
        saveChainRef: {current: Promise.resolve()},
        editorWorkspaceTabsRef,
        activeEditorTabIdRef: {current: tab.id},
        selectedUriRef: {current: normalizeEditorDocUri(prev)},
        composingNewEntryRef: {current: false},
        editorShellScrollByUriRef: {
          current: new Map<string, {top: number; left: number}>(),
        },
        inboxYamlFrontmatterInnerRef: {current: null},
        inboxEditorYamlLeadingBeforeFrontmatterRef: {current: ''},
        lastPersistedRef: {current: {uri: prev, markdown: 'x'}},
        lastPersistedExternalMutationSeqRef: {current: 0},
      },
      replaceEditorWorkspaceTabs,
      remapHomeStatesPrefix,
    });

    const expectedTabs = remapAllTabsUriPrefix([tab], prev, next);
    await runMoveVaultTreeItem(ctx, prev, 'article', '/vault/Inbox/Dest');

    expect(replaceEditorWorkspaceTabs).toHaveBeenCalledWith(expectedTabs);
    expect(remapHomeStatesPrefix).toHaveBeenCalledWith(prev, next);
    expect(ctx.markVaultWriteSettled).toHaveBeenCalled();
  });

  it('runBulkDeletePruneTabsAndScroll removes matching tab URIs and scroll snapshot keys', () => {
    const tabKeep = createEditorWorkspaceTab('/vault/Inbox/keep.md');
    const tabDrop = createEditorWorkspaceTab('/vault/Inbox/drop.md');
    const normDrop = normalizeEditorDocUri('/vault/Inbox/drop.md');
    const editorWorkspaceTabsRef = {current: [tabKeep, tabDrop]};
    const activeEditorTabIdRef = {current: tabDrop.id};
    const editorShellScrollByUriRef = {
      current: new Map<string, {top: number; left: number}>([
        [normDrop, {top: 1, left: 0}],
        [normalizeEditorDocUri('/vault/Inbox/keep.md'), {top: 2, left: 0}],
      ]),
    };

    const ctx = buildCtx({
      refs: {
        autosaveSchedulerRef: {current: {cancel: vi.fn(), schedule: vi.fn()}},
        saveChainRef: {current: Promise.resolve()},
        editorWorkspaceTabsRef,
        activeEditorTabIdRef,
        selectedUriRef: {current: normDrop},
        composingNewEntryRef: {current: false},
        editorShellScrollByUriRef,
        inboxYamlFrontmatterInnerRef: {current: null},
        inboxEditorYamlLeadingBeforeFrontmatterRef: {current: ''},
        lastPersistedRef: {current: null},
        lastPersistedExternalMutationSeqRef: {current: 0},
      },
    });

    const plan: VaultTreeBulkItem[] = [{kind: 'article', uri: '/vault/Inbox/drop.md'}];
    const {newTabs} = runBulkDeletePruneTabsAndScroll(ctx, plan);

    expect(newTabs).toHaveLength(1);
    expect(tabCurrentUri(newTabs[0]!)).toBe('/vault/Inbox/keep.md');
    expect(editorShellScrollByUriRef.current.has(normDrop)).toBe(false);
    expect(ctx.removeHomeHistoryUris).toHaveBeenCalled();
  });

  it('runBulkDeleteRemoveVaultEntry deletes article body from cache', async () => {
    const setInboxContentByUri = vi.fn();
    const base = buildCtx();
    const ctx: TreeCommandContext = {
      ...base,
      setters: {...base.setters, setInboxContentByUri},
    };
    await runBulkDeleteRemoveVaultEntry(ctx, {kind: 'article', uri: '/vault/Inbox/z.md'}, '/vault');
    expect(vaultBootstrap.deleteVaultMarkdownNote).toHaveBeenCalledWith(
      '/vault',
      '/vault/Inbox/z.md',
      ctx.fs,
    );
    expect(setInboxContentByUri).toHaveBeenCalled();
  });

  it('runBulkMoveVaultTreeItems invokes move once per filtered source', async () => {
    const ctx = buildCtx();
    await runBulkMoveVaultTreeItems(
      ctx,
      [{kind: 'article', uri: '/vault/Inbox/one.md'}],
      '/vault/Inbox/Dest',
    );
    expect(vaultBootstrap.moveVaultTreeItemToDirectory).toHaveBeenCalledTimes(1);
    expect(vaultBootstrap.moveVaultTreeItemToDirectory).toHaveBeenCalledWith('/vault', ctx.fs, {
      sourceUri: '/vault/Inbox/one.md',
      sourceKind: 'article',
      targetDirectoryUri: '/vault/Inbox/Dest',
    });
    expect(ctx.setVaultTreeSelectionClearNonce).toHaveBeenCalled();
  });
});

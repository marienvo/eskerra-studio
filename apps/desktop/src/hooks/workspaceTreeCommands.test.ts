import {describe, expect, it, vi, beforeEach} from 'vitest';

import {SubtreeMarkdownPresenceCache} from '@eskerra/core';

import {
  createEditorWorkspaceTab,
  remapAllTabsUriPrefix,
  type EditorWorkspaceTab,
} from '../lib/editorWorkspaceTabs';
import {normalizeEditorDocUri} from '../lib/editorDocumentHistory';
import * as vaultBootstrap from '../lib/vaultBootstrap';
import {runDeleteFolder, runDeleteNote, runRenameFolder, type TreeCommandContext} from './workspaceTreeCommands';

vi.mock('../lib/vaultBootstrap', async importOriginal => {
  const actual = await importOriginal<typeof import('../lib/vaultBootstrap')>();
  return {
    ...actual,
    deleteVaultMarkdownNote: vi.fn(async () => undefined),
    deleteVaultTreeDirectory: vi.fn(async () => undefined),
    renameVaultTreeDirectory: vi.fn(async () => '/vault/Inbox/Renamed'),
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
  };

  return {...base, ...overrides};
}

describe('workspaceTreeCommands', () => {
  beforeEach(() => {
    vi.mocked(vaultBootstrap.deleteVaultMarkdownNote).mockClear();
    vi.mocked(vaultBootstrap.deleteVaultTreeDirectory).mockClear();
    vi.mocked(vaultBootstrap.renameVaultTreeDirectory).mockClear();
    vi.mocked(vaultBootstrap.renameVaultTreeDirectory).mockResolvedValue('/vault/Inbox/Renamed');
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
});

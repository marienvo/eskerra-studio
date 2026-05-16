import {beforeEach, describe, expect, it, vi} from 'vitest';

import {SubtreeMarkdownPresenceCache} from '@eskerra/core';

import * as persistTransientMarkdownImages from '../lib/persistTransientMarkdownImages';
import * as vaultBootstrap from '../lib/vaultBootstrap';
import {
  runAddNote,
  runCancelNewEntry,
  runCleanNoteInbox,
  runStartNewEntry,
  runSubmitNewEntry,
  type ComposeCommandsContext,
} from './workspaceComposeCommands';

vi.mock('../lib/vaultBootstrap', () => ({
  createInboxMarkdownNote: vi.fn(),
}));

vi.mock('../lib/persistTransientMarkdownImages', () => ({
  persistTransientMarkdownImages: vi.fn(async (md: string) => md),
}));

function createContext(): ComposeCommandsContext {
  return {
    fs: {} as never,
    vaultRoot: '/vault',
    subtreeMarkdownCache: new SubtreeMarkdownPresenceCache(),
    markVaultWriteSettled: vi.fn(),
    refreshNotes: vi.fn(async () => undefined),
    flushInboxSave: vi.fn(async () => undefined),
    scheduleBacklinksDeferOneFrameAfterLoad: vi.fn(),
    loadFullMarkdownIntoInboxEditor: vi.fn(),
    resetInboxEditorComposeState: vi.fn(),
    todayHubCleanRowBlocked: vi.fn(() => false),
    showTodayHubCanvasRef: {current: false},
    todayHubBridgeRef: {
      current: {
        flushPendingEdits: vi.fn(async () => undefined),
        cleanHubPageDayColumns: vi.fn(async () => undefined),
      },
    },
    inboxEditorRef: {current: null},
    refs: {
      selectedUriRef: {current: '/vault/Inbox/note.md'},
      composingNewEntryRef: {current: false},
      inboxEditorShellScrollDirectiveRef: {current: null},
      diskConflictRef: {current: {uri: '/vault/Inbox/x.md', diskMarkdown: '# disk'}},
      diskConflictSoftRef: {current: {uri: '/vault/Inbox/y.md', diskMarkdown: '# disk'}},
      lastPersistedRef: {current: {uri: '/vault/Inbox/note.md', markdown: '# last'}},
      editorBodyRef: {current: '# body'},
      inboxYamlFrontmatterInnerRef: {current: null},
      inboxEditorYamlLeadingBeforeFrontmatterRef: {current: ''},
      inboxContentByUriRef: {current: {}},
    },
    setters: {
      setBusy: vi.fn(),
      setErr: vi.fn(),
      setFsRefreshNonce: vi.fn(),
      setEditorBody: vi.fn(),
      setComposingNewEntry: vi.fn(),
      setSelectedUri: vi.fn(),
      setDiskConflict: vi.fn(),
      setDiskConflictSoft: vi.fn(),
      setInboxContentByUri: vi.fn(),
      clearLastPersistedSnapshot: vi.fn(),
    },
    openMarkdownInEditor: vi.fn(async () => undefined),
  };
}

describe('workspaceComposeCommands', () => {
  beforeEach(() => {
    vi.mocked(vaultBootstrap.createInboxMarkdownNote).mockClear();
    vi.mocked(vaultBootstrap.createInboxMarkdownNote).mockResolvedValue({
      lastModified: 1,
      name: 'new.md',
      uri: '/vault/Inbox/new.md',
    });
    vi.mocked(persistTransientMarkdownImages.persistTransientMarkdownImages).mockClear();
    vi.mocked(persistTransientMarkdownImages.persistTransientMarkdownImages).mockImplementation(
      async (md: string) => md,
    );
  });

  it('start/cancel new entry flushes saves and resets compose state', async () => {
    const ctx = createContext();

    runStartNewEntry(ctx);
    await Promise.resolve();
    await Promise.resolve();

    expect(ctx.flushInboxSave).toHaveBeenCalledTimes(1);
    expect(ctx.setters.setErr).toHaveBeenCalledWith(null);
    expect(ctx.setters.setDiskConflict).toHaveBeenCalledWith(null);
    expect(ctx.setters.setDiskConflictSoft).toHaveBeenCalledWith(null);
    expect(ctx.refs.diskConflictRef.current).toBeNull();
    expect(ctx.refs.diskConflictSoftRef.current).toBeNull();
    expect(ctx.setters.setComposingNewEntry).toHaveBeenCalledWith(true);
    expect(ctx.setters.setSelectedUri).toHaveBeenCalledWith(null);
    expect(ctx.setters.clearLastPersistedSnapshot).toHaveBeenCalledTimes(1);
    expect(ctx.refs.inboxEditorShellScrollDirectiveRef.current).toEqual({kind: 'snapTop'});
    expect(ctx.resetInboxEditorComposeState).toHaveBeenCalledTimes(1);

    runCancelNewEntry(ctx);
    await Promise.resolve();
    await Promise.resolve();

    expect(ctx.flushInboxSave).toHaveBeenCalledTimes(2);
    expect(ctx.setters.setComposingNewEntry).toHaveBeenCalledWith(false);
    expect(ctx.resetInboxEditorComposeState).toHaveBeenCalledTimes(2);
  });

  it('submit new entry validates first line before creating note', async () => {
    const ctx = createContext();
    await runSubmitNewEntry(ctx, '   \nbody');

    expect(ctx.setters.setErr).toHaveBeenLastCalledWith('First line is required.');
    expect(ctx.setters.setBusy).not.toHaveBeenCalled();
    expect(ctx.openMarkdownInEditor).not.toHaveBeenCalled();
  });

  it('clean note inbox is blocked when disk conflict blocks selected uri', () => {
    const ctx = createContext();
    ctx.todayHubCleanRowBlocked = vi.fn(() => true);

    runCleanNoteInbox(ctx);

    expect(ctx.loadFullMarkdownIntoInboxEditor).not.toHaveBeenCalled();
    expect(ctx.scheduleBacklinksDeferOneFrameAfterLoad).not.toHaveBeenCalled();
  });

  it('runAddNote is a no-op without a vault root', async () => {
    const ctx = createContext();
    ctx.vaultRoot = null;

    await runAddNote(ctx, 'Title', '# body');

    expect(ctx.setters.setBusy).not.toHaveBeenCalled();
    expect(vaultBootstrap.createInboxMarkdownNote).not.toHaveBeenCalled();
  });

  it('runAddNote surfaces create failures on setErr', async () => {
    const ctx = createContext();
    vi.mocked(vaultBootstrap.createInboxMarkdownNote).mockRejectedValueOnce(
      new Error('write failed'),
    );

    await runAddNote(ctx, 'Title', '# body');

    expect(ctx.setters.setBusy).toHaveBeenCalledWith(true);
    expect(ctx.setters.setBusy).toHaveBeenLastCalledWith(false);
    expect(ctx.setters.setErr).toHaveBeenCalledWith('write failed');
    expect(ctx.openMarkdownInEditor).not.toHaveBeenCalled();
  });

  it('runSubmitNewEntry surfaces persistTransientMarkdownImages failures', async () => {
    const ctx = createContext();
    vi.mocked(persistTransientMarkdownImages.persistTransientMarkdownImages).mockRejectedValueOnce(
      new Error('persist failed'),
    );

    await runSubmitNewEntry(ctx, 'Title line\nbody');

    expect(ctx.setters.setErr).toHaveBeenLastCalledWith('persist failed');
    expect(vaultBootstrap.createInboxMarkdownNote).not.toHaveBeenCalled();
  });

  it('runSubmitNewEntry blocks create when images stay transient after persist', async () => {
    const ctx = createContext();
    vi.mocked(persistTransientMarkdownImages.persistTransientMarkdownImages).mockResolvedValue(
      '![](blob:http://localhost/abc)',
    );

    await runSubmitNewEntry(ctx, 'Title line\nbody');

    expect(ctx.setters.setErr).toHaveBeenLastCalledWith(
      expect.stringContaining('Cannot create this note'),
    );
    expect(vaultBootstrap.createInboxMarkdownNote).not.toHaveBeenCalled();
  });

  it('runSubmitNewEntry creates note and opens editor on success', async () => {
    const ctx = createContext();

    await runSubmitNewEntry(ctx, 'My note title\nBody here');

    expect(vaultBootstrap.createInboxMarkdownNote).toHaveBeenCalled();
    expect(ctx.openMarkdownInEditor).toHaveBeenCalledWith('/vault/Inbox/new.md');
  });

  it('runCleanNoteInbox triggers Today hub bridge when canvas is visible', async () => {
    const ctx = createContext();
    ctx.showTodayHubCanvasRef.current = true;

    runCleanNoteInbox(ctx);
    await Promise.resolve();
    await Promise.resolve();

    expect(ctx.todayHubBridgeRef.current.flushPendingEdits).toHaveBeenCalled();
    expect(ctx.todayHubBridgeRef.current.cleanHubPageDayColumns).toHaveBeenCalled();
  });
});

import {describe, expect, it, vi} from 'vitest';

import {SubtreeMarkdownPresenceCache} from '@eskerra/core';

import {
  runCancelNewEntry,
  runCleanNoteInbox,
  runStartNewEntry,
  runSubmitNewEntry,
  type ComposeCommandsContext,
} from './workspaceComposeCommands';

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
  it('start/cancel new entry flushes saves and resets compose state', async () => {
    const ctx = createContext();

    runStartNewEntry(ctx);
    await Promise.resolve();
    await Promise.resolve();

    expect(ctx.flushInboxSave).toHaveBeenCalledTimes(1);
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
});

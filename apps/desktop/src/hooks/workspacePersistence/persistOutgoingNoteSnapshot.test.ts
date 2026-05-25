import {beforeEach, describe, expect, it, vi} from 'vitest';

import {persistOutgoingNoteSnapshot} from './persistOutgoingNoteSnapshot';

vi.mock('../../lib/persistTransientMarkdownImages', () => ({
  persistTransientMarkdownImages: vi.fn(async (md: string) => md),
}));

vi.mock('../../lib/vaultBootstrap', () => ({
  saveNoteMarkdown: vi.fn(async () => undefined),
}));

import {saveNoteMarkdown} from '../../lib/vaultBootstrap';

function makeDeps() {
  const inboxContentByUriRef = {current: {} as Record<string, string>};
  const selectedUriRef = {current: null as string | null};
  const setLastPersistedSnapshot = vi.fn();

  return {
    fs: {} as never,
    norm: '/vault/Inbox/A.md',
    leaveSnapshotMarkdown: 'leave-body',
    refs: {
      vaultRootRef: {current: '/vault'},
      selectedUriRef,
      diskConflictRef: {current: null},
      inboxContentByUriRef,
      composingNewEntryRef: {current: false},
      editorBodyRef: {current: ''},
      openTimeDiskBodyRef: {current: ''},
      lastPersistedRef: {current: null},
      inboxYamlFrontmatterInnerRef: {current: null},
      inboxEditorYamlLeadingBeforeFrontmatterRef: {current: ''},
      inboxEditorRef: {current: null},
      todayHubBridgeRef: {current: {flushPendingEdits: async () => undefined}},
      submitNewEntryRef: {current: async () => undefined},
    },
    actions: {
      setErr: vi.fn(),
      setInboxContentByUri: vi.fn(),
      setLastPersistedSnapshot,
      refreshNotes: vi.fn(async () => undefined),
      onVaultWriteSettled: vi.fn(),
      loadFullMarkdownIntoInboxEditor: vi.fn(),
      scheduleBacklinksDeferOneFrameAfterLoad: vi.fn(),
    },
    setLastPersistedSnapshot,
    inboxContentByUriRef,
  };
}

describe('persistOutgoingNoteSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips when cache advanced after note leave', async () => {
    const d = makeDeps();
    d.inboxContentByUriRef.current[d.norm] = 'edited-after-reopen';
    await persistOutgoingNoteSnapshot(d);
    expect(saveNoteMarkdown).not.toHaveBeenCalled();
  });

  it('skips disk write when cache diverged before write', async () => {
    const d = makeDeps();
    d.inboxContentByUriRef.current[d.norm] = 'user-edited-while-saving';
    await persistOutgoingNoteSnapshot(d);
    expect(saveNoteMarkdown).not.toHaveBeenCalled();
  });

  it('persists and updates lastPersisted when note is still active', async () => {
    const d = makeDeps();
    d.refs.selectedUriRef.current = d.norm;
    await persistOutgoingNoteSnapshot(d);
    expect(saveNoteMarkdown).toHaveBeenCalledWith(d.norm, d.fs, 'leave-body');
    expect(d.setLastPersistedSnapshot).toHaveBeenCalledWith({
      uri: d.norm,
      markdown: 'leave-body',
    });
  });
});

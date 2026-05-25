import {beforeEach, describe, expect, it, vi} from 'vitest';

import {persistActiveInboxNote} from './persistActiveInboxNote';

vi.mock('../../lib/persistTransientMarkdownImages', () => ({
  persistTransientMarkdownImages: vi.fn(async (md: string) => md),
}));

vi.mock('../../lib/vaultBootstrap', () => ({
  saveNoteMarkdown: vi.fn(async () => undefined),
}));

import {saveNoteMarkdown} from '../../lib/vaultBootstrap';

function makeDeps(uri: string) {
  const setLastPersistedSnapshot = vi.fn();
  return {
    fs: {} as never,
    refs: {
      vaultRootRef: {current: '/vault'},
      selectedUriRef: {current: uri},
      composingNewEntryRef: {current: false},
      diskConflictRef: {current: null},
      inboxContentByUriRef: {current: {} as Record<string, string>},
      editorBodyRef: {current: 'new-body'},
      openTimeDiskBodyRef: {current: ''},
      lastPersistedRef: {current: {uri, markdown: 'old'}},
      inboxYamlFrontmatterInnerRef: {current: null},
      inboxEditorYamlLeadingBeforeFrontmatterRef: {current: ''},
      inboxEditorRef: {current: {getMarkdown: () => 'new-body'}},
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
  };
}

describe('persistActiveInboxNote', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not update lastPersisted when selection changed after save', async () => {
    const uri = '/vault/Inbox/A.md';
    const d = makeDeps(uri);
    d.actions.refreshNotes = vi.fn(async () => {
      d.refs.selectedUriRef.current = '/vault/Inbox/B.md';
    });
    await persistActiveInboxNote({fs: d.fs, refs: d.refs, actions: d.actions});
    expect(saveNoteMarkdown).toHaveBeenCalled();
    expect(d.setLastPersistedSnapshot).not.toHaveBeenCalled();
  });

  it('skips when markdown matches lastPersisted', async () => {
    const uri = '/vault/Inbox/A.md';
    const d = makeDeps(uri);
    d.refs.lastPersistedRef.current = {uri, markdown: 'new-body'};
    await persistActiveInboxNote({fs: d.fs, refs: d.refs, actions: d.actions});
    expect(saveNoteMarkdown).not.toHaveBeenCalled();
  });
});

// @vitest-environment happy-dom

import {renderHook} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';

import type {WorkspacePersistenceDeps} from './workspacePersistenceTypes';
import {useInboxPersistCommands} from './useInboxPersistCommands';

function makeDeps(): WorkspacePersistenceDeps {
  return {
    fs: {} as never,
    refs: {
      vaultRootRef: {current: '/vault'},
      selectedUriRef: {current: '/vault/Inbox/a.md'},
      composingNewEntryRef: {current: false},
      diskConflictRef: {current: null},
      inboxContentByUriRef: {current: {}},
      editorBodyRef: {current: ''},
      openTimeDiskBodyRef: {current: ''},
      lastPersistedRef: {current: null},
      inboxYamlFrontmatterInnerRef: {current: null},
      inboxEditorYamlLeadingBeforeFrontmatterRef: {current: ''},
      inboxEditorRef: {current: null},
      todayHubBridgeRef: {
        current: {flushPendingEdits: vi.fn(async () => undefined)},
      },
      submitNewEntryRef: {current: async () => undefined},
    },
    actions: {
      setErr: vi.fn(),
      setInboxContentByUri: vi.fn(),
      setLastPersistedSnapshot: vi.fn(),
      refreshNotes: vi.fn(async () => undefined),
      onVaultWriteSettled: vi.fn(),
      loadFullMarkdownIntoInboxEditor: vi.fn(),
      scheduleBacklinksDeferOneFrameAfterLoad: vi.fn(),
    },
    state: {
      vaultRoot: '/vault',
      selectedUri: '/vault/Inbox/a.md',
      composingNewEntry: false,
      editorBody: '',
      inboxYamlFrontmatterInner: null,
      diskConflict: null,
    },
  };
}

function recreateDepsBundle(base: WorkspacePersistenceDeps): WorkspacePersistenceDeps {
  return {
    fs: base.fs,
    refs: {...base.refs},
    actions: {...base.actions},
    state: {...base.state, editorBody: 'edited'},
  };
}

describe('useInboxPersistCommands', () => {
  it('keeps enqueue and merge callbacks stable when deps bundle is recreated', () => {
    const initial = makeDeps();
    const {result, rerender} = renderHook(
      ({deps}: {deps: WorkspacePersistenceDeps}) => useInboxPersistCommands(deps),
      {initialProps: {deps: initial}},
    );

    const firstEnqueueInbox = result.current.enqueueInboxPersist;
    const firstEnqueueOutgoing = result.current.enqueuePersistOutgoingNoteMarkdown;
    const firstMerge = result.current.mergeInboxNoteBodyCacheRefAndState;

    rerender({deps: recreateDepsBundle(initial)});

    expect(result.current.enqueueInboxPersist).toBe(firstEnqueueInbox);
    expect(result.current.enqueuePersistOutgoingNoteMarkdown).toBe(
      firstEnqueueOutgoing,
    );
    expect(result.current.mergeInboxNoteBodyCacheRefAndState).toBe(firstMerge);
  });
});

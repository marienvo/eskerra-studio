import {describe, expect, it} from 'vitest';

import {shouldScheduleInboxAutosave} from './workspacePersistence';

describe('shouldScheduleInboxAutosave', () => {
  const uri = '/vault/Inbox/Note.md';

  it('requires an open persisted note outside compose mode', () => {
    expect(
      shouldScheduleInboxAutosave({
        vaultRoot: null,
        selectedUri: uri,
        composingNewEntry: false,
        diskConflict: null,
        lastPersisted: {uri, markdown: 'old'},
        liveFullMarkdown: 'new',
      }),
    ).toBe(false);
    expect(
      shouldScheduleInboxAutosave({
        vaultRoot: '/vault',
        selectedUri: null,
        composingNewEntry: false,
        diskConflict: null,
        lastPersisted: {uri, markdown: 'old'},
        liveFullMarkdown: 'new',
      }),
    ).toBe(false);
    expect(
      shouldScheduleInboxAutosave({
        vaultRoot: '/vault',
        selectedUri: uri,
        composingNewEntry: true,
        diskConflict: null,
        lastPersisted: {uri, markdown: 'old'},
        liveFullMarkdown: 'new',
      }),
    ).toBe(false);
  });

  it('does not schedule while the selected note has a disk conflict', () => {
    expect(
      shouldScheduleInboxAutosave({
        vaultRoot: '/vault',
        selectedUri: uri,
        composingNewEntry: false,
        diskConflict: {uri, diskMarkdown: 'disk'},
        lastPersisted: {uri, markdown: 'old'},
        liveFullMarkdown: 'new',
      }),
    ).toBe(false);
  });

  it('requires the persisted baseline to match the selected URI', () => {
    expect(
      shouldScheduleInboxAutosave({
        vaultRoot: '/vault',
        selectedUri: uri,
        composingNewEntry: false,
        diskConflict: null,
        lastPersisted: null,
        liveFullMarkdown: 'new',
      }),
    ).toBe(false);
    expect(
      shouldScheduleInboxAutosave({
        vaultRoot: '/vault',
        selectedUri: uri,
        composingNewEntry: false,
        diskConflict: null,
        lastPersisted: {uri: '/vault/Inbox/Other.md', markdown: 'old'},
        liveFullMarkdown: 'new',
      }),
    ).toBe(false);
  });

  it('schedules only when live markdown differs from the persisted baseline', () => {
    expect(
      shouldScheduleInboxAutosave({
        vaultRoot: '/vault',
        selectedUri: uri,
        composingNewEntry: false,
        diskConflict: null,
        lastPersisted: {uri, markdown: 'same'},
        liveFullMarkdown: 'same',
      }),
    ).toBe(false);
    expect(
      shouldScheduleInboxAutosave({
        vaultRoot: '/vault',
        selectedUri: uri,
        composingNewEntry: false,
        diskConflict: null,
        lastPersisted: {uri, markdown: 'old'},
        liveFullMarkdown: 'new',
      }),
    ).toBe(true);
  });
});

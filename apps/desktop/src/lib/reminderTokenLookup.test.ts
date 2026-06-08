import {describe, expect, it, vi} from 'vitest';

import type {Reminder} from './reminderIndex';
import {
  findReminderForLiveToken,
  findReminderForTokenAtOffset,
  normalizedTokenTextFromValue,
  occurrenceOrdinalAtOffset,
} from './reminderTokenLookup';

function makeReminder(
  overrides: Partial<Reminder> & Pick<Reminder, 'id' | 'noteUri' | 'occurrenceOrdinal'>,
): Reminder {
  return {
    normalizedTokenText: '@2026-06-08_0930',
    vaultRelativePath: 'Inbox/note.md',
    dueAtMs: 0,
    fireAtMs: 0,
    state: 'scheduled',
    lastNotifiedMs: null,
    tokenByteFrom: 0,
    tokenByteTo: 0,
    uiCaretHint: null,
    contextAnchor: 'anchor',
    duplicateCount: 1,
    scanFingerprint: 'fp',
    ...overrides,
  };
}

describe('normalizedTokenTextFromValue', () => {
  it('drops struck and formats like the scanner', () => {
    expect(
      normalizedTokenTextFromValue({
        year: 2026,
        month: 6,
        day: 8,
        hour: 9,
        minute: 30,
        struck: true,
      }),
    ).toBe('@2026-06-08_0930');
  });
});

describe('occurrenceOrdinalAtOffset', () => {
  it('counts only prior live tokens with the same normalized text', () => {
    const text = 'a @2026-06-08_0930 b @2026-06-08_0930 c @2026-06-09';
    const normalized = '@2026-06-08_0930';
    const second = text.indexOf(normalized, normalized.length);
    expect(occurrenceOrdinalAtOffset(text, second, normalized)).toBe(1);
  });

  it('ignores struck spans when counting ordinals', () => {
    const text = 'done @~~2026-06-08_0930~~ next @2026-06-08_0930';
    const liveOffset = text.lastIndexOf('@2026-06-08_0930');
    expect(
      occurrenceOrdinalAtOffset(text, liveOffset, '@2026-06-08_0930'),
    ).toBe(0);
  });
});

describe('findReminderForLiveToken', () => {
  const noteUri = 'file:///vault/Inbox/note.md';
  const reminders = [
    makeReminder({
      id: 'rem-0',
      noteUri,
      occurrenceOrdinal: 0,
      normalizedTokenText: '@2026-06-08_0930',
    }),
    makeReminder({
      id: 'rem-1',
      noteUri,
      occurrenceOrdinal: 1,
      normalizedTokenText: '@2026-06-08_0930',
    }),
  ];

  it('returns the matching reminder for note, text, and ordinal', () => {
    expect(
      findReminderForLiveToken(reminders, noteUri, '@2026-06-08_0930', 1)?.id,
    ).toBe('rem-1');
  });

  it('returns null for wrong note or missing ordinal', () => {
    expect(
      findReminderForLiveToken(reminders, 'file:///other.md', '@2026-06-08_0930', 0),
    ).toBeNull();
    expect(
      findReminderForLiveToken(reminders, noteUri, '@2026-06-08_0930', 9),
    ).toBeNull();
  });
});

describe('requestReminderStrikeViaDaemon', () => {
  it('returns not-found when no index entry matches', async () => {
    const {requestReminderStrikeViaDaemon} = await import('./reminderTokenLookup');
    const result = await requestReminderStrikeViaDaemon(
      [],
      'file:///vault/Inbox/note.md',
      'call @2026-06-08_0930',
      5,
      {year: 2026, month: 6, day: 8, hour: 9, minute: 30},
      vi.fn(),
    );
    expect(result).toBe('not-found');
  });
});

describe('findReminderForTokenAtOffset', () => {
  it('resolves reminder id from document offset', () => {
    const noteUri = 'file:///vault/Inbox/note.md';
    const text = 'call @2026-06-08_0930 then @2026-06-08_0930 again';
    const offset = text.lastIndexOf('@2026-06-08_0930');
    const reminder = findReminderForTokenAtOffset(
      [
        makeReminder({
          id: 'rem-1',
          noteUri,
          occurrenceOrdinal: 1,
          normalizedTokenText: '@2026-06-08_0930',
        }),
      ],
      noteUri,
      text,
      offset,
      {year: 2026, month: 6, day: 8, hour: 9, minute: 30},
    );
    expect(reminder?.id).toBe('rem-1');
  });
});

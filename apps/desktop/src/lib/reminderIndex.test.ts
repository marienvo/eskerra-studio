import {describe, expect, it} from 'vitest';

import {
  hasDueRemindersNow,
  parseReminderIndex,
  type Reminder,
  type ReminderState,
} from './reminderIndex';

function reminder(overrides: Partial<Reminder> = {}): Reminder {
  return {
    id: 'id-1',
    noteUri: 'file:///vault/a.md',
    vaultRelativePath: 'a.md',
    normalizedTokenText: '@2026-06-06_0900',
    occurrenceOrdinal: 0,
    dueAtMs: 1_000,
    fireAtMs: 700,
    state: 'scheduled',
    lastNotifiedMs: null,
    tokenByteFrom: 0,
    tokenByteTo: 16,
    uiCaretHint: null,
    contextAnchor: 'anchor',
    duplicateCount: 1,
    scanFingerprint: 'fp',
    ...overrides,
  };
}

function indexJson(reminders: Reminder[], overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schemaVersion: 1,
    vaultHash: 'vh1',
    vaultRelativeRootMarker: null,
    generatedAtMs: 0,
    reminders,
    ...overrides,
  });
}

describe('parseReminderIndex', () => {
  it('parses a valid index document', () => {
    const parsed = parseReminderIndex(indexJson([reminder()]));
    expect(parsed?.reminders).toHaveLength(1);
    expect(parsed?.vaultHash).toBe('vh1');
  });

  it('rejects an unsupported schema version (fail-safe → null)', () => {
    expect(parseReminderIndex(indexJson([], {schemaVersion: 2}))).toBeNull();
  });

  it('rejects malformed JSON', () => {
    expect(parseReminderIndex('{not json')).toBeNull();
  });

  it('rejects a document whose reminders is not an array', () => {
    expect(parseReminderIndex(indexJson([], {reminders: 'nope'}))).toBeNull();
  });

  it('rejects a non-object top level', () => {
    expect(parseReminderIndex('null')).toBeNull();
    expect(parseReminderIndex('42')).toBeNull();
  });
});

describe('displayLine backward compatibility', () => {
  it('parses an index that contains displayLine', () => {
    const r = reminder({displayLine: 'Call dentist'});
    const parsed = parseReminderIndex(indexJson([r]));
    expect(parsed?.reminders[0]?.displayLine).toBe('Call dentist');
  });

  it('parses an index without displayLine (older daemon) and leaves field absent', () => {
    // Serialize without displayLine to simulate an old index file.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- intentionally discarded to build old-format fixture
    const {displayLine, ...withoutDisplayLine} = reminder();
    const json = JSON.stringify({
      schemaVersion: 1,
      vaultHash: 'vh1',
      vaultRelativeRootMarker: null,
      generatedAtMs: 0,
      reminders: [withoutDisplayLine],
    });
    const parsed = parseReminderIndex(json);
    expect(parsed?.reminders[0]?.displayLine).toBeUndefined();
    // Consumers must treat undefined as empty — verify the field simply isn't set.
    expect('displayLine' in (parsed?.reminders[0] ?? {})).toBe(false);
  });

  it('parses an index with an empty displayLine', () => {
    const r = reminder({displayLine: ''});
    const parsed = parseReminderIndex(indexJson([r]));
    expect(parsed?.reminders[0]?.displayLine).toBe('');
  });
});

describe('hasDueRemindersNow (notifications dot logic)', () => {
  const states: ReminderState[] = ['scheduled', 'due', 'notified'];

  it('is true when a non-stale reminder is at or past its due time', () => {
    for (const state of states) {
      const reminders = [reminder({state, dueAtMs: 1_000})];
      expect(hasDueRemindersNow(reminders, 1_000)).toBe(true); // exactly at due
      expect(hasDueRemindersNow(reminders, 5_000)).toBe(true); // past due
    }
  });

  it('is false for a purely future reminder (the dot must not light early)', () => {
    expect(hasDueRemindersNow([reminder({dueAtMs: 10_000})], 1)).toBe(false);
  });

  it('excludes stale reminders even when overdue', () => {
    expect(hasDueRemindersNow([reminder({state: 'stale', dueAtMs: 1_000})], 5_000)).toBe(false);
  });

  it('is false for an empty list', () => {
    expect(hasDueRemindersNow([], Date.now())).toBe(false);
  });

  it('is true when any one of several reminders is due', () => {
    const reminders = [
      reminder({id: 'future', dueAtMs: 10_000}),
      reminder({id: 'due-now', dueAtMs: 500}),
    ];
    expect(hasDueRemindersNow(reminders, 1_000)).toBe(true);
  });
});

import {describe, expect, it} from 'vitest';

import type {Reminder, ReminderState} from './reminderIndex';
import {
  reminderDueLabel,
  reminderNoteName,
  reminderToPaneRow,
  type ReminderPaneRow,
  type ReminderRemoveState,
} from './reminderPane';

function reminder(overrides: Partial<Reminder> = {}): Reminder {
  return {
    id: 'id-1',
    noteUri: 'file:///vault/Inbox/a.md',
    vaultRelativePath: 'Inbox/a.md',
    normalizedTokenText: '@2026-06-06_0900',
    occurrenceOrdinal: 0,
    dueAtMs: 1_000,
    fireAtMs: 700,
    state: 'scheduled',
    lastNotifiedMs: null,
    tokenByteFrom: 0,
    tokenByteTo: 16,
    uiCaretHint: {utf16Offset: 16},
    contextAnchor: 'anchor',
    duplicateCount: 1,
    scanFingerprint: 'fp',
    ...overrides,
  };
}

function prevRow(removeState: ReminderRemoveState): ReminderPaneRow {
  return {
    id: 'id-1',
    source: 'reminder',
    noteUri: 'file:///vault/Inbox/a.md',
    reminderId: 'id-1',
    dueAtMs: 1_000,
    normalizedTokenText: '@2026-06-06_0900',
    vaultRelativePath: 'Inbox/a.md',
    reminderState: 'scheduled',
    uiCaretHint: 16,
    removeState,
  };
}

describe('reminderToPaneRow', () => {
  it('maps the daemon reminder fields onto the pane row', () => {
    const row = reminderToPaneRow(reminder(), undefined);
    expect(row).toMatchObject({
      id: 'id-1',
      source: 'reminder',
      reminderId: 'id-1',
      noteUri: 'file:///vault/Inbox/a.md',
      dueAtMs: 1_000,
      vaultRelativePath: 'Inbox/a.md',
      reminderState: 'scheduled',
      uiCaretHint: 16,
      removeState: 'idle',
    });
  });

  it('defaults removeState to idle when there is no prior row', () => {
    expect(reminderToPaneRow(reminder(), undefined).removeState).toBe('idle');
  });

  it('keeps a `removing` spinner across index re-reads while not stale', () => {
    const row = reminderToPaneRow(reminder({state: 'notified'}), prevRow('removing'));
    expect(row.removeState).toBe('removing');
  });

  it('clears `removing` back to idle once the daemon reports stale', () => {
    // A stale daemon result means the remove failed safely → surface the stale
    // affordance, not a stuck spinner.
    const row = reminderToPaneRow(reminder({state: 'stale'}), prevRow('removing'));
    expect(row.removeState).toBe('idle');
    expect(row.reminderState).toBe('stale');
  });

  it('preserves `remove-unavailable` regardless of daemon state (app-local UI only)', () => {
    for (const state of ['scheduled', 'due', 'notified', 'stale'] as ReminderState[]) {
      const row = reminderToPaneRow(reminder({state}), prevRow('remove-unavailable'));
      expect(row.removeState).toBe('remove-unavailable');
    }
  });
});

describe('reminderNoteName', () => {
  it('strips the .md extension and the directory path', () => {
    expect(reminderNoteName('Inbox/My Note.md')).toBe('My Note');
  });

  it('returns a name without extension unchanged', () => {
    expect(reminderNoteName('README')).toBe('README');
  });

  it('handles a bare filename', () => {
    expect(reminderNoteName('plan.md')).toBe('plan');
  });
});

describe('reminderDueLabel', () => {
  const now = 1_000_000_000_000;

  it('labels a past reminder as overdue', () => {
    expect(reminderDueLabel(now - 1, now)).toBe('overdue');
    expect(reminderDueLabel(now, now)).toBe('overdue'); // exactly at due
  });

  it('labels sub-minute as "in < 1 min"', () => {
    expect(reminderDueLabel(now + 20_000, now)).toBe('in < 1 min');
  });

  it('labels minutes within the hour', () => {
    expect(reminderDueLabel(now + 30 * 60_000, now)).toBe('in 30 min');
  });

  it('labels hours within the day', () => {
    expect(reminderDueLabel(now + 5 * 60 * 60_000, now)).toBe('in 5h');
  });

  it('labels beyond a day as a calendar date', () => {
    const label = reminderDueLabel(now + 3 * 24 * 60 * 60_000, now);
    expect(label).not.toMatch(/^in /);
    expect(label).not.toBe('overdue');
  });
});

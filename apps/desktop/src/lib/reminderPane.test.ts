import {describe, expect, it} from 'vitest';

import type {Reminder, ReminderState} from './reminderIndex';
import {
  reminderDueLabel,
  reminderNoteName,
  reminderTimeLabel,
  isLockedSnoozeMinutes,
  liveSnoozeOptions,
  snoozeMenuOptions,
  reminderToPaneRow,
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

  it('carries the displayLine from the daemon reminder', () => {
    const row = reminderToPaneRow(reminder({displayLine: 'Call the dentist back'}), undefined);
    expect(row.displayLine).toBe('Call the dentist back');
  });

  it('treats an absent displayLine (older index) as an empty string', () => {
    // The base factory omits displayLine, mirroring an index written before the
    // field existed.
    expect(reminder().displayLine).toBeUndefined();
    expect(reminderToPaneRow(reminder(), undefined).displayLine).toBe('');
  });

  it('leaves displayTitle undefined for an ordinary note', () => {
    const row = reminderToPaneRow(reminder(), undefined, ['/vault/Hub/Today.md']);
    expect(row.displayTitle).toBeUndefined();
  });

  it('sets displayTitle to the hub folder name for a hub-row reminder', () => {
    const row = reminderToPaneRow(
      reminder({
        noteUri: 'file:///vault/Hub/2026-06-08.md',
        vaultRelativePath: 'Hub/2026-06-08.md',
      }),
      undefined,
      ['/vault/Hub/Today.md'],
    );
    expect(row.displayTitle).toBe('Hub');
  });

  it('sets displayTitle to the hub folder name for a reminder on the hub Today note', () => {
    const row = reminderToPaneRow(
      reminder({
        noteUri: 'file:///vault/Hub/Today.md',
        vaultRelativePath: 'Hub/Today.md',
      }),
      undefined,
      ['/vault/Hub/Today.md'],
    );
    expect(row.displayTitle).toBe('Hub');
  });

  it('keeps a `removing` spinner across index re-reads while not stale', () => {
    const row = reminderToPaneRow(reminder({state: 'notified'}), 'removing');
    expect(row.removeState).toBe('removing');
  });

  it('clears `removing` back to idle once the daemon reports stale', () => {
    // A stale daemon result means the remove failed safely → surface the stale
    // affordance, not a stuck spinner.
    const row = reminderToPaneRow(reminder({state: 'stale'}), 'removing');
    expect(row.removeState).toBe('idle');
    expect(row.reminderState).toBe('stale');
  });

  it('preserves `remove-unavailable` regardless of daemon state (app-local UI only)', () => {
    for (const state of ['scheduled', 'due', 'notified', 'stale'] as ReminderState[]) {
      const row = reminderToPaneRow(reminder({state}), 'remove-unavailable');
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

describe('reminderTimeLabel', () => {
  it('formats the local time as zero-padded 24-hour HH:MM', () => {
    // Build an instant from local Y/M/D h:m so the assertion is timezone-stable.
    const due = new Date(2026, 5, 6, 9, 5).getTime();
    expect(reminderTimeLabel(due)).toBe('09:05');
    const late = new Date(2026, 10, 27, 23, 0).getTime();
    expect(reminderTimeLabel(late)).toBe('23:00');
    const midnight = new Date(2026, 0, 1, 0, 0).getTime();
    expect(reminderTimeLabel(midnight)).toBe('00:00');
  });
});

describe('isLockedSnoozeMinutes', () => {
  it('accepts only the locked action set', () => {
    expect(isLockedSnoozeMinutes(3)).toBe(true);
    expect(isLockedSnoozeMinutes(1)).toBe(true);
    expect(isLockedSnoozeMinutes(0)).toBe(true);
    expect(isLockedSnoozeMinutes(2)).toBe(false);
    expect(isLockedSnoozeMinutes(999)).toBe(false);
  });
});

describe('liveSnoozeOptions', () => {
  const due = 1_000_000_000_000;
  const min = 60_000;

  it('offers all three before the T-3 boundary', () => {
    expect(liveSnoozeOptions(due, due - 4 * min)).toEqual([3, 1, 0]);
  });

  it('drops T-3 once now is at/after dueAt-3min', () => {
    expect(liveSnoozeOptions(due, due - 3 * min)).toEqual([1, 0]);
    expect(liveSnoozeOptions(due, due - 2 * min)).toEqual([1, 0]);
  });

  it('leaves only at-due between T-1 and due', () => {
    expect(liveSnoozeOptions(due, due - min)).toEqual([0]);
    expect(liveSnoozeOptions(due, due - 30_000)).toEqual([0]);
  });

  it('offers at-due exactly at dueAt (daemon FiredNow boundary)', () => {
    expect(liveSnoozeOptions(due, due)).toEqual([0]);
  });

  it('offers nothing once now is past dueAt', () => {
    expect(liveSnoozeOptions(due, due + 1)).toEqual([]);
    expect(liveSnoozeOptions(due, due + min)).toEqual([]);
  });
});

describe('snoozeMenuOptions', () => {
  const due = 1_000_000_000_000;
  const min = 60_000;

  it('offers nothing before the T-3 window opens', () => {
    expect(snoozeMenuOptions(due, due - 4 * min)).toEqual([]);
    expect(snoozeMenuOptions(due, due - 3 * min - 1)).toEqual([]);
  });

  it('offers live offsets from T-3 through dueAt', () => {
    expect(snoozeMenuOptions(due, due - 3 * min)).toEqual([1, 0]);
    expect(snoozeMenuOptions(due, due - 2 * min)).toEqual([1, 0]);
    expect(snoozeMenuOptions(due, due - min)).toEqual([0]);
    expect(snoozeMenuOptions(due, due)).toEqual([0]);
  });

  it('offers nothing once now is past dueAt', () => {
    expect(snoozeMenuOptions(due, due + 1)).toEqual([]);
  });
});

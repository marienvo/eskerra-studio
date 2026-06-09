import {describe, expect, it} from 'vitest';
import {TODAY_HUB_SECTION_DELIMITER} from '../todayHub/todayHubSectionDelimiter';
import {splitTodayRowIntoColumns} from '../todayHub/splitMergeTodayRowColumns';
import {upsertCalendarColumn} from './upsertCalendarColumn';

const DELIM = TODAY_HUB_SECTION_DELIMITER;

describe('upsertCalendarColumn', () => {
  it('writes the Calendar segment into an empty row, leaving other columns blank', () => {
    const out = upsertCalendarColumn({
      rowBody: '',
      columnCount: 3,
      calendarColumnIndex: 2,
      desiredCalendarBody: ['**January**', '**Mon 19:** Standup'].join('\n'),
    });
    const cols = splitTodayRowIntoColumns(out, 3);
    expect(cols[0]).toBe('');
    expect(cols[1]).toBe('');
    expect(cols[2]).toBe(['**January**', '**Mon 19:** Standup'].join('\n'));
  });

  it('preserves other columns and existing user lines, appending only missing managed lines', () => {
    const rowBody = ['Next action note', DELIM, '**January**', '**Mon 19:** Standup', '- my own note'].join(
      '',
    );
    // build a valid 3-col body: col0 text, col1 empty, col2 calendar
    const initial = upsertCalendarColumn({
      rowBody: ['Next action note', DELIM, '', DELIM, '**January**\n**Mon 19:** Standup\n- my own note'].join(
        '',
      ),
      columnCount: 3,
      calendarColumnIndex: 2,
      desiredCalendarBody: ['**January**', '**Mon 19:** Standup', '**Tue 20:** Sync'].join('\n'),
    });
    expect(rowBody).toBeTruthy();
    const cols = splitTodayRowIntoColumns(initial, 3);
    expect(cols[0]).toBe('Next action note');
    expect(cols[2]).toBe(
      ['**January**', '**Mon 19:** Standup', '- my own note', '**Tue 20:** Sync'].join('\n'),
    );
  });

  it('is idempotent for a fixed desired body', () => {
    const desired = ['**January**', '**Mon 19:** Standup', '**Tue 20:** Sync'].join('\n');
    const once = upsertCalendarColumn({
      rowBody: '',
      columnCount: 2,
      calendarColumnIndex: 1,
      desiredCalendarBody: desired,
    });
    const twice = upsertCalendarColumn({
      rowBody: once,
      columnCount: 2,
      calendarColumnIndex: 1,
      desiredCalendarBody: desired,
    });
    expect(twice).toBe(once);
  });

  it('never wipes existing managed lines when the desired body is empty', () => {
    const seeded = upsertCalendarColumn({
      rowBody: '',
      columnCount: 2,
      calendarColumnIndex: 1,
      desiredCalendarBody: '**January**\n**Mon 19:** Standup',
    });
    const afterEmpty = upsertCalendarColumn({
      rowBody: seeded,
      columnCount: 2,
      calendarColumnIndex: 1,
      desiredCalendarBody: '',
    });
    expect(afterEmpty).toBe(seeded);
  });

  it('does not duplicate a month heading that is already present', () => {
    const seeded = upsertCalendarColumn({
      rowBody: '',
      columnCount: 2,
      calendarColumnIndex: 1,
      desiredCalendarBody: '**January**\n**Mon 19:** Standup',
    });
    const grown = upsertCalendarColumn({
      rowBody: seeded,
      columnCount: 2,
      calendarColumnIndex: 1,
      desiredCalendarBody: '**January**\n**Mon 19:** Standup\n**Tue 20:** Sync',
    });
    const cols = splitTodayRowIntoColumns(grown, 2);
    expect(cols[1]).toBe(['**January**', '**Mon 19:** Standup', '**Tue 20:** Sync'].join('\n'));
  });

  it('throws when the Calendar index is out of range', () => {
    expect(() =>
      upsertCalendarColumn({rowBody: '', columnCount: 2, calendarColumnIndex: 2, desiredCalendarBody: 'x'}),
    ).toThrow();
  });
});

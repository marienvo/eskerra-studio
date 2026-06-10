import {describe, expect, it} from 'vitest';
import {TODAY_HUB_SECTION_DELIMITER} from '../../../todayHub/todayHubSectionDelimiter';
import {splitTodayRowIntoColumns} from '../../../todayHub/splitMergeTodayRowColumns';
import {upsertCalendarColumnInRow} from '../upsertCalendarColumnInRow';
import type {CalendarItem} from '../types';

const DELIM = TODAY_HUB_SECTION_DELIMITER;
const WEEK_START = new Date(2026, 0, 19);
const NOW = new Date(2026, 0, 19, 6, 0);

function item(over: Partial<CalendarItem> & {date: Date; body: string}): CalendarItem {
  return {
    timed: false,
    timeMinutes: null,
    source: 'agenda',
    instant: null,
    order: 0,
    ...over,
  };
}

const INCOMING = [item({date: new Date(2026, 0, 20), body: 'Standup'})];

describe('upsertCalendarColumnInRow', () => {
  it('fills the Calendar column of a fresh (blank) row, leaving other columns empty', () => {
    const res = upsertCalendarColumnInRow({
      rowBody: '',
      columnCount: 3,
      calendarColumnIndex: 2,
      items: INCOMING,
      weekStart: WEEK_START,
      now: NOW,
    });
    expect(res.kind).toBe('write');
    if (res.kind !== 'write') throw new Error('expected write');
    const cols = splitTodayRowIntoColumns(res.rowBody, 3);
    expect(cols[0]).toBe('');
    expect(cols[1]).toBe('');
    expect(cols[2]).toBe('@2026-01-20 Standup');
  });

  it('keeps other columns byte-identical', () => {
    const rowBody = ['week note', '', 'Next action'].join(DELIM);
    const res = upsertCalendarColumnInRow({
      rowBody,
      columnCount: 3,
      calendarColumnIndex: 2,
      items: INCOMING,
      weekStart: WEEK_START,
      now: NOW,
    });
    if (res.kind !== 'write') throw new Error('expected write');
    const cols = splitTodayRowIntoColumns(res.rowBody, 3);
    expect(cols[0]).toBe('week note');
    expect(cols[1]).toBe('');
    expect(cols[2]).toContain('@2026-01-20 Standup');
  });

  it('returns noop when nothing changes (idempotent)', () => {
    const first = upsertCalendarColumnInRow({
      rowBody: ['week note', '', 'Next action'].join(DELIM),
      columnCount: 3,
      calendarColumnIndex: 2,
      items: INCOMING,
      weekStart: WEEK_START,
      now: NOW,
    });
    if (first.kind !== 'write') throw new Error('expected write');
    const second = upsertCalendarColumnInRow({
      rowBody: first.rowBody,
      columnCount: 3,
      calendarColumnIndex: 2,
      items: INCOMING,
      weekStart: WEEK_START,
      now: NOW,
    });
    expect(second.kind).toBe('noop');
  });

  it('fails closed on an ambiguous column split (wrong delimiter count)', () => {
    const rowBody = ['col0', 'calendar-ish'].join(DELIM);
    const res = upsertCalendarColumnInRow({
      rowBody,
      columnCount: 3,
      calendarColumnIndex: 2,
      items: INCOMING,
      weekStart: WEEK_START,
      now: NOW,
    });
    expect(res.kind).toBe('skip');
    if (res.kind === 'skip') expect(res.reason).toBe('ambiguous-column-split');
  });

  it('fails closed when the Calendar index is out of range', () => {
    const res = upsertCalendarColumnInRow({
      rowBody: '',
      columnCount: 2,
      calendarColumnIndex: 2,
      items: INCOMING,
      weekStart: WEEK_START,
      now: NOW,
    });
    expect(res.kind).toBe('skip');
  });

  it('does not delete an existing manual line in the Calendar column', () => {
    const rowBody = ['week note', '', ['**January**', '- my own note'].join('\n')].join(DELIM);
    const res = upsertCalendarColumnInRow({
      rowBody,
      columnCount: 3,
      calendarColumnIndex: 2,
      items: INCOMING,
      weekStart: WEEK_START,
      now: NOW,
    });
    if (res.kind !== 'write') throw new Error('expected write');
    const cols = splitTodayRowIntoColumns(res.rowBody, 3);
    expect(cols[2]).toContain('- my own note');
    expect(cols[2]).toContain('@2026-01-20 Standup');
  });
});

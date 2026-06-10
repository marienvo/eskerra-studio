import {describe, expect, it} from 'vitest';
import {
  renderCalendarCellFromScratch,
  renderCalendarItemLine,
} from '../renderCalendarCellLines';
import type {CalendarItem} from '../types';

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

describe('renderCalendarCellLines', () => {
  it('renders a timed item as @date_time body', () => {
    const it1 = item({date: new Date(2026, 0, 19), body: 'Dentist', timed: true, timeMinutes: 570});
    expect(renderCalendarItemLine(it1)).toBe('@2026-01-19_0930 Dentist');
  });

  it('renders an untimed item as @date body', () => {
    const it1 = item({date: new Date(2026, 0, 19), body: '🎂 Birthday'});
    expect(renderCalendarItemLine(it1)).toBe('@2026-01-19 🎂 Birthday');
  });

  it('renders an item with empty body as just the token', () => {
    const it1 = item({date: new Date(2026, 0, 19), body: ''});
    expect(renderCalendarItemLine(it1)).toBe('@2026-01-19');
  });

  it('renders a full cell: items chronological, timed before untimed, no month headings', () => {
    const out = renderCalendarCellFromScratch([
      item({date: new Date(2026, 0, 20), body: '🎂 B'}),
      item({date: new Date(2026, 0, 19), body: 'Gym', timed: true, timeMinutes: 480}),
      item({date: new Date(2026, 0, 19), body: '🎂 A'}),
    ]);
    expect(out).toBe(
      ['@2026-01-19_0800 Gym', '@2026-01-19 🎂 A', '@2026-01-20 🎂 B'].join('\n'),
    );
  });

  it('returns empty string for no items', () => {
    expect(renderCalendarCellFromScratch([])).toBe('');
  });
});

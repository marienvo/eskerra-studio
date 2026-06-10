import {describe, expect, it} from 'vitest';
import {
  renderCalendarCellFromScratch,
  renderCalendarItemLine,
  renderMonthHeadingLine,
} from '../renderCalendarCellLines';
import type {CalendarItem} from '../types';

function item(over: Partial<CalendarItem> & {date: Date; body: string}): CalendarItem {
  return {
    timed: false,
    timeMinutes: null,
    monthIdx: over.date.getMonth(),
    monthHeading: 'January',
    source: 'agenda',
    instant: null,
    order: 0,
    ...over,
  };
}

describe('renderCalendarCellLines', () => {
  it('renders a single item line and a month heading', () => {
    const it1 = item({date: new Date(2026, 0, 19), body: '🎂 Birthday'});
    expect(renderCalendarItemLine(it1)).toBe('**Mon 19:** 🎂 Birthday');
    expect(renderMonthHeadingLine(it1)).toBe('**January**');
  });

  it('renders a full cell: month heading once, items chronological + timed-first', () => {
    const out = renderCalendarCellFromScratch([
      item({date: new Date(2026, 0, 20), body: '🎂 B', monthHeading: 'January'}),
      item({
        date: new Date(2026, 0, 19),
        body: '08:00 Gym',
        timed: true,
        timeMinutes: 480,
        monthHeading: 'January',
      }),
      item({date: new Date(2026, 0, 19), body: '🎂 A', monthHeading: 'January'}),
    ]);
    expect(out).toBe(
      ['**January**', '**Mon 19:** 08:00 Gym', '**Mon 19:** 🎂 A', '**Tue 20:** 🎂 B'].join('\n'),
    );
  });

  it('returns empty string for no items', () => {
    expect(renderCalendarCellFromScratch([])).toBe('');
  });
});

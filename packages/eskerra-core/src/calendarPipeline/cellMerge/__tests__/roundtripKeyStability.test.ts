import {describe, expect, it} from 'vitest';
import {calendarItemKey} from '../calendarItemKey';
import {mergeCalendarCellContent} from '../mergeCalendarCellContent';
import {parseCalendarCellLines} from '../parseCalendarCellLines';
import {renderCalendarItemLine} from '../renderCalendarCellLines';
import type {CalendarItem} from '../types';

const WEEK_START = new Date(2026, 0, 19); // Mon Jan 19 2026
const NOW = new Date(2026, 0, 19, 6, 0); // early Monday so timed items stay in scope

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

const ITEMS: CalendarItem[] = [
  item({date: new Date(2026, 0, 20), body: '🎂 Birthday'}),
  item({date: new Date(2026, 0, 20), body: '09:30 Dentist', timed: true, timeMinutes: 570}),
  item({date: new Date(2026, 0, 22), body: '[[Fleur]] coffee'}),
];

describe('render → parse → key round-trip stability', () => {
  it('a rendered item line parses back to the same key (timed + untimed)', () => {
    for (const it of ITEMS) {
      const line = renderCalendarItemLine(it);
      const [parsed] = parseCalendarCellLines(line, WEEK_START);
      expect(parsed.kind).toBe('pipelineItem');
      if (parsed.kind !== 'pipelineItem') {
        throw new Error('expected pipelineItem');
      }
      expect(calendarItemKey(parsed)).toBe(calendarItemKey(it));
    }
  });

  it('a rendered month heading is recognized as that month being present', () => {
    const merged = mergeCalendarCellContent('', ITEMS, WEEK_START, NOW);
    const lines = parseCalendarCellLines(merged, WEEK_START);
    expect(lines.some(l => l.kind === 'monthHeading' && l.monthIdx === 0)).toBe(true);
  });

  it('merge is a no-op on the second application (no append-loop)', () => {
    const once = mergeCalendarCellContent('', ITEMS, WEEK_START, NOW);
    const twice = mergeCalendarCellContent(once, ITEMS, WEEK_START, NOW);
    expect(twice).toBe(once);
  });

  it('the rendered cell contains no duplicate lines after a second merge', () => {
    const once = mergeCalendarCellContent('', ITEMS, WEEK_START, NOW);
    const twice = mergeCalendarCellContent(once, ITEMS, WEEK_START, NOW);
    const lines = twice.split('\n').filter(l => l.trim().length > 0);
    expect(new Set(lines).size).toBe(lines.length);
  });
});

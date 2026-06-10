import {describe, expect, it} from 'vitest';
import {calendarItemFullKey, calendarItemKey} from '../calendarItemKey';
import {mergeCalendarCellContent} from '../mergeCalendarCellContent';
import {parseCalendarCellLines} from '../parseCalendarCellLines';
import {renderCalendarItemLine} from '../renderCalendarCellLines';
import type {CalendarItem} from '../types';

const NOW = new Date(2026, 0, 19, 6, 0); // early Monday so timed items stay in scope

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

const ITEMS: CalendarItem[] = [
  item({date: new Date(2026, 0, 20), body: '🎂 Birthday'}),
  item({date: new Date(2026, 0, 20), body: 'Dentist', timed: true, timeMinutes: 570}),
  item({date: new Date(2026, 0, 22), body: 'coffee'}),
];

describe('render → parse → key round-trip stability', () => {
  it('a rendered item line parses back to the same key (timed + untimed)', () => {
    for (const it of ITEMS) {
      const line = renderCalendarItemLine(it);
      const [parsed] = parseCalendarCellLines(line);
      expect(parsed.kind).toBe('pipelineItem');
      if (parsed.kind !== 'pipelineItem') throw new Error('expected pipelineItem');
      expect(calendarItemFullKey(parsed)).toBe(calendarItemKey(it));
    }
  });

  it('merge is a no-op on the second application (no append-loop)', () => {
    const once = mergeCalendarCellContent('', ITEMS, NOW);
    const twice = mergeCalendarCellContent(once, ITEMS, NOW);
    expect(twice).toBe(once);
  });

  it('the rendered cell contains no duplicate lines after a second merge', () => {
    const once = mergeCalendarCellContent('', ITEMS, NOW);
    const twice = mergeCalendarCellContent(once, ITEMS, NOW);
    const lines = twice.split('\n').filter(l => l.trim().length > 0);
    expect(new Set(lines).size).toBe(lines.length);
  });
});

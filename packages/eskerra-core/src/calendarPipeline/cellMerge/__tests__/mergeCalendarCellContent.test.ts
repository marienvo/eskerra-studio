import {describe, expect, it} from 'vitest';
import {mergeCalendarCellContent} from '../mergeCalendarCellContent';
import type {CalendarItem} from '../types';

const WEEK_START = new Date(2026, 0, 19); // Mon Jan 19 2026 (week 19..25)
const NOW = new Date(2026, 0, 19, 12, 0); // Mon noon

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

/** Every non-empty existing line must survive byte-identically in the merge output. */
function expectExistingSubsetOfOutput(existing: string, output: string): void {
  const outLines = new Set(output.split('\n'));
  for (const line of existing.split('\n')) {
    if (line.trim().length === 0) {
      continue;
    }
    expect(outLines.has(line)).toBe(true);
  }
}

describe('mergeCalendarCellContent', () => {
  it('fills an empty cell with sorted lines + month heading', () => {
    const out = mergeCalendarCellContent(
      '',
      [
        item({date: new Date(2026, 0, 21), body: 'B'}),
        item({date: new Date(2026, 0, 20), body: 'A'}),
      ],
      WEEK_START,
      NOW,
    );
    expect(out).toBe(['**January**', '**Tue 20:** A', '**Wed 21:** B'].join('\n'));
  });

  it('does not duplicate an item whose key already exists (byte-identical)', () => {
    const existing = ['**January**', '**Tue 20:** 🎂 Birthday'].join('\n');
    const out = mergeCalendarCellContent(
      existing,
      [item({date: new Date(2026, 0, 20), body: '🎂 Birthday'})],
      WEEK_START,
      NOW,
    );
    expect(out).toBe(existing);
  });

  it('preserves a manual freeform line while inserting a new item', () => {
    const existing = ['**January**', '**Tue 20:** 🎂 Birthday', '- bellen met X'].join('\n');
    const out = mergeCalendarCellContent(
      existing,
      [item({date: new Date(2026, 0, 21), body: 'New item'})],
      WEEK_START,
      NOW,
    );
    expect(out).toContain('- bellen met X');
    expect(out).toContain('**Wed 21:** New item');
    expectExistingSubsetOfOutput(existing, out);
  });

  it('does not add a second month heading when the month is already present', () => {
    const existing = ['**☔️ April**', '**Mon 27:** Existing'].join('\n');
    const aprilWeek = new Date(2026, 3, 27); // Mon Apr 27
    const out = mergeCalendarCellContent(
      existing,
      [item({date: new Date(2026, 3, 28), body: 'New', monthIdx: 3, monthHeading: '☔️ April'})],
      aprilWeek,
      new Date(2026, 3, 27, 12, 0),
    );
    expect(out.match(/April/g)?.length).toBe(1);
    expect(out).toContain('**Tue 28:** New');
  });

  it('is idempotent on a second merge with identical input', () => {
    const incoming = [
      item({date: new Date(2026, 0, 20), body: 'A'}),
      item({date: new Date(2026, 0, 21), body: 'B'}),
    ];
    const once = mergeCalendarCellContent('', incoming, WEEK_START, NOW);
    const twice = mergeCalendarCellContent(once, incoming, WEEK_START, NOW);
    expect(twice).toBe(once);
  });

  it('keeps a user-edited body when the key is unchanged (timed)', () => {
    const existing = ['**January**', '**Tue 20:** 14:00 X (my notes)'].join('\n');
    const out = mergeCalendarCellContent(
      existing,
      [item({date: new Date(2026, 0, 20), body: '14:00 X', timed: true, timeMinutes: 840})],
      WEEK_START,
      NOW,
    );
    expect(out).toBe(existing);
  });

  it('ignores an out-of-scope incoming item (past ICS timed) without touching existing', () => {
    const existing = ['**January**', '**Tue 20:** Keep me'].join('\n');
    const out = mergeCalendarCellContent(
      existing,
      [
        item({
          date: new Date(2026, 0, 18),
          body: '09:00 Past meeting',
          timed: true,
          timeMinutes: 540,
          source: 'calendar',
          instant: new Date(2026, 0, 18, 9, 0),
        }),
      ],
      new Date(2026, 0, 12), // week of Jan 12 (contains Jan 18)
      NOW,
    );
    expect(out).toBe(existing);
  });

  it('does not reorder existing lines (existing ⊆ output, order preserved)', () => {
    const existing = ['**Wed 21:** Later', '- freeform', '**Tue 20:** Earlier'].join('\n');
    const out = mergeCalendarCellContent(
      existing,
      [item({date: new Date(2026, 0, 22), body: 'Inserted'})],
      WEEK_START,
      NOW,
    );
    expectExistingSubsetOfOutput(existing, out);
    const outLines = out.split('\n').filter(l => l.trim().length > 0);
    const idxLater = outLines.indexOf('**Wed 21:** Later');
    const idxFreeform = outLines.indexOf('- freeform');
    const idxEarlier = outLines.indexOf('**Tue 20:** Earlier');
    expect(idxLater).toBeLessThan(idxFreeform);
    expect(idxFreeform).toBeLessThan(idxEarlier);
  });
});

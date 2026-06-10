import {describe, expect, it} from 'vitest';
import {mergeCalendarCellContent} from '../mergeCalendarCellContent';
import type {CalendarItem} from '../types';

const NOW = new Date(2026, 0, 19, 12, 0); // Mon noon
const WEEK_START = new Date(2026, 0, 19); // Mon Jan 19 2026

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

/** Every non-empty existing line must survive byte-identically in the merge output. */
function expectExistingSubsetOfOutput(existing: string, output: string): void {
  const outLines = new Set(output.split('\n'));
  for (const line of existing.split('\n')) {
    if (line.trim().length === 0) continue;
    expect(outLines.has(line)).toBe(true);
  }
}

describe('mergeCalendarCellContent', () => {
  it('fills an empty cell with sorted @token lines, no month headings', () => {
    const out = mergeCalendarCellContent(
      '',
      [
        item({date: new Date(2026, 0, 21), body: 'B'}),
        item({date: new Date(2026, 0, 20), body: 'A'}),
      ],
      NOW,
    );
    expect(out).toBe(['@2026-01-20 A', '@2026-01-21 B'].join('\n'));
  });

  it('inserts two untimed items on the same day when titles differ', () => {
    const out = mergeCalendarCellContent(
      '',
      [
        item({date: new Date(2026, 0, 20), body: 'Birthday'}),
        item({date: new Date(2026, 0, 20), body: 'Dentist'}),
      ],
      NOW,
    );
    expect(out).toBe(['@2026-01-20 Birthday', '@2026-01-20 Dentist'].join('\n'));
  });

  it('does not duplicate an untimed item whose full key already exists', () => {
    const existing = '@2026-01-20 🎂 Birthday';
    const out = mergeCalendarCellContent(
      existing,
      [item({date: new Date(2026, 0, 20), body: '🎂 Birthday'})],
      NOW,
    );
    expect(out).toBe(existing);
  });

  it('inserts a different untimed item on the same day as an existing line', () => {
    const existing = '@2026-01-20 🎂 Birthday';
    const out = mergeCalendarCellContent(
      existing,
      [item({date: new Date(2026, 0, 20), body: 'Dentist'})],
      NOW,
    );
    expect(out.split('\n').sort()).toEqual(
      ['@2026-01-20 Dentist', '@2026-01-20 🎂 Birthday'].sort(),
    );
    expectExistingSubsetOfOutput(existing, out);
  });

  it('deduplicates timed items by token when the user edited the title', () => {
    const existing = '@2026-01-20_0900 Edited title';
    const out = mergeCalendarCellContent(
      existing,
      [item({date: new Date(2026, 0, 20), body: 'Standup', timed: true, timeMinutes: 540})],
      NOW,
    );
    expect(out).toBe(existing);
  });

  it('does not re-insert an item whose existing line is struck/completed (@~~…~~)', () => {
    const existing = '@~~2026-01-20_0930~~ Stand-up B2B';
    const out = mergeCalendarCellContent(
      existing,
      [item({date: new Date(2026, 0, 20), body: 'Stand-up B2B', timed: true, timeMinutes: 570})],
      NOW,
    );
    // The struck line is recognized as the same ID — no duplicate appended.
    expect(out).toBe(existing);
  });

  it('preserves a manual freeform line while inserting a new item', () => {
    const existing = ['@2026-01-20 🎂 Birthday', '- bellen met X'].join('\n');
    const out = mergeCalendarCellContent(
      existing,
      [item({date: new Date(2026, 0, 21), body: 'New item'})],
      NOW,
    );
    expect(out).toContain('- bellen met X');
    expect(out).toContain('@2026-01-21 New item');
    expectExistingSubsetOfOutput(existing, out);
  });

  it('preserves legacy **Wd d:** lines while inserting new items on other dates', () => {
    const existing = ['**January**', '**Tue 20:** 09:00 Standup'].join('\n');
    const out = mergeCalendarCellContent(
      existing,
      [item({date: new Date(2026, 0, 22), body: 'New'})],
      NOW,
      WEEK_START,
    );
    expectExistingSubsetOfOutput(existing, out);
    expect(out).toContain('@2026-01-22 New');
  });

  it('does not duplicate an incoming item that matches a legacy **Wd d:** line', () => {
    const existing = '**Tue 20:** 09:00 Standup';
    const out = mergeCalendarCellContent(
      existing,
      [item({date: new Date(2026, 0, 20), body: '09:00 Standup', timed: true, timeMinutes: 540})],
      NOW,
      WEEK_START,
    );
    expect(out).toBe(existing);
    expect(out).not.toContain('@2026-01-20_0900');
  });

  it('is idempotent on a second merge with identical input', () => {
    const incoming = [
      item({date: new Date(2026, 0, 20), body: 'A'}),
      item({date: new Date(2026, 0, 21), body: 'B'}),
    ];
    const once = mergeCalendarCellContent('', incoming, NOW);
    const twice = mergeCalendarCellContent(once, incoming, NOW);
    expect(twice).toBe(once);
  });

  it('two events at the same timed token are deduplicated (one key per minute)', () => {
    const existing = '@2026-01-20_0900 Standup';
    const out = mergeCalendarCellContent(
      existing,
      [item({date: new Date(2026, 0, 20), body: 'Planning', timed: true, timeMinutes: 540})],
      NOW,
    );
    // Same minute → same key → no new line
    expect(out).toBe(existing);
  });

  it('ignores an out-of-scope incoming item (past ICS timed) without touching existing', () => {
    const existing = '@2026-01-20 Keep me';
    const out = mergeCalendarCellContent(
      existing,
      [
        item({
          date: new Date(2026, 0, 18),
          body: 'Past meeting',
          timed: true,
          timeMinutes: 540,
          source: 'calendar',
          instant: new Date(2026, 0, 18, 9, 0),
        }),
      ],
      NOW,
    );
    expect(out).toBe(existing);
  });

  it('does not reorder existing lines (existing ⊆ output, order preserved)', () => {
    const existing = ['@2026-01-21 Later', '- freeform', '@2026-01-20 Earlier'].join('\n');
    const out = mergeCalendarCellContent(
      existing,
      [item({date: new Date(2026, 0, 22), body: 'Inserted'})],
      NOW,
    );
    expectExistingSubsetOfOutput(existing, out);
    const outLines = out.split('\n').filter(l => l.trim().length > 0);
    const idxLater = outLines.indexOf('@2026-01-21 Later');
    const idxFreeform = outLines.indexOf('- freeform');
    const idxEarlier = outLines.indexOf('@2026-01-20 Earlier');
    expect(idxLater).toBeLessThan(idxFreeform);
    expect(idxFreeform).toBeLessThan(idxEarlier);
  });
});

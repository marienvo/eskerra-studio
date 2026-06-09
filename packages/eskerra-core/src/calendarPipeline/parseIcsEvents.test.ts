import {describe, expect, it} from 'vitest';
import {parseIcsEvents} from './parseIcsEvents';

/**
 * Events use UTC (`...Z`) timestamps kept comfortably mid-window so assertions on which events are
 * included stay timezone-independent regardless of the test runner's local zone.
 */
const NOW = new Date(2026, 0, 15, 12, 0, 0); // local Thursday, Jan 15 2026, midday

function wrap(...vevents: string[]): string {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', ...vevents, 'END:VCALENDAR'].join('\r\n');
}

function vevent(props: string[]): string {
  return ['BEGIN:VEVENT', ...props, 'END:VEVENT'].join('\r\n');
}

describe('parseIcsEvents', () => {
  it('includes timed events in window and skips all-day + out-of-window events', () => {
    const ics = wrap(
      vevent(['UID:a', 'SUMMARY:Standup', 'DTSTART:20260115T100000Z']),
      vevent(['UID:b', 'SUMMARY:All day off', 'DTSTART;VALUE=DATE:20260116']),
      vevent(['UID:c', 'SUMMARY:Eight digit all day', 'DTSTART:20260117']),
      vevent(['UID:d', 'SUMMARY:Too far out', 'DTSTART:20260201T100000Z']),
      vevent(['UID:e', 'SUMMARY:In the past', 'DTSTART:20260101T100000Z']),
    );
    const events = parseIcsEvents(ics, {now: NOW});
    expect(events.map(e => e.summary)).toEqual(['Standup']);
  });

  it('unfolds continuation lines and unescapes SUMMARY text', () => {
    const ics = wrap(
      vevent(['UID:a', 'SUMMARY:Lunch with Ana\\, Bob', 'DTSTART:20260116T1100', ' 00Z']),
    );
    const events = parseIcsEvents(ics, {now: NOW});
    expect(events).toHaveLength(1);
    expect(events[0].summary).toBe('Lunch with Ana, Bob');
  });

  it('falls back to the default title when SUMMARY is missing or empty', () => {
    const ics = wrap(vevent(['UID:a', 'DTSTART:20260116T100000Z']));
    expect(parseIcsEvents(ics, {now: NOW})[0].summary).toBe('Busy');
    expect(parseIcsEvents(ics, {now: NOW, titleFallback: 'Meeting'})[0].summary).toBe('Meeting');
  });

  it('expands a weekly RRULE within the window', () => {
    const ics = wrap(
      vevent([
        'UID:weekly',
        'SUMMARY:Weekly sync',
        'DTSTART:20260108T100000Z',
        'RRULE:FREQ=WEEKLY;INTERVAL=1',
      ]),
    );
    // window is Jan 15 .. end-of-day Jan 22 -> the Jan 15 and Jan 22 instances fall inside
    const events = parseIcsEvents(ics, {now: NOW, daysAhead: 7});
    expect(events.map(e => e.start.toISOString())).toEqual([
      '2026-01-15T10:00:00.000Z',
      '2026-01-22T10:00:00.000Z',
    ]);
  });

  it('honors BYDAY for weekly rules', () => {
    const ics = wrap(
      vevent([
        'UID:byday',
        'SUMMARY:MWF',
        'DTSTART:20260105T090000Z',
        'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR',
      ]),
    );
    const events = parseIcsEvents(ics, {now: NOW, daysAhead: 7});
    // Jan 16 (Fri), Jan 19 (Mon), Jan 21 (Wed) within Jan 15..22
    expect(events.map(e => e.start.toISOString())).toEqual([
      '2026-01-16T09:00:00.000Z',
      '2026-01-19T09:00:00.000Z',
      '2026-01-21T09:00:00.000Z',
    ]);
  });

  it('stops weekly expansion at UNTIL', () => {
    const ics = wrap(
      vevent([
        'UID:until',
        'SUMMARY:Ends soon',
        'DTSTART:20260108T100000Z',
        'RRULE:FREQ=WEEKLY;UNTIL=20260114T000000Z',
      ]),
    );
    expect(parseIcsEvents(ics, {now: NOW, daysAhead: 14})).toHaveLength(0);
  });

  it('dedups identical uid|timestamp|summary instances', () => {
    const ics = wrap(
      vevent(['UID:dup', 'SUMMARY:Twice', 'DTSTART:20260116T100000Z']),
      vevent(['UID:dup', 'SUMMARY:Twice', 'DTSTART:20260116T100000Z']),
    );
    expect(parseIcsEvents(ics, {now: NOW})).toHaveLength(1);
  });

  it('sorts by start time then summary', () => {
    const ics = wrap(
      vevent(['UID:1', 'SUMMARY:Zebra', 'DTSTART:20260116T090000Z']),
      vevent(['UID:2', 'SUMMARY:Apple', 'DTSTART:20260116T090000Z']),
      vevent(['UID:3', 'SUMMARY:Early', 'DTSTART:20260116T080000Z']),
    );
    expect(parseIcsEvents(ics, {now: NOW}).map(e => e.summary)).toEqual([
      'Early',
      'Apple',
      'Zebra',
    ]);
  });

  it('clamps month-end overflow for MONTHLY RRULE (Feb 28, Mar 31, Apr 30 from Jan 31 anchor)', () => {
    // COUNT=4 so we see: Jan 31 (filtered, before fromMs), Feb 28 (clamped), Mar 31, Apr 30 (clamped).
    const ics = wrap(
      vevent([
        'UID:monthly-end',
        'SUMMARY:End of month',
        'DTSTART:20260131T100000',
        'RRULE:FREQ=MONTHLY;COUNT=4',
      ]),
    );
    const now = new Date(2026, 1, 1); // Feb 1 — Jan 31 occurrence falls before window
    const events = parseIcsEvents(ics, {now, daysAhead: 100});
    const dates = events.map(e =>
      `${e.start.getFullYear()}-${String(e.start.getMonth() + 1).padStart(2, '0')}-${String(e.start.getDate()).padStart(2, '0')}`,
    );
    expect(dates).toEqual(['2026-02-28', '2026-03-31', '2026-04-30']);
  });
});

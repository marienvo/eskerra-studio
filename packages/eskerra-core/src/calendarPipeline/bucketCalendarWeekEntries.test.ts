import {describe, expect, it} from 'vitest';
import type {AgendaBullet} from './agenda/parseAgendaBullets';
import {bucketCalendarWeekEntries} from './bucketCalendarWeekEntries';

function agendaBullet(over: Partial<AgendaBullet> & {date: Date; body: string}): AgendaBullet {
  return {
    monthHeading: '',
    timed: false,
    time: null,
    timeMinutes: null,
    order: 0,
    ...over,
  };
}

describe('bucketCalendarWeekEntries', () => {
  it('groups items by Monday week-start and renders month heading + day lines', () => {
    const result = bucketCalendarWeekEntries({
      start: 'monday',
      agendaBullets: [
        agendaBullet({date: new Date(2026, 3, 27), body: "👑 King's Day", monthHeading: '☔️ April'}),
      ],
      icsEvents: [],
    });
    // April 27 2026 is a Monday -> its own week stem.
    expect([...result.keys()]).toEqual(['2026-04-27']);
    expect(result.get('2026-04-27')).toBe(['**☔️ April**', "**Mon 27:** 👑 King's Day"].join('\n'));
  });

  it('orders timed before untimed, then by time, then agenda before calendar', () => {
    const day = new Date(2026, 0, 19); // Monday Jan 19 2026
    const result = bucketCalendarWeekEntries({
      start: 'monday',
      agendaBullets: [
        agendaBullet({date: day, body: '🎂 Birthday'}),
        agendaBullet({date: day, body: '08:00 Gym', timed: true, timeMinutes: 480}),
      ],
      icsEvents: [{start: new Date(2026, 0, 19, 9, 0), summary: 'Standup'}],
    });
    const body = result.get('2026-01-19');
    expect(body).toBe(
      ['**January**', '**Mon 19:** 08:00 Gym', '**Mon 19:** 09:00 Standup', '**Mon 19:** 🎂 Birthday'].join(
        '\n',
      ),
    );
  });

  it('drops a calendar timed event when an agenda bullet has the same day and time', () => {
    const day = new Date(2026, 0, 20, 0, 0);
    const result = bucketCalendarWeekEntries({
      start: 'monday',
      agendaBullets: [
        agendaBullet({date: new Date(2026, 0, 20), body: '14:00 Sync', timed: true, timeMinutes: 840}),
      ],
      icsEvents: [{start: new Date(day.getFullYear(), day.getMonth(), day.getDate(), 14, 0), summary: 'Sync'}],
    });
    const body = result.get('2026-01-19'); // week of Jan 19 (Mon)
    expect(body).toBe(['**January**', '**Tue 20:** 14:00 Sync'].join('\n'));
  });

  it('adds the agenda 🗓️ link prefix to timed agenda bullets only', () => {
    const result = bucketCalendarWeekEntries({
      start: 'monday',
      mdAgenda: '🗓️ Personal agenda.md',
      agendaBullets: [
        agendaBullet({date: new Date(2026, 0, 19), body: '08:00 Gym', timed: true, timeMinutes: 480}),
        agendaBullet({date: new Date(2026, 0, 19), body: '🎂 Birthday'}),
      ],
      icsEvents: [],
    });
    const body = result.get('2026-01-19');
    expect(body).toContain('**Mon 19:** [🗓️](<🗓️ Personal agenda.md>) 08:00 Gym');
    expect(body).toContain('**Mon 19:** 🎂 Birthday');
  });

  it('respects a Sunday week-start', () => {
    const result = bucketCalendarWeekEntries({
      start: 'sunday',
      agendaBullets: [agendaBullet({date: new Date(2026, 0, 19), body: 'Item'})],
      icsEvents: [],
    });
    // Jan 19 2026 is Monday; with Sunday start the week begins Jan 18.
    expect([...result.keys()]).toEqual(['2026-01-18']);
  });

  it('returns an empty map when there is nothing to render', () => {
    expect(bucketCalendarWeekEntries({start: 'monday', agendaBullets: [], icsEvents: []}).size).toBe(0);
  });
});

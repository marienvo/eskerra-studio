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
  it('groups structured items by Monday week-start stem', () => {
    const result = bucketCalendarWeekEntries({
      start: 'monday',
      agendaBullets: [
        agendaBullet({date: new Date(2026, 3, 27), body: "👑 King's Day", monthHeading: '☔️ April'}),
      ],
      icsEvents: [],
    });
    expect([...result.keys()]).toEqual(['2026-04-27']);
    const items = result.get('2026-04-27')!;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      body: "👑 King's Day",
      timed: false,
      source: 'agenda',
    });
    expect(items[0].date.getDate()).toBe(27);
  });

  it('carries an instant and time for ICS events, body is just the summary', () => {
    const result = bucketCalendarWeekEntries({
      start: 'monday',
      agendaBullets: [],
      icsEvents: [{start: new Date(2026, 0, 20, 9, 0), summary: 'Standup'}],
    });
    const items = result.get('2026-01-19')!;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({body: 'Standup', timed: true, source: 'calendar', timeMinutes: 540});
    expect(items[0].instant?.getTime()).toBe(new Date(2026, 0, 20, 9, 0).getTime());
  });

  it('drops a calendar timed event when an agenda bullet shares its token key', () => {
    const result = bucketCalendarWeekEntries({
      start: 'monday',
      agendaBullets: [
        agendaBullet({date: new Date(2026, 0, 20), body: '14:00 Sync', timed: true, timeMinutes: 840, time: '14:00'}),
      ],
      icsEvents: [{start: new Date(2026, 0, 20, 14, 0), summary: 'Sync'}],
    });
    const items = result.get('2026-01-19')!;
    expect(items).toHaveLength(1);
    expect(items[0].source).toBe('agenda');
  });

  it('prefixes the agenda 🗓️ link and strips the time from timed agenda bodies', () => {
    const result = bucketCalendarWeekEntries({
      start: 'monday',
      mdAgenda: '🗓️ Personal agenda.md',
      agendaBullets: [
        agendaBullet({date: new Date(2026, 0, 19), body: '08:00 Gym', timed: true, timeMinutes: 480, time: '08:00'}),
        agendaBullet({date: new Date(2026, 0, 19), body: '🎂 Birthday'}),
      ],
      icsEvents: [],
    });
    const items = result.get('2026-01-19')!;
    const gym = items.find(i => i.timed)!;
    const birthday = items.find(i => !i.timed)!;
    expect(gym.body).toBe('[🗓️](<🗓️ Personal agenda.md>) Gym');
    expect(birthday.body).toBe('🎂 Birthday');
  });

  it('respects a Sunday week-start', () => {
    const result = bucketCalendarWeekEntries({
      start: 'sunday',
      agendaBullets: [agendaBullet({date: new Date(2026, 0, 19), body: 'Item'})],
      icsEvents: [],
    });
    expect([...result.keys()]).toEqual(['2026-01-18']);
  });

  it('returns an empty map for no input', () => {
    expect(bucketCalendarWeekEntries({start: 'monday', agendaBullets: [], icsEvents: []}).size).toBe(0);
  });
});

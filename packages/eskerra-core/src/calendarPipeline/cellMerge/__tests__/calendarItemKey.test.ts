import {describe, expect, it} from 'vitest';
import {calendarItemKey, normalizeCalendarTitle} from '../calendarItemKey';

describe('normalizeCalendarTitle', () => {
  it('strips a leading time, icon link, and wiki markup, then collapses + lowercases', () => {
    expect(normalizeCalendarTitle('09:30 Dentist')).toBe('dentist');
    expect(normalizeCalendarTitle('[🗓️](<🗓️ Personal agenda.md>) 09:30 Dentist')).toBe('dentist');
    expect(normalizeCalendarTitle('🎂 [[Fleur]] birthday')).toBe('🎂 fleur birthday');
    expect(normalizeCalendarTitle('Meet [[note|Anna]]   now')).toBe('meet anna now');
  });

  it('is case-insensitive', () => {
    expect(normalizeCalendarTitle('Team SYNC')).toBe(normalizeCalendarTitle('team sync'));
  });
});

describe('calendarItemKey', () => {
  const date = new Date(2026, 0, 19); // Jan 19 2026

  it('builds a date|time key for timed items', () => {
    expect(calendarItemKey({date, timed: true, timeMinutes: 9 * 60 + 30, body: '09:30 X'})).toBe(
      '2026-01-19|09:30',
    );
  });

  it('builds a date|title key for untimed items', () => {
    expect(calendarItemKey({date, timed: false, timeMinutes: null, body: '🎂 Birthday'})).toBe(
      '2026-01-19|🎂 birthday',
    );
  });

  it('gives the same timed key regardless of body text differences', () => {
    const a = calendarItemKey({date, timed: true, timeMinutes: 600, body: '10:00 Sync'});
    const b = calendarItemKey({date, timed: true, timeMinutes: 600, body: '10:00 Sync (moved)'});
    expect(a).toBe(b);
  });
});

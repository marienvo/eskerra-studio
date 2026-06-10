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

  it('handles wiki links without an alias', () => {
    expect(normalizeCalendarTitle('[[Meeting Notes]]')).toBe('meeting notes');
  });

  it('handles wiki links with an alias', () => {
    expect(normalizeCalendarTitle('[[Internal/Q1 Review|Q1 Review]]')).toBe('q1 review');
  });

  it('passes through body unchanged when no special markup is present', () => {
    expect(normalizeCalendarTitle('Team standup')).toBe('team standup');
  });

  it('strips unclosed agenda icon prefix gracefully (keeps rest of text)', () => {
    // No closing >), treat as plain text
    const out = normalizeCalendarTitle('[🗓️](<no-close standup');
    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(0);
  });

  it('collapses multiple spaces to single space', () => {
    expect(normalizeCalendarTitle('Team   sync')).toBe('team sync');
  });

  it('handles midnight time 00:00', () => {
    expect(normalizeCalendarTitle('00:00 Midnight event')).toBe('midnight event');
  });

  it('does not strip invalid time like 25:00', () => {
    expect(normalizeCalendarTitle('25:00 Not a time')).toBe('25:00 not a time');
  });
});

describe('calendarItemKey', () => {
  const date = new Date(2026, 0, 19); // Jan 19 2026

  it('builds a date|time|title key for timed items', () => {
    expect(calendarItemKey({date, timed: true, timeMinutes: 9 * 60 + 30, body: '09:30 Dentist'})).toBe(
      '2026-01-19|09:30|dentist',
    );
  });

  it('builds a date|title key for untimed items', () => {
    expect(calendarItemKey({date, timed: false, timeMinutes: null, body: '🎂 Birthday'})).toBe(
      '2026-01-19|🎂 birthday',
    );
  });

  it('keeps two distinct events at the same minute distinct', () => {
    const standup = calendarItemKey({date, timed: true, timeMinutes: 540, body: '09:00 Standup'});
    const planning = calendarItemKey({date, timed: true, timeMinutes: 540, body: '09:00 Planning'});
    expect(standup).not.toBe(planning);
  });

  it('dedups the same timed event regardless of leading-time prefix presence', () => {
    const a = calendarItemKey({date, timed: true, timeMinutes: 600, body: '10:00 Team sync'});
    const b = calendarItemKey({date, timed: true, timeMinutes: 600, body: 'Team sync'});
    expect(a).toBe(b);
  });
});

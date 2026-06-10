import {describe, expect, it} from 'vitest';
import {
  calendarItemFullKey,
  calendarItemKey,
  calendarItemTokenKey,
  normalizeCalendarTitle,
} from '../calendarItemKey';

describe('calendarItemKey', () => {
  const date = new Date(2026, 0, 19); // Jan 19 2026

  it('returns the @date_time token for timed items', () => {
    expect(calendarItemKey({date, timed: true, timeMinutes: 9 * 60 + 30, body: 'Standup'})).toBe(
      '@2026-01-19_0930',
    );
    expect(calendarItemTokenKey({date, timed: true, timeMinutes: 9 * 60 + 30})).toBe(
      '@2026-01-19_0930',
    );
  });

  it('returns token plus normalized title for untimed items', () => {
    expect(calendarItemKey({date, timed: false, timeMinutes: null, body: 'Team day'})).toBe(
      '@2026-01-19|team day',
    );
    expect(calendarItemFullKey({date, timed: false, timeMinutes: null, body: 'Team day'})).toBe(
      '@2026-01-19|team day',
    );
  });

  it('pads hours and minutes to two digits', () => {
    expect(calendarItemKey({date, timed: true, timeMinutes: 5, body: 'Early'})).toBe(
      '@2026-01-19_0005',
    );
    expect(calendarItemKey({date, timed: true, timeMinutes: 60, body: 'Hour'})).toBe(
      '@2026-01-19_0100',
    );
  });

  it('two distinct timed events at the same minute share a token key', () => {
    const a = calendarItemTokenKey({date, timed: true, timeMinutes: 540});
    const b = calendarItemTokenKey({date, timed: true, timeMinutes: 540});
    expect(a).toBe(b);
  });

  it('different minutes produce different timed keys', () => {
    const a = calendarItemTokenKey({date, timed: true, timeMinutes: 540});
    const b = calendarItemTokenKey({date, timed: true, timeMinutes: 570});
    expect(a).not.toBe(b);
  });

  it('two untimed items on the same day with different titles have different keys', () => {
    const a = calendarItemKey({date, timed: false, timeMinutes: null, body: 'Birthday'});
    const b = calendarItemKey({date, timed: false, timeMinutes: null, body: 'Dentist'});
    expect(a).not.toBe(b);
  });

  it('normalizeCalendarTitle strips leading time and wiki links', () => {
    expect(normalizeCalendarTitle('09:00 [[alias|Standup]]')).toBe('standup');
  });
});

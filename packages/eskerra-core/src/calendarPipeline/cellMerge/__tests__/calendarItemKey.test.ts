import {describe, expect, it} from 'vitest';
import {calendarItemKey} from '../calendarItemKey';

describe('calendarItemKey', () => {
  const date = new Date(2026, 0, 19); // Jan 19 2026

  it('returns the @date_time token for timed items', () => {
    expect(calendarItemKey({date, timed: true, timeMinutes: 9 * 60 + 30})).toBe('@2026-01-19_0930');
  });

  it('returns the @date token for untimed items', () => {
    expect(calendarItemKey({date, timed: false, timeMinutes: null})).toBe('@2026-01-19');
  });

  it('pads hours and minutes to two digits', () => {
    expect(calendarItemKey({date, timed: true, timeMinutes: 5})).toBe('@2026-01-19_0005');
    expect(calendarItemKey({date, timed: true, timeMinutes: 60})).toBe('@2026-01-19_0100');
  });

  it('two distinct events at the same minute share a key', () => {
    const a = calendarItemKey({date, timed: true, timeMinutes: 540});
    const b = calendarItemKey({date, timed: true, timeMinutes: 540});
    expect(a).toBe(b);
  });

  it('different minutes produce different keys', () => {
    const a = calendarItemKey({date, timed: true, timeMinutes: 540});
    const b = calendarItemKey({date, timed: true, timeMinutes: 570});
    expect(a).not.toBe(b);
  });
});

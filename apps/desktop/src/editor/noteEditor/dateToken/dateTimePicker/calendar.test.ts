import {describe, expect, it} from 'vitest';

import {
  addDays,
  buildCalendarGrid,
  resolveInitialState,
  shiftMonth,
} from './calendar';

const FIXED_NOW = new Date(2026, 5, 6, 14, 30, 0, 0);

describe('dateTimePicker calendar', () => {
  it('builds a Monday-first grid for March 2026 with trailing days', () => {
    const cells = buildCalendarGrid(2026, 3);

    expect(cells).toHaveLength(42);
    expect(cells[0]).toEqual({
      year: 2026,
      month: 2,
      day: 23,
      inCurrentMonth: false,
    });
    expect(cells[6]).toEqual({
      year: 2026,
      month: 3,
      day: 1,
      inCurrentMonth: true,
    });
    expect(cells[41]).toEqual({
      year: 2026,
      month: 4,
      day: 5,
      inCurrentMonth: false,
    });
  });

  it('shifts month across year boundary', () => {
    expect(shiftMonth(2026, 12, 1)).toEqual({year: 2027, month: 1});
    expect(shiftMonth(2026, 1, -1)).toEqual({year: 2025, month: 12});
  });

  it('adds days across month and year boundaries', () => {
    expect(addDays(2026, 1, 31, 1)).toEqual({year: 2026, month: 2, day: 1});
    expect(addDays(2025, 12, 31, 1)).toEqual({year: 2026, month: 1, day: 1});
  });

  it('uses leap-year February length in the grid', () => {
    const leapFeb = buildCalendarGrid(2024, 2);
    const lastInMonth = leapFeb.filter(cell => cell.inCurrentMonth).at(-1);
    expect(lastInMonth?.day).toBe(29);

    const commonFeb = buildCalendarGrid(2025, 2);
    const lastCommon = commonFeb.filter(cell => cell.inCurrentMonth).at(-1);
    expect(lastCommon?.day).toBe(28);
  });

  it('resolves initial state for null, date-only, and date+time values', () => {
    expect(resolveInitialState(null, FIXED_NOW)).toEqual({
      selected: {year: 2026, month: 6, day: 6},
      viewYear: 2026,
      viewMonth: 6,
      noTime: true,
      hour: 0,
      minute: 0,
    });

    expect(resolveInitialState({year: 2026, month: 12, day: 28}, FIXED_NOW)).toEqual({
      selected: {year: 2026, month: 12, day: 28},
      viewYear: 2026,
      viewMonth: 12,
      noTime: true,
      hour: 0,
      minute: 0,
    });

    expect(
      resolveInitialState(
        {year: 2026, month: 12, day: 28, hour: 23, minute: 52},
        FIXED_NOW,
      ),
    ).toEqual({
      selected: {year: 2026, month: 12, day: 28},
      viewYear: 2026,
      viewMonth: 12,
      noTime: false,
      hour: 23,
      minute: 50,
    });
  });
});

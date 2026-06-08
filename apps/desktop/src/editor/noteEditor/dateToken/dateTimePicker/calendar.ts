import {
  daysInMonth,
  snapMinuteFieldToFiveMinuteGrid,
  snapTimeToFiveMinuteGrid,
  todayDateParts,
  type DateTokenValue,
} from '../dateToken';

import type {CalendarCell, DatePickerDate} from './types';

export function mondayBasedWeekday(year: number, month: number, day: number): number {
  const weekday = new Date(year, month - 1, day).getDay();
  return weekday === 0 ? 6 : weekday - 1;
}

export function shiftMonth(
  year: number,
  month: number,
  delta: number,
): {year: number; month: number} {
  const date = new Date(year, month - 1 + delta, 1);
  return {year: date.getFullYear(), month: date.getMonth() + 1};
}

export function addDays(
  year: number,
  month: number,
  day: number,
  delta: number,
): DatePickerDate {
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + delta);
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
  };
}

export function buildCalendarGrid(viewYear: number, viewMonth: number): CalendarCell[] {
  const cells: CalendarCell[] = [];
  const firstWeekday = mondayBasedWeekday(viewYear, viewMonth, 1);
  const daysInViewMonth = daysInMonth(viewYear, viewMonth);
  const prev = shiftMonth(viewYear, viewMonth, -1);
  const prevMonthDays = daysInMonth(prev.year, prev.month);

  for (let index = firstWeekday - 1; index >= 0; index--) {
    cells.push({
      year: prev.year,
      month: prev.month,
      day: prevMonthDays - index,
      inCurrentMonth: false,
    });
  }

  for (let day = 1; day <= daysInViewMonth; day++) {
    cells.push({
      year: viewYear,
      month: viewMonth,
      day,
      inCurrentMonth: true,
    });
  }

  const next = shiftMonth(viewYear, viewMonth, 1);
  let nextDay = 1;
  while (cells.length < 42) {
    cells.push({
      year: next.year,
      month: next.month,
      day: nextDay,
      inCurrentMonth: false,
    });
    nextDay++;
  }

  return cells;
}

export function resolveInitialState(
  initialValue: DateTokenValue | null,
  now: Date,
): {
  selected: DatePickerDate;
  viewYear: number;
  viewMonth: number;
  noTime: boolean;
  hour: number;
  minute: number;
  struck: boolean;
} {
  const selected = initialValue ?? todayDateParts(now);
  const hasTime =
    initialValue?.hour !== undefined && initialValue.minute !== undefined;
  const time = hasTime
    ? snapTimeToFiveMinuteGrid(initialValue!.hour!, initialValue!.minute!)
    : {hour: 0, minute: 0};
  return {
    selected: {
      year: selected.year,
      month: selected.month,
      day: selected.day,
    },
    viewYear: selected.year,
    viewMonth: selected.month,
    noTime: !hasTime,
    hour: time.hour,
    minute: time.minute,
    struck: initialValue?.struck === true,
  };
}

export function clampHour(value: number): number {
  return Math.min(23, Math.max(0, value));
}

export function clampMinute(value: number): number {
  return snapMinuteFieldToFiveMinuteGrid(value);
}

export function buildDateTokenValue(
  date: DatePickerDate,
  options: {noTime: boolean; hour: number; minute: number; struck?: boolean},
): DateTokenValue {
  const base = options.noTime
    ? {
        year: date.year,
        month: date.month,
        day: date.day,
      }
    : {
        year: date.year,
        month: date.month,
        day: date.day,
        hour: clampHour(options.hour),
        minute: clampMinute(options.minute),
      };
  if (options.struck) {
    return {...base, struck: true};
  }
  return base;
}

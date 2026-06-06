/**
 * Date token grammar: `@YYYY-MM-DD` or `@YYYY-MM-DD_HHMM` at a word boundary.
 * Pure helpers — no React or CodeMirror.
 */

export type DateTokenValue = {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour?: number;
  readonly minute?: number;
};

/**
 * Scan for date-token candidates in document text. Group 1 is the token span
 * (excludes leading whitespace from the word-boundary prefix).
 */
export const DATE_TOKEN_PATTERN =
  /(?:^|\s)(@\d{4}-\d{2}-\d{2}(?:_\d{4})?)/g;

/**
 * Match when the cursor is immediately after `@` at a word boundary (start of
 * line or after whitespace).
 */
export const DATE_TOKEN_PREFIX_PATTERN = /(?:^|\s)(@)$/;

const DATE_TOKEN_PARSE_RE = /^@(\d{4})-(\d{2})-(\d{2})(?:_(\d{4}))?$/;

export function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

export function pad4(value: number): string {
  return String(value).padStart(4, '0');
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  const days = [
    31,
    isLeapYear(year) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return days[month - 1]!;
}

export function isValidCalendarDate(
  year: number,
  month: number,
  day: number,
): boolean {
  if (month < 1 || month > 12 || day < 1) {
    return false;
  }
  return day <= daysInMonth(year, month);
}

function isValidTime(hour: number, minute: number): boolean {
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

export function todayDateParts(
  now: Date,
): Pick<DateTokenValue, 'year' | 'month' | 'day'> {
  return {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    day: now.getDate(),
  };
}

export function nowTimeParts(
  now: Date,
): Pick<Required<DateTokenValue>, 'hour' | 'minute'> {
  return {
    hour: now.getHours(),
    minute: now.getMinutes(),
  };
}

export function formatDateToken(value: DateTokenValue): string {
  const date = `@${value.year}-${pad2(value.month)}-${pad2(value.day)}`;
  if (value.hour === undefined || value.minute === undefined) {
    return date;
  }
  return `${date}_${pad2(value.hour)}${pad2(value.minute)}`;
}

export function formatTodayDateToken(now: Date): string {
  return formatDateToken(todayDateParts(now));
}

export function parseDateToken(text: string): DateTokenValue | null {
  const match = DATE_TOKEN_PARSE_RE.exec(text);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!isValidCalendarDate(year, month, day)) {
    return null;
  }

  const timeSuffix = match[4];
  if (timeSuffix === undefined) {
    return {year, month, day};
  }

  const hour = Number(timeSuffix.slice(0, 2));
  const minute = Number(timeSuffix.slice(2, 4));
  if (!isValidTime(hour, minute)) {
    return null;
  }

  return {year, month, day, hour, minute};
}

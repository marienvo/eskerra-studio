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
  /** Daemon-struck or user-completed reminder (`@~~…~~` on disk). */
  readonly struck?: boolean;
};

/**
 * Scan for date-token candidates in document text. Group 1 is the token span
 * (excludes leading whitespace from the word-boundary prefix).
 */
export const DATE_TOKEN_PATTERN =
  /(?:^|\s)(@\d{4}-\d{2}-\d{2}(?:_\d{4})?)/g;

/**
 * Struck reminder on disk: `@~~YYYY-MM-DD` or `@~~YYYY-MM-DD_HHMM~~`.
 * An optional backslash before `_` is accepted as escape noise from the daemon.
 */
export const STRUCK_DATE_TOKEN_PATTERN =
  /(?:^|\s)(@~~\d{4}-\d{2}-\d{2}(?:\\?_\d{4})?~~)/g;

export type DateTokenSpanInLine = {
  readonly token: string;
  readonly tokenStartInLine: number;
};

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

export function daysInMonth(year: number, month: number): number {
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

export const DATE_TOKEN_TIME_MINUTE_STEP = 5;

export const DATE_TOKEN_DEFAULT_LEAD_MINUTES = 15;

/**
 * Snaps a clock time to the nearest 5-minute boundary. Wraps past midnight back
 * to 00:00 (the picker keeps the selected calendar date unchanged).
 */
/** Snaps a minute field value to the 5-minute grid (00–55). */
export function snapMinuteFieldToFiveMinuteGrid(minute: number): number {
  const clamped = Math.min(59, Math.max(0, minute));
  const snapped =
    Math.round(clamped / DATE_TOKEN_TIME_MINUTE_STEP) * DATE_TOKEN_TIME_MINUTE_STEP;
  return Math.min(55, snapped);
}

export function snapTimeToFiveMinuteGrid(
  hour: number,
  minute: number,
): Pick<Required<DateTokenValue>, 'hour' | 'minute'> {
  let totalMinutes = hour * 60 + minute;
  totalMinutes =
    Math.round(totalMinutes / DATE_TOKEN_TIME_MINUTE_STEP) *
    DATE_TOKEN_TIME_MINUTE_STEP;
  const wrapped = ((totalMinutes % (24 * 60)) + 24 * 60) % (24 * 60);
  return {
    hour: Math.floor(wrapped / 60),
    minute: wrapped % 60,
  };
}

/**
 * Default reminder time: now plus 15 minutes, snapped to the nearest 5-minute
 * boundary.
 */
export function defaultDateTokenTimeFromNow(
  now: Date,
): Pick<Required<DateTokenValue>, 'hour' | 'minute'> {
  const future = new Date(
    now.getTime() + DATE_TOKEN_DEFAULT_LEAD_MINUTES * 60_000,
  );
  return snapTimeToFiveMinuteGrid(future.getHours(), future.getMinutes());
}

export function formatDateToken(value: DateTokenValue): string {
  const datePart = `${pad4(value.year)}-${pad2(value.month)}-${pad2(value.day)}`;
  const timePart =
    value.hour !== undefined && value.minute !== undefined
      ? `_${pad2(value.hour)}${pad2(value.minute)}`
      : '';
  if (value.struck) {
    return `@~~${datePart}${timePart}~~`;
  }
  const date = `@${datePart}`;
  if (!timePart) {
    return date;
  }
  return `${date}${timePart}`;
}

/** Maps daemon `\_` escape noise to `_` inside a struck span before parsing. */
export function normalizeStruckDateTokenTimeSeparator(text: string): string {
  return text.replace(/\\_/g, '_');
}

export function formatTodayDateToken(now: Date): string {
  return formatDateToken(todayDateParts(now));
}

/** Parses a live or struck full token span from the document. */
export function parseDateTokenSpan(span: string): DateTokenValue | null {
  if (span.startsWith('@~~') && span.endsWith('~~')) {
    const inner = span.slice(3, -2);
    const normalized = normalizeStruckDateTokenTimeSeparator(inner);
    const value = parseDateToken(`@${normalized}`);
    if (!value) {
      return null;
    }
    return {...value, struck: true};
  }
  const value = parseDateToken(span);
  if (!value) {
    return null;
  }
  return {...value, struck: false};
}

function spansOverlap(
  left: {start: number; end: number},
  right: {start: number; end: number},
): boolean {
  return left.start < right.end && right.start < left.end;
}

/**
 * Returns non-overlapping live and struck token spans on one line. Struck spans
 * are collected first so inner `@` digits never match as live tokens.
 */
export function collectDateTokenSpansInLine(
  lineText: string,
): DateTokenSpanInLine[] {
  const spans: DateTokenSpanInLine[] = [];
  const occupied: Array<{start: number; end: number}> = [];

  STRUCK_DATE_TOKEN_PATTERN.lastIndex = 0;
  let match = STRUCK_DATE_TOKEN_PATTERN.exec(lineText);
  while (match) {
    const token = match[1]!;
    if (parseDateTokenSpan(token) !== null) {
      const tokenStartInLine = match.index + match[0].length - token.length;
      spans.push({token, tokenStartInLine});
      occupied.push({
        start: tokenStartInLine,
        end: tokenStartInLine + token.length,
      });
    }
    match = STRUCK_DATE_TOKEN_PATTERN.exec(lineText);
  }

  DATE_TOKEN_PATTERN.lastIndex = 0;
  match = DATE_TOKEN_PATTERN.exec(lineText);
  while (match) {
    const token = match[1]!;
    const tokenStartInLine = match.index + match[0].length - token.length;
    const range = {
      start: tokenStartInLine,
      end: tokenStartInLine + token.length,
    };
    if (
      !occupied.some(o => spansOverlap(o, range))
      && parseDateTokenSpan(token) !== null
    ) {
      spans.push({token, tokenStartInLine});
    }
    match = DATE_TOKEN_PATTERN.exec(lineText);
  }

  spans.sort((a, b) => a.tokenStartInLine - b.tokenStartInLine);
  return spans;
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

const SHORT_WEEKDAYS = [
  'Sun',
  'Mon',
  'Tue',
  'Wed',
  'Thu',
  'Fri',
  'Sat',
] as const;

const PRETTY_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

function localMidnight(date: {year: number; month: number; day: number}): Date {
  return new Date(date.year, date.month - 1, date.day);
}

/** Whole days between two local midnights (target − base). */
function dayDifference(target: Date, base: Date): number {
  return Math.round((target.getTime() - base.getTime()) / 86_400_000);
}

/** Local midnight of the Monday starting the week `date` belongs to. */
function mondayOfWeek(date: Date): Date {
  const weekday = (date.getDay() + 6) % 7; // Mon = 0 … Sun = 6
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - weekday);
}

/** Whole Monday-based weeks between two dates (target − base). */
function weekDifference(target: Date, base: Date): number {
  const diffMs = mondayOfWeek(target).getTime() - mondayOfWeek(base).getTime();
  return Math.round(diffMs / (7 * 86_400_000));
}

function prettyTimeSuffix(value: DateTokenValue): string {
  if (value.hour === undefined || value.minute === undefined) {
    return '';
  }
  return ` at ${pad2(value.hour)}:${pad2(value.minute)}`;
}

function prettyAbsoluteDate(value: DateTokenValue, now: Date): string {
  const month = PRETTY_MONTHS[value.month - 1]!;
  const yearSuffix = value.year === now.getFullYear() ? '' : ` ${value.year}`;
  return `${value.day} ${month}${yearSuffix}`;
}

/**
 * Friendly label for a date token, without the bell. Future dates within two
 * weeks render relatively (Today / Tomorrow / weekday this week / "Next
 * <Weekday>" the following week); everything else is an absolute `28 Dec`
 * (with year when not the current one). Time, when present, is appended as
 * `at HH:MM`.
 */
export function formatDateTokenPretty(value: DateTokenValue, now: Date): string {
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const targetMidnight = localMidnight(value);
  const diffDays = dayDifference(targetMidnight, todayMidnight);
  const time = prettyTimeSuffix(value);

  let datePart: string;
  if (diffDays === 0) {
    datePart = 'Today';
  } else if (diffDays === 1) {
    datePart = 'Tom';
  } else if (diffDays >= 2 && diffDays <= 13) {
    const weekDiff = weekDifference(targetMidnight, todayMidnight);
    const weekday = SHORT_WEEKDAYS[targetMidnight.getDay()]!;
    if (weekDiff <= 0) {
      datePart = weekday;
    } else if (weekDiff === 1) {
      datePart = `Next ${weekday}`;
    } else {
      datePart = prettyAbsoluteDate(value, now);
    }
  } else {
    datePart = prettyAbsoluteDate(value, now);
  }

  return `${datePart}${time}`;
}

/**
 * Whether a token's moment has already passed. Tokens with a time compare to the
 * exact clock; date-only tokens are "past" only once the whole day is behind us
 * (a date-only token for today is not past).
 */
export function isDateTokenInPast(value: DateTokenValue, now: Date): boolean {
  if (value.hour !== undefined && value.minute !== undefined) {
    return (
      new Date(value.year, value.month - 1, value.day, value.hour, value.minute)
        .getTime() < now.getTime()
    );
  }
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return localMidnight(value).getTime() < todayMidnight.getTime();
}

import {unixSlashesStripTrailingNoTrim} from '../stringScanners';
import {type TodayHubStartDay, todayHubStartJsDay} from './parseTodayHubFrontmatter';

/**
 * Local-calendar first day of the week containing `reference`, using
 * JavaScript weekday numbers (Sunday = 0 … Saturday = 6).
 */
export function startOfLocalWeek(reference: Date, startDayJs: number): Date {
  const x = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate());
  const day = x.getDay();
  const diff = -((day - startDayJs + 7) % 7);
  x.setDate(x.getDate() + diff);
  return x;
}

/**
 * Local-calendar Monday start of the ISO-style week (Monday = first day).
 */
export function startOfLocalWeekMonday(reference: Date): Date {
  return startOfLocalWeek(reference, 1);
}

/**
 * Adds calendar days in the local timezone (same construction as {@link enumerateTodayHubWeekStarts}),
 * avoiding UTC `setDate` surprises around DST.
 */
export function addLocalCalendarDays(date: Date, deltaDays: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + deltaDays);
}

/**
 * Local-calendar week-start date of the week containing `date`, for a hub's configured start day.
 * Same bucketing as {@link enumerateTodayHubWeekStarts} (the row a given date belongs to).
 */
export function weekStartForDate(date: Date, start: TodayHubStartDay): Date {
  return startOfLocalWeek(date, todayHubStartJsDay(start));
}

/**
 * 53 consecutive week-start dates: previous week's anchor, then +7 days each step (local date).
 * Row files use `YYYY-MM-DD` of each anchor day.
 */
export function enumerateTodayHubWeekStarts(now: Date, start: TodayHubStartDay): Date[] {
  const js = todayHubStartJsDay(start);
  const thisWeekStart = startOfLocalWeek(now, js);
  const anchorDay = new Date(
    thisWeekStart.getFullYear(),
    thisWeekStart.getMonth(),
    thisWeekStart.getDate() - 7,
  );
  const out: Date[] = [];
  for (let k = 0; k < 53; k++) {
    out.push(addLocalCalendarDays(anchorDay, k * 7));
  }
  return out;
}

/** Same as `enumerateTodayHubWeekStarts(now, 'monday')`. */
export function enumerateTodayHubMondays(now: Date): Date[] {
  return enumerateTodayHubWeekStarts(now, 'monday');
}

/** Inclusive last calendar day of the week that begins on `weekStart` (local date; seven-day span). */
export function todayHubWeekEndInclusive(weekStart: Date): Date {
  return new Date(
    weekStart.getFullYear(),
    weekStart.getMonth(),
    weekStart.getDate() + 6,
  );
}

/** Progress of `now` within the 7-day window starting at `weekStart` (local calendar dates). */
export type TodayHubWeekProgress =
  | {kind: 'past'}
  | {kind: 'current'; dayIndex: number}
  | {kind: 'future'};

/**
 * Compares local calendar dates only. `dayIndex` for `current` is 0..6 where 0 is `weekStart`'s day.
 * Uses `Math.round(ms / dayMs)` so spans that are 23h or 25h between local midnights (DST) still count as one day.
 */
export function todayHubWeekProgress(weekStart: Date, now: Date): TodayHubWeekProgress {
  const start = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate());
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayMs = 24 * 60 * 60 * 1000;
  const diffDays = Math.round((today.getTime() - start.getTime()) / dayMs);
  if (diffDays < 0) {
    return {kind: 'future'};
  }
  if (diffDays > 6) {
    return {kind: 'past'};
  }
  return {kind: 'current', dayIndex: diffDays};
}

function localCalendarDateOnly(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Index 0..6 in the hub week window whose local calendar day has this JS `getDay()` (0=Sun … 6=Sat),
 * or `null` if missing (should not happen for a full 7-day span).
 */
export function todayHubWeekDayIndexForJsWeekday(weekStart: Date, jsWeekday: number): number | null {
  const ws = localCalendarDateOnly(weekStart);
  for (let i = 0; i < 7; i++) {
    if (addLocalCalendarDays(ws, i).getDay() === jsWeekday) {
      return i;
    }
  }
  return null;
}

/** When Saturday and Sunday sit at consecutive indices in the week strip, UI may merge them. */
export type TodayHubWeekendMergePair = {satIndex: number; sunIndex: number};

/**
 * If Saturday (JS 6) and Sunday (JS 0) in `weekStart`…+6 appear at indices `i` and `i+1`, returns them.
 * Otherwise `null` (e.g. Sunday-start week: Sat at 6, Sun at 0).
 */
export function todayHubWeekendMergePair(weekStart: Date): TodayHubWeekendMergePair | null {
  const iSat = todayHubWeekDayIndexForJsWeekday(weekStart, 6);
  const iSun = todayHubWeekDayIndexForJsWeekday(weekStart, 0);
  if (iSat == null || iSun == null) {
    return null;
  }
  if (iSun === iSat + 1) {
    return {satIndex: iSat, sunIndex: iSun};
  }
  return null;
}

/**
 * Single past/current/future state for the merged Sat–Sun pair, by local calendar `now`.
 * Returns `null` when {@link todayHubWeekendMergePair} is `null` (no merged weekend in this week layout).
 */
export function todayHubWeekendSegmentState(
  weekStart: Date,
  now: Date,
): 'past' | 'current' | 'future' | null {
  const merge = todayHubWeekendMergePair(weekStart);
  if (!merge) {
    return null;
  }
  const ws = localCalendarDateOnly(weekStart);
  const sat = localCalendarDateOnly(addLocalCalendarDays(ws, merge.satIndex));
  const sun = localCalendarDateOnly(addLocalCalendarDays(ws, merge.sunIndex));
  const today = localCalendarDateOnly(now);
  const t = today.getTime();
  if (t < sat.getTime()) {
    return 'future';
  }
  if (t > sun.getTime()) {
    return 'past';
  }
  return 'current';
}

/** Visual segment for week progress UI (`filled` / `current` / `empty`). */
export type TodayHubWeekProgressSegmentKind = 'filled' | 'current' | 'empty';

export type TodayHubWeekProgressSegment = {
  key: string;
  /** Hub day index 0..6, or `null` for merged Sat–Sun block. */
  dayIndex: number | null;
  kind: TodayHubWeekProgressSegmentKind;
  widthPx: number;
};

function todayHubDaySegmentKind(
  progress: TodayHubWeekProgress,
  dayIndex: number,
): TodayHubWeekProgressSegmentKind {
  if (progress.kind === 'past') {
    return 'filled';
  }
  if (progress.kind === 'future') {
    return 'empty';
  }
  if (dayIndex < progress.dayIndex) {
    return 'filled';
  }
  if (dayIndex === progress.dayIndex) {
    return 'current';
  }
  return 'empty';
}

/**
 * Row of progress segments (7 narrow cells, or 6 with a wide merged weekend when Sat/Sun are adjacent).
 * `cellPx` / `gapPx` match spacing between unit cells; merged weekend width is `2 * cellPx + gapPx`.
 */
export function todayHubWeekProgressSegments(
  progress: TodayHubWeekProgress,
  weekStart: Date,
  now: Date,
  cellPx: number,
  gapPx: number,
): TodayHubWeekProgressSegment[] {
  const merge = todayHubWeekendMergePair(weekStart);
  if (!merge) {
    return Array.from({length: 7}, (_, i) => ({
      key: `d${i}`,
      dayIndex: i,
      kind: todayHubDaySegmentKind(progress, i),
      widthPx: cellPx,
    }));
  }
  const widePx = cellPx * 2 + gapPx;
  const wk = todayHubWeekendSegmentState(weekStart, now);
  const weekendKind: TodayHubWeekProgressSegmentKind =
    wk === 'past' ? 'filled' : wk === 'current' ? 'current' : 'empty';

  const out: TodayHubWeekProgressSegment[] = [];
  for (let i = 0; i < merge.satIndex; i++) {
    out.push({
      key: `d${i}`,
      dayIndex: i,
      kind: todayHubDaySegmentKind(progress, i),
      widthPx: cellPx,
    });
  }
  out.push({
    key: 'we',
    dayIndex: null,
    kind: weekendKind,
    widthPx: widePx,
  });
  for (let i = merge.sunIndex + 1; i < 7; i++) {
    out.push({
      key: `d${i}`,
      dayIndex: i,
      kind: todayHubDaySegmentKind(progress, i),
      widthPx: cellPx,
    });
  }
  return out;
}

/** `YYYY-MM-DD` for the row filename stem (local calendar); identifies the week's first day. */
export function formatTodayHubMondayStem(weekStart: Date): string {
  const y = weekStart.getFullYear();
  const mo = String(weekStart.getMonth() + 1).padStart(2, '0');
  const da = String(weekStart.getDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

export function todayHubRowUri(hubDirectoryUri: string, weekStart: Date): string {
  const base = unixSlashesStripTrailingNoTrim(hubDirectoryUri);
  return `${base}/${formatTodayHubMondayStem(weekStart)}.md`;
}

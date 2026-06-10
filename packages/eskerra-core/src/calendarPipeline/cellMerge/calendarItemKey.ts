/**
 * Identity keys for Calendar items, shared between bucketing (agenda vs ICS dedup) and cell merge
 * (incoming vs existing dedup). See `specs/architecture/calendar-ics-agenda-pipeline.md` (Part 3b).
 *
 * - Timed:   `@YYYY-MM-DD_HHMM` — day + clock time; title is excluded so the user can freely edit
 *            the display text without causing a re-insertion.
 * - Untimed: `@YYYY-MM-DD`.
 *
 * Trade-off: two distinct timed events at the exact same minute share a key and are treated as one.
 */
import {formatCalendarToken} from './calendarDateToken';

export type CalendarItemKeyInput = {
  date: Date;
  timed: boolean;
  timeMinutes: number | null;
};

/** Stable identity for a calendar item; equal keys are treated as the same item across runs. */
export function calendarItemKey(item: CalendarItemKeyInput): string {
  return formatCalendarToken(item.date, item.timed ? item.timeMinutes : null);
}

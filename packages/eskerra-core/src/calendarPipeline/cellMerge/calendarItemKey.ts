/**
 * Identity keys for Calendar items, shared between bucketing (agenda vs ICS dedup) and cell merge
 * (incoming vs existing dedup). See `specs/plans/calendar-ics-agenda-pipeline.md` (Part 3b).
 *
 * - Timed:   `"{YYYY-MM-DD}|{HH:MM}"` — calendar day of the item + clock time.
 * - Untimed: `"{YYYY-MM-DD}|{normalizedTitle}"`.
 */

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function timeKey(timeMinutes: number): string {
  return `${pad2(Math.floor(timeMinutes / 60))}:${pad2(timeMinutes % 60)}`;
}

/**
 * Normalizes a Calendar item body for untimed dedup: strip a leading `HH:MM`, drop the agenda
 * `[🗓️](<...>)` icon link, reduce wiki links to their visible text, collapse whitespace, lowercase.
 * Intentionally lighter than full emoji/punctuation stripping so distinct titles stay distinct.
 */
export function normalizeCalendarTitle(body: string): string {
  return body
    .replace(/\[🗓️\]\(<[^>]*>\)/g, ' ')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^([01]\d|2[0-3]):([0-5]\d)\s*/, '')
    .trim()
    .toLowerCase();
}

export type CalendarItemKeyInput = {
  date: Date;
  timed: boolean;
  timeMinutes: number | null;
  body: string;
};

/** Stable identity for a calendar item; equal keys are treated as the same item across runs. */
export function calendarItemKey(item: CalendarItemKeyInput): string {
  if (item.timed && item.timeMinutes != null) {
    return `${localDayKey(item.date)}|${timeKey(item.timeMinutes)}`;
  }
  return `${localDayKey(item.date)}|${normalizeCalendarTitle(item.body)}`;
}

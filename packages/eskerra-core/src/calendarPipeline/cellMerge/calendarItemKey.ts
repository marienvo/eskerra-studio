/**
 * Identity keys for Calendar items, shared between bucketing (agenda vs ICS dedup) and cell merge
 * (incoming vs existing dedup). See `specs/plans/calendar-ics-agenda-pipeline.md` (Part 3b).
 *
 * - Timed:   `"{YYYY-MM-DD}|{HH:MM}"` — calendar day of the item + clock time.
 * - Untimed: `"{YYYY-MM-DD}|{normalizedTitle}"`.
 */
import {collapseAsciiWhitespaceRunsToSpace, isAsciiWhitespaceCode} from '../../stringScanners';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function timeKey(timeMinutes: number): string {
  return `${pad2(Math.floor(timeMinutes / 60))}:${pad2(timeMinutes % 60)}`;
}

const AGENDA_ICON_PREFIX = '[🗓️](<';
const AGENDA_ICON_SUFFIX = '>)';

/** Strip `[🗓️](<...>)` agenda icon links. Linear — no regex backtracking. */
function stripAgendaIconLinks(s: string): string {
  if (!s.includes(AGENDA_ICON_PREFIX)) return s;
  let out = '';
  let i = 0;
  while (i < s.length) {
    const idx = s.indexOf(AGENDA_ICON_PREFIX, i);
    if (idx < 0) { out += s.slice(i); break; }
    out += s.slice(i, idx) + ' ';
    const closeIdx = s.indexOf(AGENDA_ICON_SUFFIX, idx + AGENDA_ICON_PREFIX.length);
    if (closeIdx < 0) { out += s.slice(idx); break; }
    i = closeIdx + AGENDA_ICON_SUFFIX.length;
  }
  return out;
}

/** Expand `[[alias|label]]` → `label` and `[[title]]` → `title`. Linear — no regex backtracking. */
function expandWikiLinks(s: string): string {
  if (!s.includes('[[')) return s;
  let out = '';
  let i = 0;
  while (i < s.length) {
    const open = s.indexOf('[[', i);
    if (open < 0) { out += s.slice(i); break; }
    out += s.slice(i, open);
    const close = s.indexOf(']]', open + 2);
    if (close < 0) { out += s.slice(open); break; }
    const inner = s.slice(open + 2, close);
    const pipe = inner.indexOf('|');
    out += pipe >= 0 ? inner.slice(pipe + 1) : inner;
    i = close + 2;
  }
  return out;
}

/** Strip a leading `HH:MM` (and trailing whitespace). Linear — no regex backtracking. */
function stripLeadingTime(s: string): string {
  if (s.length < 5) return s;
  const c0 = s.charCodeAt(0);
  const c1 = s.charCodeAt(1);
  const colon = s.charCodeAt(2);
  const c3 = s.charCodeAt(3);
  const c4 = s.charCodeAt(4);
  if (colon !== 58) return s; // ':'
  if (c3 < 48 || c3 > 53 || c4 < 48 || c4 > 57) return s; // minutes [0-5]\d
  const validHour =
    ((c0 === 48 || c0 === 49) && c1 >= 48 && c1 <= 57) || // [01]\d = 00–19
    (c0 === 50 && c1 >= 48 && c1 <= 51); // 2[0-3] = 20–23
  if (!validHour) return s;
  let i = 5;
  while (i < s.length && isAsciiWhitespaceCode(s.charCodeAt(i))) i++;
  return s.slice(i);
}

/**
 * Normalizes a Calendar item body for untimed dedup: strip a leading `HH:MM`, drop the agenda
 * `[🗓️](<...>)` icon link, reduce wiki links to their visible text, collapse whitespace, lowercase.
 * Intentionally lighter than full emoji/punctuation stripping so distinct titles stay distinct.
 */
export function normalizeCalendarTitle(body: string): string {
  const s = collapseAsciiWhitespaceRunsToSpace(expandWikiLinks(stripAgendaIconLinks(body))).trim();
  return stripLeadingTime(s).trim().toLowerCase();
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

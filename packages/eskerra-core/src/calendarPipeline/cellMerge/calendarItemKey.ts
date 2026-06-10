/**
 * Identity keys for Calendar items, shared between bucketing (agenda vs ICS dedup) and cell merge
 * (incoming vs existing dedup). See `specs/architecture/calendar-ics-agenda-pipeline.md` (Part 3b).
 *
 * - Timed:   `@YYYY-MM-DD_HHMM` — day + clock time; title is excluded so the user can freely edit
 *            the display text without causing a re-insertion.
 * - Untimed: `@YYYY-MM-DD|{normalizedTitle}` — multiple untimed items on the same day stay distinct.
 *
 * Trade-off: two distinct timed events at the exact same minute share a token key and are treated
 * as one.
 */
import {collapseAsciiWhitespaceRunsToSpace, isAsciiWhitespaceCode} from '../../stringScanners';
import {formatCalendarToken} from './calendarDateToken';

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
 */
export function normalizeCalendarTitle(body: string): string {
  const s = collapseAsciiWhitespaceRunsToSpace(expandWikiLinks(stripAgendaIconLinks(body))).trim();
  return stripLeadingTime(s).trim().toLowerCase();
}

export type CalendarItemKeyInput = {
  date: Date;
  timed: boolean;
  timeMinutes: number | null;
};

export type CalendarItemFullKeyInput = CalendarItemKeyInput & {
  body: string;
};

/** `@YYYY-MM-DD` or `@YYYY-MM-DD_HHMM` — used for timed dedup and title-edit tolerance. */
export function calendarItemTokenKey(item: CalendarItemKeyInput): string {
  return formatCalendarToken(item.date, item.timed ? item.timeMinutes : null);
}

/**
 * Merge/bucket identity: timed items use the token only; untimed items include normalized title so
 * multiple same-day events stay distinct.
 */
export function calendarItemFullKey(item: CalendarItemFullKeyInput): string {
  const token = calendarItemTokenKey(item);
  if (item.timed) {
    return token;
  }
  return `${token}|${normalizeCalendarTitle(item.body)}`;
}

/** Stable identity for bucketing and exact incoming dedup; equal keys are the same item across runs. */
export function calendarItemKey(item: CalendarItemFullKeyInput): string {
  return calendarItemFullKey(item);
}

/** Keys seeded from an existing pipeline line for merge dedup. */
export function calendarItemExistingDedupKeys(item: CalendarItemFullKeyInput): string[] {
  if (item.timed) {
    return [calendarItemTokenKey(item)];
  }
  return [calendarItemFullKey(item)];
}

/** Returns true when an incoming item should be skipped against the merge `seen` set. */
export function calendarItemIncomingIsDuplicate(
  item: CalendarItemFullKeyInput,
  seen: ReadonlySet<string>,
): boolean {
  if (item.timed) {
    return seen.has(calendarItemTokenKey(item));
  }
  return seen.has(calendarItemFullKey(item));
}

/** Records keys for a newly accepted incoming item in the merge `seen` set. */
export function calendarItemRecordIncomingDedup(
  item: CalendarItemFullKeyInput,
  seen: Set<string>,
): void {
  if (item.timed) {
    seen.add(calendarItemTokenKey(item));
    return;
  }
  seen.add(calendarItemFullKey(item));
}

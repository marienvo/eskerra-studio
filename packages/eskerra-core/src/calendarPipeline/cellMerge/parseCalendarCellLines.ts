/**
 * Read-only classifier for an existing Calendar cell. Maps each non-empty line to a
 * {@link CalendarCellLine} so the merge step can locate keys + insert points **without** mutating or
 * re-serializing existing text. Its output is never written back to disk.
 * See `specs/architecture/calendar-ics-agenda-pipeline.md` (Part 3b).
 */

import {parseCalendarTokenLine} from './calendarDateToken';
import type {CalendarCellLine} from './types';

// `**Wd d:** body` — 2–3 letter weekday, day 1–31. Body may be empty.
const LEGACY_PIPELINE_ITEM_RE = /^\*\*([A-Za-z]{2,3}) (\d{1,2}):\*\*[ \t]?(.*)$/;
const LEADING_TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)\b/;

/** Resolve a day-of-month to its date within the 7-day window starting at `weekStart`. */
function dateForDayInWeek(weekStart: Date, dayOfMonth: number): Date | null {
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + i);
    if (d.getDate() === dayOfMonth) {
      return d;
    }
  }
  return null;
}

function parseLegacyPipelineLine(raw: string, weekStart: Date): CalendarCellLine | null {
  const m = LEGACY_PIPELINE_ITEM_RE.exec(raw);
  if (!m) {
    return null;
  }
  const dayOfMonth = Number(m[2]);
  if (dayOfMonth < 1 || dayOfMonth > 31) {
    return null;
  }
  const date = dateForDayInWeek(weekStart, dayOfMonth);
  if (date == null) {
    return null;
  }
  const body = m[3] ?? '';
  const timeMatch = LEADING_TIME_RE.exec(body);
  const timeMinutes = timeMatch ? Number(timeMatch[1]) * 60 + Number(timeMatch[2]) : null;
  return {
    kind: 'pipelineItem',
    raw,
    date,
    timed: timeMinutes != null,
    timeMinutes,
    body,
  };
}

/**
 * Classifies every non-empty line of `cellText`. Lines starting with a valid `@YYYY-MM-DD` token are
 * `pipelineItem`. When `weekStart` is provided, legacy `**Wd d:**` lines are also classified as
 * `pipelineItem` (for dedup keys only — `raw` is preserved verbatim). Everything else is `freeform`.
 */
export function parseCalendarCellLines(cellText: string, weekStart?: Date): CalendarCellLine[] {
  const out: CalendarCellLine[] = [];
  for (const raw of cellText.replace(/\r\n/g, '\n').split('\n')) {
    if (raw.trim().length === 0) {
      continue;
    }
    const parsed = parseCalendarTokenLine(raw);
    if (parsed) {
      out.push({
        kind: 'pipelineItem',
        raw,
        date: parsed.date,
        timed: parsed.timed,
        timeMinutes: parsed.timeMinutes,
        body: parsed.rest,
      });
      continue;
    }
    if (weekStart != null) {
      const legacy = parseLegacyPipelineLine(raw, weekStart);
      if (legacy) {
        out.push(legacy);
        continue;
      }
    }
    out.push({kind: 'freeform', raw});
  }
  return out;
}

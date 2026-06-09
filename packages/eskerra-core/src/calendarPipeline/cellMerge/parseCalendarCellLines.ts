/**
 * Read-only classifier for an existing Calendar cell. Maps each non-empty line to a
 * {@link CalendarCellLine} so the merge step can locate keys + insert points **without** mutating or
 * re-serializing existing text. Its output is never written back to disk.
 * See `specs/plans/calendar-ics-agenda-pipeline.md` (Part 3b).
 */

import {monthIdxFromH2Title} from '../agenda/agendaShared';
import type {CalendarCellLine} from './types';

// `**Wd d:** body` — 2–3 letter weekday, day 1–31. Body may be empty.
const PIPELINE_ITEM_RE = /^\*\*([A-Za-z]{2,3}) (\d{1,2}):\*\*[ \t]?(.*)$/;
// `**...**` with no internal `**` — candidate month heading.
const BOLD_LINE_RE = /^\*\*([^*]+)\*\*$/;
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

function parsePipelineLine(raw: string, weekStart: Date): CalendarCellLine | null {
  const m = PIPELINE_ITEM_RE.exec(raw);
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
  const body = m[3];
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

function parseMonthHeadingLine(raw: string): CalendarCellLine | null {
  const m = BOLD_LINE_RE.exec(raw.trim());
  if (!m) {
    return null;
  }
  const monthIdx = monthIdxFromH2Title(m[1]);
  if (monthIdx == null) {
    return null;
  }
  return {kind: 'monthHeading', raw, monthIdx};
}

/**
 * Classifies every non-empty line of `cellText`. `weekStart` resolves a line's day-of-month to a full
 * date (a 7-day window has distinct day numbers, so this is unambiguous). Anything that is neither a
 * `**Wd d:**` item nor a month heading is {@link CalendarCellLine} `freeform` and must be preserved.
 */
export function parseCalendarCellLines(cellText: string, weekStart: Date): CalendarCellLine[] {
  const out: CalendarCellLine[] = [];
  for (const raw of cellText.replace(/\r\n/g, '\n').split('\n')) {
    if (raw.trim().length === 0) {
      continue;
    }
    const pipeline = parsePipelineLine(raw, weekStart);
    if (pipeline) {
      out.push(pipeline);
      continue;
    }
    const heading = parseMonthHeadingLine(raw);
    if (heading) {
      out.push(heading);
      continue;
    }
    out.push({kind: 'freeform', raw});
  }
  return out;
}

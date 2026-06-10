/**
 * Read-only classifier for an existing Calendar cell. Maps each non-empty line to a
 * {@link CalendarCellLine} so the merge step can locate keys + insert points **without** mutating or
 * re-serializing existing text. Its output is never written back to disk.
 * See `specs/architecture/calendar-ics-agenda-pipeline.md` (Part 3b).
 */

import {parseCalendarTokenLine} from './calendarDateToken';
import type {CalendarCellLine} from './types';

/**
 * Classifies every non-empty line of `cellText`. Lines starting with a valid `@YYYY-MM-DD` token
 * are `pipelineItem`; everything else (including legacy `**Wd d:**` lines) is `freeform`.
 */
export function parseCalendarCellLines(cellText: string): CalendarCellLine[] {
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
    out.push({kind: 'freeform', raw});
  }
  return out;
}

/**
 * INSERT-ONLY merge of incoming pipeline items into an existing Calendar cell.
 *
 * Guards both failure modes (see `specs/architecture/calendar-ics-agenda-pipeline.md`, Part 3b):
 *  - **Data-loss:** existing cell text is kept byte-verbatim and never reordered; parsing existing
 *    lines is read-only (to find keys + insert points). Only new lines are inserted.
 *  - **Append-loop:** an incoming item whose key already exists as a `pipelineItem` line is skipped.
 *
 * Only items in upsert scope are considered (strict-future ICS timed, today+future ICS untimed /
 * agenda timed, strictly-future agenda untimed). Out-of-scope incoming items are ignored (but
 * existing lines are never removed).
 */

import {
  calendarItemExistingDedupKeys,
  calendarItemIncomingIsDuplicate,
  calendarItemRecordIncomingDedup,
} from './calendarItemKey';
import {parseCalendarCellLines} from './parseCalendarCellLines';
import {
  compareCalendarItems,
  renderCalendarCellFromScratch,
  renderCalendarItemLine,
} from './renderCalendarCellLines';
import type {CalendarCellLine, CalendarItem} from './types';

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Per-source upsert scope from the legacy year-log Present/Future rules. */
export function isCalendarItemInUpsertScope(item: CalendarItem, now: Date): boolean {
  const todayMs = startOfLocalDay(now).getTime();
  const itemDayMs = startOfLocalDay(item.date).getTime();
  if (item.source === 'calendar') {
    if (item.timed) {
      const instant = item.instant ?? item.date;
      return instant.getTime() > now.getTime();
    }
    return itemDayMs >= todayMs;
  }
  // agenda
  if (item.timed) {
    return itemDayMs >= todayMs;
  }
  return itemDayMs > todayMs;
}

function isBlank(text: string): boolean {
  return text.trim().length === 0;
}

/** Sort key tuple comparison reusing the chronological item comparator on a synthetic item. */
function lineSortsAfter(line: Extract<CalendarCellLine, {kind: 'pipelineItem'}>, item: CalendarItem): boolean {
  const lineAsItem: CalendarItem = {
    date: line.date,
    timed: line.timed,
    timeMinutes: line.timeMinutes,
    body: line.body,
    source: 'calendar',
    instant: null,
    order: Number.MAX_SAFE_INTEGER,
  };
  return compareCalendarItems(lineAsItem, item) > 0;
}

/**
 * Merges `incomingItems` into `existingText`, returning the new cell body. Idempotent: re-running
 * with the same inputs inserts nothing and returns byte-identical text.
 *
 * `weekStart` resolves day-of-month on legacy `**Wd d:**` lines for dedup keys only.
 */
export function mergeCalendarCellContent(
  existingText: string,
  incomingItems: CalendarItem[],
  now: Date,
  weekStart?: Date,
): string {
  const scoped = incomingItems.filter(item => isCalendarItemInUpsertScope(item, now));

  // Empty/owned cell: fill in one shot (no existing content at risk).
  if (isBlank(existingText)) {
    return renderCalendarCellFromScratch(scoped);
  }

  const classified = parseCalendarCellLines(existingText, weekStart);
  const existingKeys = new Set<string>();
  for (const line of classified) {
    if (line.kind === 'pipelineItem') {
      for (const key of calendarItemExistingDedupKeys(line)) {
        existingKeys.add(key);
      }
    }
  }

  // Determine which incoming items are genuinely new (and not duplicated among themselves).
  const seen = new Set<string>(existingKeys);
  const toInsert: CalendarItem[] = [];
  for (const item of [...scoped].sort(compareCalendarItems)) {
    if (calendarItemIncomingIsDuplicate(item, seen)) {
      continue;
    }
    calendarItemRecordIncomingDedup(item, seen);
    toInsert.push(item);
  }
  if (toInsert.length === 0) {
    return existingText;
  }

  // Work on the raw line array; insert new lines without touching existing ones.
  const workingLines = existingText.replace(/\r\n/g, '\n').split('\n');
  // Map each working-line index to its classification (skipping blanks => undefined).
  const classifiedByIndex = new Map<number, CalendarCellLine>();
  {
    let ci = 0;
    for (let i = 0; i < workingLines.length; i++) {
      if (workingLines[i].trim().length === 0) {
        continue;
      }
      classifiedByIndex.set(i, classified[ci]);
      ci += 1;
    }
  }

  for (const item of toInsert) {
    // Insert before the first existing pipelineItem line that sorts after this item; else append.
    let insertIdx = workingLines.length;
    for (let i = 0; i < workingLines.length; i++) {
      const line = classifiedByIndex.get(i);
      if (line?.kind === 'pipelineItem' && lineSortsAfter(line, item)) {
        insertIdx = i;
        break;
      }
    }

    const newLine = renderCalendarItemLine(item);
    workingLines.splice(insertIdx, 0, newLine);

    // Keep classifiedByIndex in sync so later inserts see the new pipeline line.
    const rebuilt = new Map<number, CalendarCellLine>();
    for (const [idx, line] of classifiedByIndex) {
      rebuilt.set(idx >= insertIdx ? idx + 1 : idx, line);
    }
    rebuilt.set(insertIdx, {
      kind: 'pipelineItem',
      raw: newLine,
      date: item.date,
      timed: item.timed,
      timeMinutes: item.timeMinutes,
      body: item.body,
    });
    classifiedByIndex.clear();
    for (const [idx, line] of rebuilt) {
      classifiedByIndex.set(idx, line);
    }
  }

  return workingLines.join('\n');
}

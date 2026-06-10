/**
 * INSERT-ONLY merge of incoming pipeline items into an existing Calendar cell.
 *
 * Guards both failure modes (see `specs/plans/calendar-ics-agenda-pipeline.md`, Part 3b):
 *  - **Data-loss:** existing cell text is kept byte-verbatim and never reordered; parsing existing
 *    lines is read-only (to find keys + insert points). Only new lines are inserted.
 *  - **Append-loop:** an incoming item whose key already exists as a `pipelineItem` line is skipped,
 *    and a month heading is added only when that month is not already represented.
 *
 * Only items in upsert scope are considered (strict-future ICS timed, today+future ICS untimed /
 * agenda timed, strictly-future agenda untimed). Out-of-scope incoming items are ignored (but
 * existing lines are never removed).
 */

import {calendarItemKey} from './calendarItemKey';
import {parseCalendarCellLines} from './parseCalendarCellLines';
import {
  compareCalendarItems,
  renderCalendarCellFromScratch,
  renderCalendarItemLine,
  renderMonthHeadingLine,
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

/**
 * Resolves a bare `monthIdx` (month headings carry no year) to a comparable `year*12+month` ordinal,
 * using the week range. A week spans at most two adjacent months, so a non-`weekStart` month must be
 * the `weekStart + 6` month — this keeps Dec→Jan week boundaries chronologically ordered.
 */
function monthOrdinalInWeek(weekStart: Date, monthIdx: number): number {
  if (monthIdx === weekStart.getMonth()) {
    return weekStart.getFullYear() * 12 + monthIdx;
  }
  const weekEnd = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 6);
  return weekEnd.getFullYear() * 12 + monthIdx;
}

/** Sort key tuple comparison reusing the chronological item comparator on a synthetic item. */
function lineSortsAfter(line: Extract<CalendarCellLine, {kind: 'pipelineItem'}>, item: CalendarItem): boolean {
  const lineAsItem: CalendarItem = {
    date: line.date,
    timed: line.timed,
    timeMinutes: line.timeMinutes,
    body: line.body,
    monthIdx: line.date.getMonth(),
    monthHeading: '',
    // Existing lines have unknown source; treat as 'calendar' so an agenda item with an equal
    // (date, timed, time) tuple inserts *before* it — agenda precedence, best effort.
    source: 'calendar',
    instant: null,
    order: Number.MAX_SAFE_INTEGER,
  };
  return compareCalendarItems(lineAsItem, item) > 0;
}

/**
 * Merges `incomingItems` into `existingText`, returning the new cell body. Idempotent: re-running
 * with the same inputs inserts nothing and returns byte-identical text.
 */
export function mergeCalendarCellContent(
  existingText: string,
  incomingItems: CalendarItem[],
  weekStart: Date,
  now: Date,
): string {
  const scoped = incomingItems.filter(item => isCalendarItemInUpsertScope(item, now));

  // Empty/owned cell: fill in one shot (no existing content at risk).
  if (isBlank(existingText)) {
    return renderCalendarCellFromScratch(scoped);
  }

  const classified = parseCalendarCellLines(existingText, weekStart);
  const existingKeys = new Set<string>();
  const monthsPresent = new Set<number>();
  for (const line of classified) {
    if (line.kind === 'pipelineItem') {
      existingKeys.add(calendarItemKey(line));
    } else if (line.kind === 'monthHeading') {
      monthsPresent.add(line.monthIdx);
    }
  }

  // Determine which incoming items are genuinely new (and not duplicated among themselves).
  const seen = new Set<string>(existingKeys);
  const toInsert: CalendarItem[] = [];
  for (const item of [...scoped].sort(compareCalendarItems)) {
    const key = calendarItemKey(item);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
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
    // Insert position: before the first existing line that sorts after this item; else end. We stop
    // at a later-month heading too (not just pipeline items), so a new earlier-month heading lands
    // before an already-present later-month heading instead of nesting under it.
    let insertIdx = workingLines.length;
    const itemMonthOrd = item.date.getFullYear() * 12 + item.date.getMonth();
    for (let i = 0; i < workingLines.length; i++) {
      const line = classifiedByIndex.get(i);
      if (line?.kind === 'pipelineItem' && lineSortsAfter(line, item)) {
        insertIdx = i;
        break;
      }
      if (line?.kind === 'monthHeading' && monthOrdinalInWeek(weekStart, line.monthIdx) > itemMonthOrd) {
        insertIdx = i;
        break;
      }
    }

    const newLines: string[] = [];
    if (!monthsPresent.has(item.monthIdx)) {
      monthsPresent.add(item.monthIdx);
      newLines.push(renderMonthHeadingLine(item));
    }
    newLines.push(renderCalendarItemLine(item));

    workingLines.splice(insertIdx, 0, ...newLines);
    // Keep classifiedByIndex in sync so later inserts see the new pipeline line.
    const rebuilt = new Map<number, CalendarCellLine>();
    for (const [idx, line] of classifiedByIndex) {
      rebuilt.set(idx >= insertIdx ? idx + newLines.length : idx, line);
    }
    const insertedItemIdx = insertIdx + newLines.length - 1;
    rebuilt.set(insertedItemIdx, {
      kind: 'pipelineItem',
      raw: newLines[newLines.length - 1],
      date: item.date,
      timed: item.timed,
      timeMinutes: item.timeMinutes,
      body: item.body,
    });
    if (newLines.length === 2) {
      rebuilt.set(insertIdx, {kind: 'monthHeading', raw: newLines[0], monthIdx: item.monthIdx});
    }
    classifiedByIndex.clear();
    for (const [idx, line] of rebuilt) {
      classifiedByIndex.set(idx, line);
    }
  }

  return workingLines.join('\n');
}

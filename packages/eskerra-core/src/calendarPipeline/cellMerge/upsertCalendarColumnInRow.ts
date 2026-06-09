/**
 * Merges incoming calendar items into the Calendar column of a Today Hub week-row body — and only
 * that column. Other columns are kept byte-identical (no re-serialization beyond the canonical disk
 * normalization the app already applies on every row write).
 *
 * **Fail closed:** if the existing body does not split into exactly `columnCount` clean segments
 * (delimiter count ≠ `columnCount - 1`, or the Calendar index is out of range), it returns
 * `{kind: 'skip'}` instead of risking a wrong-column write. A non-existent/blank row is treated as a
 * fresh fill (not ambiguous).
 *
 * See `specs/plans/calendar-ics-agenda-pipeline.md` (Part 3b).
 */

import {
  mergeTodayRowColumns,
  normalizeTodayHubRowForDisk,
  splitTodayRowIntoColumns,
} from '../../todayHub/splitMergeTodayRowColumns';
import {mergeCalendarCellContent} from './mergeCalendarCellContent';
import type {CalendarItem} from './types';

export type UpsertCalendarColumnInRowInput = {
  /** Full existing row-file body (`YYYY-MM-DD.md`); empty/whitespace means the row does not exist. */
  rowBody: string;
  columnCount: number;
  /** Split-segment index of the Calendar column (`columns.indexOf('Calendar') + 1`). */
  calendarColumnIndex: number;
  /** Structured items for this week (already deduped agenda-vs-ICS by the bucket). */
  items: CalendarItem[];
  /** Week-start date of this row (resolves day-of-month in existing cell lines). */
  weekStart: Date;
  now: Date;
};

export type UpsertCalendarColumnInRowResult =
  | {kind: 'write'; rowBody: string}
  | {kind: 'noop'}
  | {kind: 'skip'; reason: string};

/** Number of canonical `::today-section::` delimiter lines in a row body. */
function countSectionDelimiters(rowBody: string): number {
  let count = 0;
  for (const line of rowBody.replace(/\r\n/g, '\n').split('\n')) {
    if (line.trim() === '::today-section::') {
      count += 1;
    }
  }
  return count;
}

export function upsertCalendarColumnInRow(
  input: UpsertCalendarColumnInRowInput,
): UpsertCalendarColumnInRowResult {
  const {rowBody, columnCount, calendarColumnIndex, items, weekStart, now} = input;

  if (calendarColumnIndex < 0 || calendarColumnIndex >= columnCount) {
    return {kind: 'skip', reason: 'calendar-index-out-of-range'};
  }

  const existingIsBlank = rowBody.trim().length === 0;
  if (!existingIsBlank && countSectionDelimiters(rowBody) !== columnCount - 1) {
    // Ambiguous split: existing content would not round-trip to clean columns. Do not risk a write.
    return {kind: 'skip', reason: 'ambiguous-column-split'};
  }

  const sections = splitTodayRowIntoColumns(rowBody, columnCount);
  const mergedSegment = mergeCalendarCellContent(
    sections[calendarColumnIndex] ?? '',
    items,
    weekStart,
    now,
  );
  sections[calendarColumnIndex] = mergedSegment;

  const mergedRow = normalizeTodayHubRowForDisk(mergeTodayRowColumns(sections), columnCount);
  const existingNormalized = normalizeTodayHubRowForDisk(rowBody, columnCount);
  if (mergedRow === existingNormalized) {
    return {kind: 'noop'};
  }
  return {kind: 'write', rowBody: mergedRow};
}

/**
 * Merge a freshly-bucketed Calendar-column body into an existing Today Hub week-row file, touching
 * only the Calendar segment.
 *
 * The merge is **additive**: existing lines (including user-authored ones) are preserved and only
 * missing managed lines are appended — it never wipes content. Other columns are left untouched.
 * The result is run through {@link normalizeTodayHubRowForDisk}, making the operation idempotent for
 * a fixed desired body (a second run appends nothing and produces byte-identical output).
 */

import {
  mergeTodayRowColumns,
  normalizeTodayHubRowForDisk,
  splitTodayRowIntoColumns,
} from '../todayHub/splitMergeTodayRowColumns';

export type UpsertCalendarColumnInput = {
  /** Full existing row-file body (`YYYY-MM-DD.md`). */
  rowBody: string;
  /** Total column count for the hub (`1 + columns.length`). */
  columnCount: number;
  /** Split-segment index of the Calendar column (`columns.indexOf('Calendar') + 1`). */
  calendarColumnIndex: number;
  /** Desired Calendar body from {@link bucketCalendarWeekEntries} (may be empty). */
  desiredCalendarBody: string;
};

function nonEmptyTrimmed(line: string): boolean {
  return line.trim().length > 0;
}

/** Append managed lines not already present, preserving existing lines and order. */
function mergeCalendarSegment(existingSegment: string, desiredBody: string): string {
  const desiredLines = desiredBody.replace(/\r\n/g, '\n').split('\n').filter(nonEmptyTrimmed);
  if (desiredLines.length === 0) {
    return existingSegment;
  }
  const existingLines = existingSegment.replace(/\r\n/g, '\n').split('\n');
  const present = new Set(existingLines.map(l => l.trim()).filter(t => t.length > 0));
  const toAppend = desiredLines.filter(l => !present.has(l.trim()));
  if (toAppend.length === 0) {
    return existingSegment;
  }
  return [...existingLines, ...toAppend].join('\n');
}

export function upsertCalendarColumn(input: UpsertCalendarColumnInput): string {
  const {rowBody, columnCount, calendarColumnIndex, desiredCalendarBody} = input;
  if (calendarColumnIndex < 0 || calendarColumnIndex >= columnCount) {
    throw new Error(
      `calendarColumnIndex ${calendarColumnIndex} out of range for ${columnCount} columns`,
    );
  }

  const sections = splitTodayRowIntoColumns(rowBody, columnCount);
  sections[calendarColumnIndex] = mergeCalendarSegment(
    sections[calendarColumnIndex] ?? '',
    desiredCalendarBody,
  );

  return normalizeTodayHubRowForDisk(mergeTodayRowColumns(sections), columnCount);
}

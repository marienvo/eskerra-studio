/**
 * Renders Calendar-cell lines for **new** content only. Never re-serializes existing cell text — the
 * merge step keeps existing lines verbatim and only inserts the lines produced here.
 * See `specs/architecture/calendar-ics-agenda-pipeline.md` (Part 3b).
 */

import {formatCalendarToken} from './calendarDateToken';
import type {CalendarItem} from './types';

/** `@YYYY-MM-DD_HHMM body` or `@YYYY-MM-DD body` line for a single item. */
export function renderCalendarItemLine(item: CalendarItem): string {
  const token = formatCalendarToken(item.date, item.timed ? item.timeMinutes : null);
  return item.body.length > 0 ? `${token} ${item.body}` : token;
}

/** Chronological sort used both for from-scratch rendering and new-item insertion order. */
export function compareCalendarItems(a: CalendarItem, b: CalendarItem): number {
  const aDay = new Date(a.date.getFullYear(), a.date.getMonth(), a.date.getDate()).getTime();
  const bDay = new Date(b.date.getFullYear(), b.date.getMonth(), b.date.getDate()).getTime();
  if (aDay !== bDay) {
    return aDay - bDay;
  }
  if (a.timed !== b.timed) {
    return a.timed ? -1 : 1;
  }
  if (a.timed && b.timed && a.timeMinutes !== b.timeMinutes) {
    return (a.timeMinutes ?? 0) - (b.timeMinutes ?? 0);
  }
  if (a.source !== b.source) {
    return a.source === 'agenda' ? -1 : 1;
  }
  return a.order - b.order;
}

/**
 * Renders a full cell body from scratch (for an empty/owned cell): sorted items.
 * Returns `''` for no items.
 */
export function renderCalendarCellFromScratch(items: CalendarItem[]): string {
  const sorted = [...items].sort(compareCalendarItems);
  return sorted.map(renderCalendarItemLine).join('\n');
}

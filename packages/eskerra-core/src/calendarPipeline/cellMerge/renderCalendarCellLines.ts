/**
 * Renders Calendar-cell lines for **new** content only. Never re-serializes existing cell text — the
 * merge step keeps existing lines verbatim and only inserts the lines produced here.
 * See `specs/plans/calendar-ics-agenda-pipeline.md` (Part 3b).
 */

import type {CalendarItem} from './types';

const weekdayShortFormatter = new Intl.DateTimeFormat('en-US', {weekday: 'short'});

/** `**{monthHeading}**` heading line for an item's month. */
export function renderMonthHeadingLine(item: CalendarItem): string {
  return `**${item.monthHeading}**`;
}

/** `**{Wd} {day}:** {body}` line for a single item. */
export function renderCalendarItemLine(item: CalendarItem): string {
  return `**${weekdayShortFormatter.format(item.date)} ${item.date.getDate()}:** ${item.body}`;
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
 * Renders a full cell body from scratch (for an empty/owned cell): sorted items, a month heading the
 * first time each month appears. Returns `''` for no items.
 */
export function renderCalendarCellFromScratch(items: CalendarItem[]): string {
  const sorted = [...items].sort(compareCalendarItems);
  const shownMonths = new Set<number>();
  const lines: string[] = [];
  for (const item of sorted) {
    if (!shownMonths.has(item.monthIdx)) {
      shownMonths.add(item.monthIdx);
      lines.push(renderMonthHeadingLine(item));
    }
    lines.push(renderCalendarItemLine(item));
  }
  return lines.join('\n');
}

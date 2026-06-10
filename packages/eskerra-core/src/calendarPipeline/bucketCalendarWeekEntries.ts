/**
 * Bucket agenda bullets + ICS events into structured Calendar items per Today Hub week.
 *
 * Output is structured ({@link CalendarItem}[] per week-start stem), NOT finished markdown — rendering
 * happens later in the cell-merge step so dedup/scope/insertion operate on structured data. Within
 * each week, a calendar timed event is dropped when an agenda bullet shares the same identity key
 * (agenda precedence); see `calendarItemKey`. See `specs/plans/calendar-ics-agenda-pipeline.md`.
 */

import type {TodayHubStartDay} from '../todayHub/parseTodayHubFrontmatter';
import {formatTodayHubMondayStem, weekStartForDate} from '../todayHub/todayHubMondays';
import {monthLong} from './agenda/agendaShared';
import type {AgendaBullet} from './agenda/parseAgendaBullets';
import {calendarItemKey} from './cellMerge/calendarItemKey';
import type {CalendarItem} from './cellMerge/types';
import type {IcsEvent} from './parseIcsEvents';

export type BucketCalendarWeekEntriesInput = {
  agendaBullets: AgendaBullet[];
  icsEvents: IcsEvent[];
  start: TodayHubStartDay;
  /** Relative path/filename of the agenda source, used for the timed-bullet `[🗓️](<...>)` prefix. */
  mdAgenda?: string | null;
};

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function localCalendarDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function buildAgendaIconPrefix(mdAgenda: string | null | undefined): string | null {
  if (mdAgenda == null) {
    return null;
  }
  const trimmed = mdAgenda.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const withExt = /\.md$/i.test(trimmed) ? trimmed : `${trimmed}.md`;
  return `[🗓️](<${withExt}>)`;
}

/**
 * Returns a map from week-start row stem (`YYYY-MM-DD`) to the structured items for that week.
 * Deterministic for fixed inputs.
 */
export function bucketCalendarWeekEntries(
  input: BucketCalendarWeekEntriesInput,
): Map<string, CalendarItem[]> {
  const {agendaBullets, icsEvents, start} = input;
  const iconPrefix = buildAgendaIconPrefix(input.mdAgenda);

  // Month heading per month index, taken from the first agenda bullet that carries one.
  const monthHeadingByMonthIdx = new Map<number, string>();
  for (const bullet of agendaBullets) {
    const heading = bullet.monthHeading.trim();
    if (heading.length > 0 && !monthHeadingByMonthIdx.has(bullet.date.getMonth())) {
      monthHeadingByMonthIdx.set(bullet.date.getMonth(), heading);
    }
  }

  let order = 0;
  const items: CalendarItem[] = [];

  // Agenda first so it wins identity ties against calendar events.
  const agendaKeys = new Set<string>();
  for (const bullet of agendaBullets) {
    const monthIdx = bullet.date.getMonth();
    const body =
      bullet.timed && iconPrefix != null ? `${iconPrefix} ${bullet.body}` : bullet.body;
    const date = localCalendarDay(bullet.date);
    items.push({
      date,
      timed: bullet.timed,
      timeMinutes: bullet.timeMinutes,
      body,
      monthIdx,
      monthHeading: monthHeadingByMonthIdx.get(monthIdx) ?? monthLong(date),
      source: 'agenda',
      instant: null,
      order: order++,
    });
    agendaKeys.add(calendarItemKey({date, timed: bullet.timed, timeMinutes: bullet.timeMinutes, body}));
  }

  for (const event of icsEvents) {
    const day = localCalendarDay(event.start);
    const minutes = event.start.getHours() * 60 + event.start.getMinutes();
    const body = `${pad2(event.start.getHours())}:${pad2(event.start.getMinutes())} ${event.summary}`;
    const key = calendarItemKey({date: day, timed: true, timeMinutes: minutes, body});
    if (agendaKeys.has(key)) {
      continue;
    }
    const monthIdx = day.getMonth();
    items.push({
      date: day,
      timed: true,
      timeMinutes: minutes,
      body,
      monthIdx,
      monthHeading: monthHeadingByMonthIdx.get(monthIdx) ?? monthLong(day),
      source: 'calendar',
      instant: new Date(event.start.getTime()),
      order: order++,
    });
  }

  const byWeek = new Map<string, CalendarItem[]>();
  for (const item of items) {
    const stem = formatTodayHubMondayStem(weekStartForDate(item.date, start));
    const list = byWeek.get(stem) ?? [];
    list.push(item);
    byWeek.set(stem, list);
  }
  return byWeek;
}

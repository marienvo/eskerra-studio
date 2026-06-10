/**
 * Bucket agenda bullets + ICS events into structured Calendar items per Today Hub week.
 *
 * Output is structured ({@link CalendarItem}[] per week-start stem), NOT finished markdown — rendering
 * happens later in the cell-merge step so dedup/scope/insertion operate on structured data. Within
 * each week, a calendar timed event is dropped when an agenda bullet shares the same identity key
 * (agenda precedence); see `calendarItemKey`. See `specs/architecture/calendar-ics-agenda-pipeline.md`.
 */

import type {TodayHubStartDay} from '../todayHub/parseTodayHubFrontmatter';
import {formatTodayHubMondayStem, weekStartForDate} from '../todayHub/todayHubMondays';
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

/** Strip a leading `HH:MM ` from body text when a time string is provided. */
function stripLeadingTime(body: string, time: string | null): string {
  if (time == null) {
    return body;
  }
  const prefix = `${time} `;
  return body.startsWith(prefix) ? body.slice(prefix.length) : body;
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

  let order = 0;
  const items: CalendarItem[] = [];

  // Agenda first so it wins identity ties against calendar events.
  const agendaKeys = new Set<string>();
  for (const bullet of agendaBullets) {
    const date = localCalendarDay(bullet.date);
    // Strip the leading `HH:MM ` from timed bullets — the token carries the time.
    const titleBody = bullet.timed ? stripLeadingTime(bullet.body, bullet.time) : bullet.body;
    const body = bullet.timed && iconPrefix != null ? `${iconPrefix} ${titleBody}` : titleBody;
    items.push({
      date,
      timed: bullet.timed,
      timeMinutes: bullet.timeMinutes,
      body,
      source: 'agenda',
      instant: null,
      order: order++,
    });
    agendaKeys.add(calendarItemKey({
      date,
      timed: bullet.timed,
      timeMinutes: bullet.timeMinutes,
      body,
    }));
  }

  for (const event of icsEvents) {
    const day = localCalendarDay(event.start);
    const minutes = event.start.getHours() * 60 + event.start.getMinutes();
    const key = calendarItemKey({date: day, timed: true, timeMinutes: minutes, body: event.summary});
    if (agendaKeys.has(key)) {
      continue;
    }
    items.push({
      date: day,
      timed: true,
      timeMinutes: minutes,
      body: event.summary,
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

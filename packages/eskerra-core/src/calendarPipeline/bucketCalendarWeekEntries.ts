/**
 * Bucket agenda bullets + ICS events into Today Hub week-entry Calendar-column bodies.
 *
 * Each item's date is mapped to its hub week-start (via {@link weekStartForDate}); items are deduped
 * (a calendar timed event is dropped when an agenda bullet has the same day + time; otherwise items
 * are deduped on normalized title with agenda taking precedence) and rendered as real markdown lines:
 * a `**{month-emoji} {Month}**` heading the first time a month appears in a cell, then one
 * `**{Wd} {day}:** {body}` line per item — sorted by date, timed-before-untimed, time, then source.
 * Timed agenda bullets keep a `[🗓️](<mdAgenda>)` link prefix when an agenda file is known.
 */

import type {TodayHubStartDay} from '../todayHub/parseTodayHubFrontmatter';
import {formatTodayHubMondayStem, weekStartForDate} from '../todayHub/todayHubMondays';
import {monthLong} from './agenda/agendaShared';
import type {AgendaBullet} from './agenda/parseAgendaBullets';
import type {IcsEvent} from './parseIcsEvents';

export type BucketCalendarWeekEntriesInput = {
  agendaBullets: AgendaBullet[];
  icsEvents: IcsEvent[];
  start: TodayHubStartDay;
  /** Relative path/filename of the agenda source, used for the timed-bullet `[🗓️](<...>)` prefix. */
  mdAgenda?: string | null;
};

type CalendarItem = {
  date: Date;
  monthIdx: number;
  monthHeading: string;
  body: string;
  timed: boolean;
  timeMinutes: number | null;
  source: 'agenda' | 'calendar';
  order: number;
};

const weekdayShortFormatter = new Intl.DateTimeFormat('en-US', {weekday: 'short'});

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Normalize a title for untimed dedup: drop time prefix, links, emoji, punctuation, case. */
function normalizeTitleForDedup(body: string): string {
  return body
    .replace(/^([01]\d|2[0-3]):([0-5]\d)\s*/, '')
    .replace(/\[🗓️\]\(<[^>]*>\)/g, ' ')
    .replace(/\[([^\]]*)\]\((?:<[^>]+>|[^)]+)\)/g, '$1')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .normalize('NFKD')
    .replace(/[\uFE0E\uFE0F]/g, '')
    .replace(/\p{M}/gu, '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
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

function compareItems(a: CalendarItem, b: CalendarItem): number {
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
 * Returns a map from week-start row stem (`YYYY-MM-DD`) to the rendered Calendar-column body for
 * every week that has at least one item. Deterministic for fixed inputs.
 */
export function bucketCalendarWeekEntries(
  input: BucketCalendarWeekEntriesInput,
): Map<string, string> {
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

  // Agenda timed (day|minutes) keys suppress matching calendar timed events.
  const agendaTimedKeys = new Set<string>();
  for (const bullet of agendaBullets) {
    if (bullet.timeMinutes != null) {
      agendaTimedKeys.add(`${localDayKey(bullet.date)}|${bullet.timeMinutes}`);
    }
  }

  let order = 0;
  const items: CalendarItem[] = [];

  // Agenda first so it wins title-dedup ties.
  for (const bullet of agendaBullets) {
    const monthIdx = bullet.date.getMonth();
    const body =
      bullet.timed && iconPrefix != null ? `${iconPrefix} ${bullet.body}` : bullet.body;
    items.push({
      date: bullet.date,
      monthIdx,
      monthHeading: monthHeadingByMonthIdx.get(monthIdx) ?? monthLong(bullet.date),
      body,
      timed: bullet.timed,
      timeMinutes: bullet.timeMinutes,
      source: 'agenda',
      order: order++,
    });
  }

  for (const event of icsEvents) {
    const minutes = event.start.getHours() * 60 + event.start.getMinutes();
    if (agendaTimedKeys.has(`${localDayKey(event.start)}|${minutes}`)) {
      continue;
    }
    const monthIdx = event.start.getMonth();
    items.push({
      date: event.start,
      monthIdx,
      monthHeading: monthHeadingByMonthIdx.get(monthIdx) ?? monthLong(event.start),
      body: `${pad2(event.start.getHours())}:${pad2(event.start.getMinutes())} ${event.summary}`,
      timed: true,
      timeMinutes: minutes,
      source: 'calendar',
      order: order++,
    });
  }

  // Group by week-start stem.
  const itemsByWeek = new Map<string, CalendarItem[]>();
  for (const item of items) {
    const stem = formatTodayHubMondayStem(weekStartForDate(item.date, start));
    const list = itemsByWeek.get(stem) ?? [];
    list.push(item);
    itemsByWeek.set(stem, list);
  }

  const result = new Map<string, string>();
  for (const [stem, weekItems] of itemsByWeek) {
    weekItems.sort(compareItems);
    const seenTitles = new Set<string>();
    const shownMonths = new Set<number>();
    const lines: string[] = [];
    for (const item of weekItems) {
      const titleKey = `${localDayKey(item.date)}|${normalizeTitleForDedup(item.body)}`;
      if (seenTitles.has(titleKey)) {
        continue;
      }
      seenTitles.add(titleKey);
      if (!shownMonths.has(item.monthIdx)) {
        shownMonths.add(item.monthIdx);
        lines.push(`**${item.monthHeading}**`);
      }
      const weekday = weekdayShortFormatter.format(item.date);
      lines.push(`**${weekday} ${item.date.getDate()}:** ${item.body}`);
    }
    if (lines.length > 0) {
      result.set(stem, lines.join('\n'));
    }
  }

  return result;
}

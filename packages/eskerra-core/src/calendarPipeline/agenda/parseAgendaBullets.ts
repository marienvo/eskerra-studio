/**
 * Extract dated bullets from a (normalized) agenda's `###` day blocks.
 *
 * Each `###` block is associated with the most recent `##` month heading. An H3 with a resolvable
 * month + day yields one {@link AgendaBullet} per top-level bullet, with the bullet's leading
 * `HH:MM` (if any) parsed out. Years are inferred with the same rolling rule as the normalizer
 * (month ≥ now's month → this year, else next year).
 *
 * Ported from the legacy `Scripts/processors` year-log bullet parser; behavior is preserved.
 */

export type AgendaBullet = {
  /** Local-calendar date of the bullet's day entry (midnight). */
  date: Date;
  /** The `##` month heading text the block sits under (trimmed; may be empty). */
  monthHeading: string;
  /** Bullet text after the leading `- ` (trimmed; still includes any `HH:MM` prefix). */
  body: string;
  /** True when the body starts with an `HH:MM` time. */
  timed: boolean;
  /** `HH:MM` string when {@link timed}, else `null`. */
  time: string | null;
  /** Minutes since midnight when {@link timed}, else `null`. */
  timeMinutes: number | null;
  /** Stable source order, for tie-breaking when sorting. */
  order: number;
};

type AgendaBlock = {titleLine: string; content: string; monthHeading: string};

const MONTH_NAMES = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

/** Each ### block is associated with the most recent ## line (month heading). */
function parseAgendaWithMonthHeadings(markdown: string): AgendaBlock[] {
  const lines = markdown.split(/\r?\n/);
  const blocks: AgendaBlock[] = [];
  let currentMonthHeading = '';
  let current: {titleLine: string; content: string[]; monthHeading: string} | null = null;

  for (const line of lines) {
    if (/^##\s+/.test(line)) {
      currentMonthHeading = line.replace(/^##\s+/, '').trim();
      if (current) {
        blocks.push({
          titleLine: current.titleLine,
          content: current.content.join('\n'),
          monthHeading: current.monthHeading,
        });
        current = null;
      }
    } else if (/^###\s+/.test(line)) {
      if (current) {
        blocks.push({
          titleLine: current.titleLine,
          content: current.content.join('\n'),
          monthHeading: current.monthHeading,
        });
      }
      current = {titleLine: line.trimEnd(), content: [], monthHeading: currentMonthHeading};
    } else if (current) {
      current.content.push(line);
    }
  }
  if (current) {
    blocks.push({
      titleLine: current.titleLine,
      content: current.content.join('\n'),
      monthHeading: current.monthHeading,
    });
  }
  return blocks;
}

function parseH3DateBits(title: string): {
  monthIdx: number | null;
  day: number | null;
  year: number | null;
} {
  const monthRe =
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\b/i;
  const monthM = title.match(monthRe);
  const dayM = title.match(/\b(\d{1,2})(?:st|nd|rd|th)?\b/);
  const yearM = title.match(/\b(19|20)\d{2}\b/);
  const monthIdx = monthM ? MONTH_NAMES.indexOf(monthM[1].toLowerCase()) : null;
  const day = dayM ? parseInt(dayM[1], 10) : null;
  const year = yearM ? parseInt(yearM[0], 10) : null;
  return {monthIdx, day, year};
}

/** Same rolling rule as the calendar normalizer: month ≥ now's month → this year, else next year. */
function inferYearForAgendaEntry(monthIdx: number, explicitYear: number | null, now: Date): number {
  if (explicitYear != null) {
    return explicitYear;
  }
  return monthIdx >= now.getMonth() ? now.getFullYear() : now.getFullYear() + 1;
}

/** Top-level bullet lines (`^\s*-\s+`), body after the dash, trimmed. */
function extractBulletLines(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => /^\s*-\s+/.test(l))
    .map(l => l.replace(/^\s*-\s+/, '').trim());
}

function parseLeadingTimeMinutes(body: string): number | null {
  const timeMatch = body.match(/^([01]\d|2[0-3]):([0-5]\d)\b/);
  if (!timeMatch) {
    return null;
  }
  return Number(timeMatch[1]) * 60 + Number(timeMatch[2]);
}

/**
 * Parses agenda markdown into dated bullets. `now` drives year inference. `getNextOrder` (when
 * provided) supplies stable ordering across multiple sources; otherwise a local counter is used.
 */
export function parseAgendaBullets(
  markdown: string,
  now: Date,
  getNextOrder?: () => number,
): AgendaBullet[] {
  let localOrder = 0;
  const nextOrder = getNextOrder ?? (() => localOrder++);
  const bullets: AgendaBullet[] = [];

  for (const block of parseAgendaWithMonthHeadings(markdown)) {
    const {monthIdx, day, year} = parseH3DateBits(block.titleLine);
    if (monthIdx == null || monthIdx < 0 || day == null) {
      continue;
    }
    const y = inferYearForAgendaEntry(monthIdx, year, now);
    const entryDate = new Date(y, monthIdx, day);
    const monthHeading = block.monthHeading.trim();

    for (const body of extractBulletLines(block.content)) {
      const timeMinutes = parseLeadingTimeMinutes(body);
      const timed = timeMinutes != null;
      const time = timed
        ? `${String(Math.floor(timeMinutes / 60)).padStart(2, '0')}:${String(timeMinutes % 60).padStart(2, '0')}`
        : null;
      bullets.push({
        date: entryDate,
        monthHeading,
        body,
        timed,
        time,
        timeMinutes,
        order: nextOrder(),
      });
    }
  }

  return bullets;
}

/**
 * Minimal, dependency-free iCalendar (RFC 5545) parser scoped to what the calendar pipeline needs:
 * timed `VEVENT`s in a small look-ahead window, with basic `RRULE` expansion.
 *
 * Deliberately *not* a general iCal library. Supported:
 *  - `VEVENT` with `DTSTART`, `SUMMARY`, `UID`, optional `RRULE`.
 *  - `DTSTART` as UTC (`...Z`) or floating/local time. **All-day** (`VALUE=DATE` / 8-digit) events are skipped.
 *  - `RRULE` `FREQ=DAILY|WEEKLY|MONTHLY|YEARLY` with `INTERVAL`, `COUNT`, `UNTIL`, and (for weekly) `BYDAY`.
 *
 * **Timezone limitation:** without a tz database this parser cannot convert `TZID=...` wall-clock
 * times to absolute instants. Values ending in `Z` are treated as UTC; everything else is interpreted
 * in the host's local timezone. For a single user whose calendar matches their machine timezone this
 * is correct; cross-timezone events may be off. See `specs/plans/calendar-ics-agenda-pipeline.md`.
 */

export type IcsEvent = {
  start: Date;
  summary: string;
};

export type ParseIcsEventsOptions = {
  now: Date;
  /** Number of days after `now` (inclusive, end-of-day) to include. Default 7. */
  daysAhead?: number;
  /** Summary used when an event has no usable `SUMMARY`. Default `'Busy'`. */
  titleFallback?: string;
};

const DEFAULT_DAYS_AHEAD = 7;
const DEFAULT_TITLE_FALLBACK = 'Busy';
/** Safety cap on generated recurrence instances per event. */
const MAX_OCCURRENCES = 10000;

type IcsProperty = {
  name: string;
  params: Record<string, string>;
  value: string;
};

type ParsedDateTime = {
  date: Date;
  dateOnly: boolean;
};

const WEEKDAY_TO_JS: Record<string, number> = {
  SU: 0,
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
};

/** Unfold RFC 5545 line continuations (a following line starting with space or tab). */
function unfoldLines(icsText: string): string[] {
  const rawLines = icsText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const lines: string[] = [];
  for (const raw of rawLines) {
    if ((raw.startsWith(' ') || raw.startsWith('\t')) && lines.length > 0) {
      lines[lines.length - 1] += raw.slice(1);
    } else {
      lines.push(raw);
    }
  }
  return lines;
}

function parseProperty(line: string): IcsProperty | null {
  const colonIdx = line.indexOf(':');
  if (colonIdx < 0) {
    return null;
  }
  const left = line.slice(0, colonIdx);
  const value = line.slice(colonIdx + 1);
  const segments = left.split(';');
  const name = (segments[0] ?? '').toUpperCase();
  const params: Record<string, string> = {};
  for (let i = 1; i < segments.length; i++) {
    const eq = segments[i].indexOf('=');
    if (eq < 0) {
      continue;
    }
    params[segments[i].slice(0, eq).toUpperCase()] = segments[i].slice(eq + 1);
  }
  return {name, params, value};
}

function unescapeText(value: string): string {
  return value
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

/** Parse an iCal date/date-time value. Returns `null` when unparseable. */
function parseIcsDateTime(value: string): ParsedDateTime | null {
  const trimmed = value.trim();
  const dateOnlyMatch = /^(\d{4})(\d{2})(\d{2})$/.exec(trimmed);
  if (dateOnlyMatch) {
    const [, y, mo, d] = dateOnlyMatch;
    return {
      date: new Date(Number(y), Number(mo) - 1, Number(d)),
      dateOnly: true,
    };
  }
  const dateTimeMatch = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(trimmed);
  if (dateTimeMatch) {
    const [, y, mo, d, h, mi, s, z] = dateTimeMatch;
    if (z === 'Z') {
      return {
        date: new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s))),
        dateOnly: false,
      };
    }
    return {
      date: new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)),
      dateOnly: false,
    };
  }
  return null;
}

function isDateOnlyStart(prop: IcsProperty): boolean {
  if ((prop.params.VALUE ?? '').toUpperCase() === 'DATE') {
    return true;
  }
  return /^\d{8}$/.test(prop.value.trim());
}

type RecurrenceRule = {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  interval: number;
  count: number | null;
  until: Date | null;
  byDay: number[];
};

function parseRrule(value: string): RecurrenceRule | null {
  const parts = new Map<string, string>();
  for (const segment of value.split(';')) {
    const eq = segment.indexOf('=');
    if (eq < 0) {
      continue;
    }
    parts.set(segment.slice(0, eq).toUpperCase(), segment.slice(eq + 1));
  }
  const freqRaw = (parts.get('FREQ') ?? '').toUpperCase();
  if (freqRaw !== 'DAILY' && freqRaw !== 'WEEKLY' && freqRaw !== 'MONTHLY' && freqRaw !== 'YEARLY') {
    return null;
  }
  const intervalRaw = Number(parts.get('INTERVAL'));
  const interval = Number.isFinite(intervalRaw) && intervalRaw > 0 ? Math.floor(intervalRaw) : 1;
  const countRaw = Number(parts.get('COUNT'));
  const count = Number.isFinite(countRaw) && countRaw > 0 ? Math.floor(countRaw) : null;
  const untilRaw = parts.get('UNTIL');
  const until = untilRaw ? parseIcsDateTime(untilRaw)?.date ?? null : null;
  const byDay: number[] = [];
  const byDayRaw = parts.get('BYDAY');
  if (byDayRaw) {
    for (const token of byDayRaw.split(',')) {
      // Strip an optional ordinal prefix (e.g. `2MO`); only the weekday code is used.
      const wd = token.trim().slice(-2).toUpperCase();
      if (wd in WEEKDAY_TO_JS) {
        byDay.push(WEEKDAY_TO_JS[wd]);
      }
    }
  }
  return {freq: freqRaw, interval, count, until, byDay};
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function addMonths(date: Date, months: number): Date {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

function addYears(date: Date, years: number): Date {
  const next = new Date(date);
  next.setFullYear(next.getFullYear() + years);
  return next;
}

/** Yields recurrence start instants in chronological order, bounded by `count`/`until`/`windowEnd`. */
function* expandOccurrences(
  dtstart: Date,
  rule: RecurrenceRule,
  windowEndMs: number,
): Generator<Date> {
  const hardEndMs =
    rule.until != null ? Math.min(windowEndMs, rule.until.getTime()) : windowEndMs;
  let emitted = 0;
  let guard = 0;

  if (rule.freq === 'WEEKLY' && rule.byDay.length > 0) {
    const sortedDays = [...new Set(rule.byDay)].sort((a, b) => a - b);
    // Anchor on the start of dtstart's week (same weekday set repeats every `interval` weeks).
    let weekAnchor = addDays(dtstart, -dtstart.getDay());
    while (guard < MAX_OCCURRENCES) {
      for (const jsDay of sortedDays) {
        const occ = new Date(weekAnchor);
        occ.setDate(occ.getDate() + jsDay);
        occ.setHours(
          dtstart.getHours(),
          dtstart.getMinutes(),
          dtstart.getSeconds(),
          dtstart.getMilliseconds(),
        );
        if (occ.getTime() < dtstart.getTime()) {
          continue;
        }
        if (occ.getTime() > hardEndMs) {
          return;
        }
        if (rule.count != null && emitted >= rule.count) {
          return;
        }
        emitted += 1;
        guard += 1;
        yield occ;
      }
      weekAnchor = addDays(weekAnchor, 7 * rule.interval);
      guard += 1;
    }
    return;
  }

  let current = new Date(dtstart);
  while (guard < MAX_OCCURRENCES) {
    if (current.getTime() > hardEndMs) {
      return;
    }
    if (rule.count != null && emitted >= rule.count) {
      return;
    }
    emitted += 1;
    guard += 1;
    yield new Date(current);
    if (rule.freq === 'DAILY') {
      current = addDays(current, rule.interval);
    } else if (rule.freq === 'WEEKLY') {
      current = addDays(current, 7 * rule.interval);
    } else if (rule.freq === 'MONTHLY') {
      current = addMonths(current, rule.interval);
    } else {
      current = addYears(current, rule.interval);
    }
  }
}

type IcsVevent = {
  uid: string;
  summary: string;
  dtstart: Date;
  dateOnly: boolean;
  rrule: RecurrenceRule | null;
};

function parseVevents(lines: string[], titleFallback: string): IcsVevent[] {
  const events: IcsVevent[] = [];
  let inVevent = false;
  let current: Partial<IcsVevent> & {dateOnly?: boolean} = {};

  for (const line of lines) {
    const upper = line.toUpperCase();
    if (upper === 'BEGIN:VEVENT') {
      inVevent = true;
      current = {};
      continue;
    }
    if (upper === 'END:VEVENT') {
      if (inVevent && current.dtstart instanceof Date) {
        events.push({
          uid: current.uid ?? '',
          summary: current.summary ?? titleFallback,
          dtstart: current.dtstart,
          dateOnly: current.dateOnly ?? false,
          rrule: current.rrule ?? null,
        });
      }
      inVevent = false;
      current = {};
      continue;
    }
    if (!inVevent) {
      continue;
    }
    const prop = parseProperty(line);
    if (!prop) {
      continue;
    }
    if (prop.name === 'DTSTART') {
      const parsed = parseIcsDateTime(prop.value);
      if (parsed) {
        current.dtstart = parsed.date;
        current.dateOnly = isDateOnlyStart(prop) || parsed.dateOnly;
      }
    } else if (prop.name === 'SUMMARY') {
      const clean = unescapeText(prop.value).trim();
      current.summary = clean.length > 0 ? clean : titleFallback;
    } else if (prop.name === 'UID') {
      current.uid = prop.value.trim();
    } else if (prop.name === 'RRULE') {
      current.rrule = parseRrule(prop.value);
    }
  }

  return events;
}

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function endOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

/**
 * Parses already-fetched ICS text into timed events inside `[startOfDay(now) .. endOfDay(now + daysAhead)]`,
 * skipping all-day events, deduping on `uid|timestamp|summary`, sorted by time then summary.
 */
export function parseIcsEvents(icsText: string, options: ParseIcsEventsOptions): IcsEvent[] {
  const {now} = options;
  const daysAhead = options.daysAhead ?? DEFAULT_DAYS_AHEAD;
  const titleFallback = options.titleFallback ?? DEFAULT_TITLE_FALLBACK;

  const fromMs = startOfLocalDay(now).getTime();
  const toMs = endOfLocalDay(
    new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysAhead),
  ).getTime();

  const lines = unfoldLines(icsText);
  const vevents = parseVevents(lines, titleFallback);

  const events: IcsEvent[] = [];
  const dedup = new Set<string>();

  for (const vevent of vevents) {
    if (vevent.dateOnly) {
      continue;
    }
    const starts: Date[] = [];
    if (vevent.rrule) {
      for (const occ of expandOccurrences(vevent.dtstart, vevent.rrule, toMs)) {
        starts.push(occ);
      }
    } else {
      starts.push(vevent.dtstart);
    }
    for (const start of starts) {
      const ts = start.getTime();
      if (ts < fromMs || ts > toMs) {
        continue;
      }
      const key = `${vevent.uid}|${ts}|${vevent.summary}`;
      if (dedup.has(key)) {
        continue;
      }
      dedup.add(key);
      events.push({start: new Date(ts), summary: vevent.summary});
    }
  }

  events.sort((a, b) => {
    const diff = a.start.getTime() - b.start.getTime();
    if (diff !== 0) {
      return diff;
    }
    return a.summary.localeCompare(b.summary);
  });
  return events;
}

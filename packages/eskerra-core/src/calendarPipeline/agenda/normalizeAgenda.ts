/**
 * Agenda normalization (Part 2 of the calendar pipeline).
 *
 * Pure, deterministic transform of a hub's `mdAgenda` markdown: canonical H3 titles
 * (`Weekday, Month Ordinal, Year` / `..., Rule`), month ordering from `now`, recurrence resolution,
 * today-highlight (`==...==`), `!1` lift into the next dated occurrence, checked-bullet replanning,
 * and age recompute (`⌚️ <birthYear>, <age> years`). Frontmatter and non-month H2 sections are
 * preserved as-is. Idempotent for a fixed `now`.
 *
 * Ported from the legacy `Scripts/processors` calendar handler; behavior is intentionally preserved.
 */

import {
  extractFirstInt,
  extractYearTagFromH3,
  getOrdinal,
  headingText,
  indexToMonthTitle,
  isH2,
  isH3,
  monthIdxFromH2Title,
  monthLong,
  nextOccurrenceYear,
  splitFrontmatter,
  trimBlankEdges,
  updateAgesInContent,
  weekdayLong,
} from './agendaShared';

type MiscSection = {h2Line: string; content: string};

type DayEntry = {
  titleLine: string;
  content: string;
  /** For recurring lines, the displayed day of the next occurrence. */
  day: number;
  /** `null` means recurring. */
  yearTag: number | null;
  /** e.g. "↺", "↺w", "↺2w", "↺m", "↺q", "↺2d", "↺2su5", "↺lastsu3". */
  recurrenceRule?: string | null;
};

type MonthBucket = {
  h2Line: string;
  intro: string;
  days: DayEntry[];
  seen: boolean;
};

type ParsedDoc = {
  frontmatter: string;
  h1Line: string;
  h1Content: string;
  months: (MonthBucket | null)[];
  misc: MiscSection[];
};

function normSpaces(s: string): string {
  return s.normalize('NFKD').replace(/[\u00A0\u2007\u202F]/g, ' ');
}

function isTopLevelBullet(line: string): boolean {
  const L = normSpaces(line);
  const m = L.match(/^(\s*)- /);
  return !!(m && m[1].length <= 1);
}

function isCheckedTopBullet(line: string): boolean {
  const L = normSpaces(line).replace(/^\s+/, '');
  return /^- \[[xX]]/.test(L);
}

function parseBulletRepeatToken(line: string): string | null {
  const m = normSpaces(line).match(/\s(↺[^\s]*)/);
  return m ? m[1] : null;
}

/** Turn "- [x] Foo ↺" into "- [ ] Foo" (strip the repeat token, keep the text). */
function replanBulletFromPast(line: string): string {
  return line
    .replace(/^- \[[xX]]\s*/, '- [ ] ')
    .replace(/\s↺[^\s]*\s*$/, '')
    .trimEnd();
}

function replanCheckedBulletsFromDayEntry(
  d: DayEntry,
  months: (MonthBucket | null)[],
  today: Date,
  anchorYear: number | null,
  anchorMonthIdx: number | null,
  anchorDay: number | null,
): {moved: number; newContent: string} {
  const raw = (d.content || '').trim();
  if (!raw) {
    return {moved: 0, newContent: d.content || ''};
  }

  const lines = raw.split(/\r?\n/);
  const kept: string[] = [];
  let moved = 0;

  for (const line of lines) {
    if (isTopLevelBullet(line) && isCheckedTopBullet(line)) {
      const rt = parseBulletRepeatToken(line);
      if (rt) {
        const {entry: recur} = ensureRecurringEntry(
          months,
          today,
          rt,
          anchorMonthIdx,
          anchorDay,
          anchorYear,
        );
        const newBullet = replanBulletFromPast(line);
        recur.content = trimBlankEdges([recur.content, newBullet].filter(Boolean).join('\n'));
        moved++;
        continue;
      }
    }
    kept.push(line);
  }

  return {moved, newContent: trimBlankEdges(kept.join('\n'))};
}

/** Split top-level bullets containing '!1' incl. their indented block, and strip '!1'. */
function splitOutImportantOneBullets(content: string): {kept: string; moved: string[]} {
  const lines = content.split(/\r?\n/);
  const kept: string[] = [];
  const movedBlocks: string[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (isTopLevelBullet(line) && line.includes('!1')) {
      const block: string[] = [line];
      i++;

      while (i < lines.length) {
        const look = lines[i];
        if (/^#{2,}\s/.test(look)) {
          break;
        }
        if (isTopLevelBullet(look)) {
          break;
        }
        if (look.trim() === '' || /^\s+/.test(look)) {
          block.push(look);
          i++;
          continue;
        }
        break;
      }

      const cleaned = block.map(l => l.replace(/\s*!1\b/g, '')).join('\n');
      movedBlocks.push(trimBlankEdges(cleaned));
      continue;
    }

    kept.push(line);
    i++;
  }

  return {kept: trimBlankEdges(kept.join('\n')), moved: movedBlocks.filter(b => b.length > 0)};
}

// --- Recurrence engine -------------------------------------------------------

type Weekday2 = 'su' | 'mo' | 'tu' | 'we' | 'th' | 'fr' | 'sa';
const WD_MAP: Record<Weekday2, number> = {su: 0, mo: 1, tu: 2, we: 3, th: 4, fr: 5, sa: 6};

function endOfMonth(year: number, monthIdx: number): number {
  return new Date(year, monthIdx + 1, 0).getDate();
}

/** Try to extract a recurrence token from an H3 line. Returns null if none. */
function parseRecurrenceRule(h3Title: string): string | null {
  const m = h3Title.match(/,\s*↺([^\s,]+)?\s*$/);
  if (!m) {
    return null;
  }
  const token = m[1];
  return token ? `↺${token}` : '↺';
}

function monthInRange(m: number, startM: number, endM: number): boolean {
  if (startM <= endM) {
    return m >= startM && m <= endM;
  }
  return m >= startM || m <= endM;
}

/** Compute next occurrence date for a recurrence rule. */
function computeNextOccurrence(
  baseToday: Date,
  rule: string,
  anchorYear: number | null,
  anchorMonthIdx: number | null,
  anchorDay: number | null,
): Date {
  const todayMid = new Date(baseToday.getFullYear(), baseToday.getMonth(), baseToday.getDate());

  const ensureFutureOrToday = (d: Date): Date => {
    if (d < todayMid) {
      if (/^↺\d+d$/i.test(rule)) {
        const k = parseInt(rule.slice(1, -1), 10);
        const nd = new Date(d);
        nd.setDate(nd.getDate() + k);
        return ensureFutureOrToday(nd);
      }
      if (/^↺\d*w$/i.test(rule) || rule === '↺w') {
        const k = rule === '↺w' ? 1 : parseInt(rule.slice(1, -1), 10);
        const nd = new Date(d);
        nd.setDate(nd.getDate() + 7 * k);
        return ensureFutureOrToday(nd);
      }
      if (rule === '↺m') {
        const nd = new Date(d);
        const targetDay = d.getDate();
        nd.setMonth(nd.getMonth() + 1);
        const eom = endOfMonth(nd.getFullYear(), nd.getMonth());
        nd.setDate(Math.min(targetDay, eom));
        return ensureFutureOrToday(nd);
      }
      if (rule === '↺q') {
        const nd = new Date(d);
        const targetDay = d.getDate();
        nd.setMonth(nd.getMonth() + 3);
        const eom = endOfMonth(nd.getFullYear(), nd.getMonth());
        nd.setDate(Math.min(targetDay, eom));
        return ensureFutureOrToday(nd);
      }
      const nd = new Date(d);
      nd.setFullYear(nd.getFullYear() + 1);
      return ensureFutureOrToday(nd);
    }
    return d;
  };

  const seasonMatch = rule.match(/^↺season\((\d{1,2})-(\d{1,2})\)$/i);
  if (seasonMatch) {
    const startM = Math.min(12, Math.max(1, parseInt(seasonMatch[1], 10)));
    const endM = Math.min(12, Math.max(1, parseInt(seasonMatch[2], 10)));

    const todayY = baseToday.getFullYear();
    const todayM = baseToday.getMonth() + 1;
    const todaySeasonMid = new Date(todayY, baseToday.getMonth(), baseToday.getDate());

    if (monthInRange(todayM, startM, endM)) {
      return todaySeasonMid;
    }

    const nextStartY =
      startM > todayM ||
      (startM === todayM && new Date(todayY, startM - 1, 1) >= todaySeasonMid)
        ? todayY
        : todayY + 1;

    return new Date(nextStartY, startM - 1, 1);
  }

  if (/^↺(\d+)(su|mo|tu|we|th|fr|sa)(\d{1,2})$/i.test(rule)) {
    const [, nStr, wdStr, mStr] = rule.match(/^↺(\d+)(su|mo|tu|we|th|fr|sa)(\d{1,2})$/i)!;
    const n = parseInt(nStr, 10);
    const wd = WD_MAP[wdStr.toLowerCase() as Weekday2];
    const monthIdx = Math.max(0, Math.min(11, parseInt(mStr, 10) - 1));

    const buildNth = (year: number): Date => {
      const first = new Date(year, monthIdx, 1);
      const firstWd = first.getDay();
      const delta = (wd - firstWd + 7) % 7;
      const day1 = 1 + delta + (n - 1) * 7;
      const eom = endOfMonth(year, monthIdx);
      const day = Math.min(day1, eom);
      return new Date(year, monthIdx, day);
    };

    const y = baseToday.getFullYear();
    const candThis = buildNth(y);
    return ensureFutureOrToday(candThis < todayMid ? buildNth(y + 1) : candThis);
  }

  if (/^↺last(su|mo|tu|we|th|fr|sa)(\d{1,2})$/i.test(rule)) {
    const [, wdStr, mStr] = rule.match(/^↺last(su|mo|tu|we|th|fr|sa)(\d{1,2})$/i)!;
    const wd = WD_MAP[wdStr.toLowerCase() as Weekday2];
    const monthIdx = Math.max(0, Math.min(11, parseInt(mStr, 10) - 1));

    const buildLast = (year: number): Date => {
      const last = new Date(year, monthIdx + 1, 0);
      const lastWd = last.getDay();
      const delta = (lastWd - wd + 7) % 7;
      return new Date(year, monthIdx, last.getDate() - delta);
    };

    const y = baseToday.getFullYear();
    const candThis = buildLast(y);
    return ensureFutureOrToday(candThis < todayMid ? buildLast(y + 1) : candThis);
  }

  if (rule === '↺') {
    const m = anchorMonthIdx ?? baseToday.getMonth();
    const d = Math.min(anchorDay ?? baseToday.getDate(), endOfMonth(baseToday.getFullYear(), m));
    const y = baseToday.getFullYear();
    let cand = new Date(y, m, d);
    if (cand < todayMid) {
      cand = new Date(y + 1, m, d);
    }
    return cand;
  }

  if (rule === '↺m') {
    const m = anchorMonthIdx ?? baseToday.getMonth();
    const d = anchorDay ?? baseToday.getDate();
    const y = baseToday.getFullYear();
    const first = new Date(y, m, Math.min(d, endOfMonth(y, m)));
    return ensureFutureOrToday(first);
  }

  if (rule === '↺q') {
    const m = anchorMonthIdx ?? baseToday.getMonth();
    const d = anchorDay ?? baseToday.getDate();
    const y = baseToday.getFullYear();
    const first = new Date(y, m, Math.min(d, endOfMonth(y, m)));
    return ensureFutureOrToday(first);
  }

  if (/^↺(\d+)w$/i.test(rule) || rule === '↺w') {
    const k = rule === '↺w' ? 1 : parseInt(rule.slice(1, -1), 10);

    const anchor: Date = (() => {
      if (anchorMonthIdx != null && anchorDay != null) {
        const y = anchorYear != null ? anchorYear : nextOccurrenceYear(baseToday, anchorMonthIdx, anchorDay);
        return new Date(y, anchorMonthIdx, anchorDay);
      }
      return new Date(baseToday.getFullYear(), baseToday.getMonth(), baseToday.getDate());
    })();

    if (anchor >= todayMid) {
      return anchor;
    }

    const diffDays = Math.ceil((todayMid.getTime() - anchor.getTime()) / 86400000);
    const steps = Math.ceil(diffDays / (7 * k));
    const cand = new Date(anchor);
    cand.setDate(cand.getDate() + steps * 7 * k);
    return cand;
  }

  if (/^↺(\d*)d$/i.test(rule)) {
    const m = rule.match(/^↺(\d*)d$/i)!;
    const k = m[1] ? parseInt(m[1], 10) : 1;

    const anchor: Date = (() => {
      if (anchorMonthIdx != null && anchorDay != null) {
        const y = anchorYear != null ? anchorYear : nextOccurrenceYear(baseToday, anchorMonthIdx, anchorDay);
        return new Date(y, anchorMonthIdx, anchorDay);
      }
      return new Date(baseToday.getFullYear(), baseToday.getMonth(), baseToday.getDate());
    })();

    if (anchor >= todayMid) {
      return anchor;
    }

    const diffDays = Math.ceil((todayMid.getTime() - anchor.getTime()) / 86400000);
    const steps = Math.ceil(diffDays / k);
    const cand = new Date(anchor);
    cand.setDate(cand.getDate() + steps * k);
    return cand;
  }

  return computeNextOccurrence(baseToday, '↺', anchorYear, anchorMonthIdx, anchorDay);
}

/** Create (or get) the recurring entry placed at its next occurrence date. */
function ensureRecurringEntry(
  months: (MonthBucket | null)[],
  today: Date,
  rule: string,
  anchorMonthIdx: number | null,
  anchorDay: number | null,
  anchorYear: number | null,
): {entry: DayEntry; monthIdx: number} {
  const next = computeNextOccurrence(today, rule, anchorYear, anchorMonthIdx, anchorDay);
  const mIdx = next.getMonth();
  const d = next.getDate();

  if (!months[mIdx]) {
    const monthTitle = indexToMonthTitle[mIdx];
    months[mIdx] = {h2Line: `## ${monthTitle}`, intro: '', days: [], seen: true};
  }
  const bucket = months[mIdx]!;

  const found = bucket.days.find(x => x.yearTag == null && x.recurrenceRule === rule && x.day === d);
  if (found) {
    const weekday = weekdayLong(next);
    const monthName = monthLong(next);
    const ordinal = getOrdinal(d);
    found.titleLine = `### ${weekday}, ${monthName} ${ordinal}, ${rule}`;
    found.day = d;
    found.recurrenceRule = rule;
    return {entry: found, monthIdx: mIdx};
  }

  const weekday = weekdayLong(next);
  const monthName = monthLong(next);
  const ordinal = getOrdinal(d);
  const entry: DayEntry = {
    titleLine: `### ${weekday}, ${monthName} ${ordinal}, ${rule}`,
    content: '',
    day: d,
    yearTag: null,
    recurrenceRule: rule,
  };
  bucket.days.push(entry);
  return {entry, monthIdx: mIdx};
}

/** Remove any leading/trailing == wrappers from an H3 line. */
function normalizeH3TitleEquals(line: string): string {
  return line.replace(/^###\s+=+\s*(.*?)\s*=+\s*$/, '### $1');
}

/** Strip == wrappers from a bare title (no leading ###). */
function stripEqualsFromTitleText(t: string): string {
  return t.replace(/^\s*=+\s*(.*?)\s*=+\s*$/, '$1').trim();
}

// --- Parsing -----------------------------------------------------------------

function parseMarkdown(
  md: string,
  now: Date,
): {preface: string; months: (MonthBucket | null)[]; misc: MiscSection[]} {
  const lines = md.split(/\r?\n/);
  const months: (MonthBucket | null)[] = Array.from({length: 12}, () => null);

  const prefaceLines: string[] = [];
  let i = 0;

  let currentMonthIdx: number | null = null;
  let currentMonthIntroLines: string[] = [];
  let currentH3: DayEntry | null = null;

  const flushH3 = () => {
    if (currentH3 && currentMonthIdx !== null) {
      months[currentMonthIdx]!.days.push(currentH3);
      currentH3 = null;
    }
  };

  const ensureBucket = (monthIdx: number, h2Line: string) => {
    if (!months[monthIdx]) {
      months[monthIdx] = {h2Line, intro: '', days: [], seen: true};
    }
  };

  const misc: MiscSection[] = [];
  let currentMisc: MiscSection | null = null;

  let encounteredAnyH2 = false;
  while (i < lines.length) {
    const line = lines[i];

    const lineIsH2 = isH2(line);
    const lineIsH3 = isH3(line);

    if (!encounteredAnyH2 && !lineIsH2) {
      prefaceLines.push(line);
      i++;
      continue;
    }

    if (lineIsH2) {
      encounteredAnyH2 = true;
      flushH3();

      if (currentMonthIdx !== null && currentMonthIntroLines.length > 0) {
        const bucket = months[currentMonthIdx]!;
        bucket.intro = (bucket.intro ? bucket.intro + '\n' : '') + currentMonthIntroLines.join('\n');
        currentMonthIntroLines = [];
      }

      if (currentMisc) {
        currentMisc.content = trimBlankEdges(currentMisc.content);
        misc.push(currentMisc);
        currentMisc = null;
      }

      const monthTitleRaw = headingText(line, 2) ?? '';
      const idx = monthIdxFromH2Title(monthTitleRaw);

      if (idx === null) {
        currentMonthIdx = null;
        currentH3 = null;
        currentMisc = {h2Line: line, content: ''};
        i++;
        continue;
      }

      currentMisc = null;
      currentMonthIdx = idx;
      ensureBucket(idx, line);
      currentMonthIntroLines = [];
      i++;
      continue;
    }

    if (lineIsH3) {
      const normalizedLine = normalizeH3TitleEquals(line);
      let titleLine = normalizedLine;
      let title = normalizedLine.replace(/^### /, '').trim();
      title = stripEqualsFromTitleText(title);

      if (!encounteredAnyH2) {
        currentMisc = {h2Line: titleLine.replace(/^###/, '##'), content: ''};
        i++;
        continue;
      }

      const explicitRule = parseRecurrenceRule(title) || null;

      const year = extractYearTagFromH3(title);
      const day = extractFirstInt(title);
      const safeDay = day && day >= 1 && day <= 31 ? day : null;

      if (currentMonthIdx !== null) {
        flushH3();

        if (safeDay && year !== null) {
          const date = new Date(year, currentMonthIdx, safeDay);
          if (!isNaN(date.getTime())) {
            const weekday = weekdayLong(date);
            const monthName = monthLong(date);
            const ordinal = getOrdinal(safeDay);
            titleLine = `### ${weekday}, ${monthName} ${ordinal}, ${year}`;
          }
        } else if (safeDay && year === null) {
          const rule = explicitRule ?? '↺';
          const fakeYear = nextOccurrenceYear(now, currentMonthIdx, safeDay);
          const date = new Date(fakeYear, currentMonthIdx, safeDay);
          if (!isNaN(date.getTime())) {
            const weekday = weekdayLong(date);
            const monthName = monthLong(date);
            const ordinal = getOrdinal(safeDay);
            titleLine = `### ${weekday}, ${monthName} ${ordinal}, ${rule}`;
          }
        }

        currentH3 = {
          titleLine,
          content: '',
          day: safeDay ?? 99,
          yearTag: year,
          recurrenceRule: explicitRule ?? (year === null ? '↺' : null),
        };
        i++;
        continue;
      }

      if (currentMisc) {
        currentMisc.content += (currentMisc.content ? '\n' : '') + line;
      }

      i++;
      continue;
    }

    if (currentMisc) {
      currentMisc.content += (currentMisc.content ? '\n' : '') + line;
    } else if (currentMonthIdx === null) {
      prefaceLines.push(line);
    } else if (currentH3) {
      currentH3.content += (currentH3.content ? '\n' : '') + line;
    } else {
      currentMonthIntroLines.push(line);
    }

    i++;
  }

  flushH3();
  if (currentMonthIdx !== null && currentMonthIntroLines.length > 0) {
    const bucket = months[currentMonthIdx]!;
    bucket.intro = (bucket.intro ? bucket.intro + '\n' : '') + currentMonthIntroLines.join('\n');
  }

  if (currentMisc) {
    currentMisc.content = trimBlankEdges(currentMisc.content);
    misc.push(currentMisc);
  }

  for (let mIdx = 0; mIdx < months.length; mIdx++) {
    if (months[mIdx]) {
      months[mIdx]!.intro = trimBlankEdges(months[mIdx]!.intro);
      months[mIdx]!.days.forEach(d => (d.content = trimBlankEdges(d.content)));
    }
  }

  return {preface: prefaceLines.join('\n'), months, misc};
}

function monthOrderFrom(todayIdx: number): number[] {
  const order: number[] = [];
  for (let k = 0; k < 12; k++) {
    order.push((todayIdx + k) % 12);
  }
  return order;
}

function isTodayEntry(today: Date, monthIdx: number, d: DayEntry): boolean {
  if (monthIdx !== today.getMonth()) {
    return false;
  }
  if (d.day !== today.getDate()) {
    return false;
  }
  if (d.yearTag != null) {
    return d.yearTag === today.getFullYear();
  }
  return nextOccurrenceYear(today, monthIdx, d.day) === today.getFullYear();
}

function highlightH3(line: string): string {
  const cleaned = normalizeH3TitleEquals(line);
  return cleaned.replace(/^###\s+(.*)$/, (_m, t) => {
    const inner = stripEqualsFromTitleText(String(t));
    return `### ==${inner}==`;
  });
}

function ensureDatedEntry(
  months: (MonthBucket | null)[],
  mIdx: number,
  day: number,
  year: number,
): DayEntry {
  const bucket = months[mIdx]!;
  const found = bucket.days.find(d => d.day === day && d.yearTag === year);
  if (found) {
    return found;
  }

  const date = new Date(year, mIdx, day);
  const weekday = weekdayLong(date);
  const monthName = monthLong(date);
  const ordinal = getOrdinal(day);

  const entry: DayEntry = {
    titleLine: `### ${weekday}, ${monthName} ${ordinal}, ${year}`,
    content: '',
    day,
    yearTag: year,
  };
  bucket.days.push(entry);
  return entry;
}

/** Merge duplicate H3 entries within a month bucket. */
function mergeDuplicateH3s(bucket: MonthBucket) {
  const map = new Map<string, DayEntry>();
  const out: DayEntry[] = [];

  const keyOf = (d: DayEntry): string => {
    if (d.yearTag != null) {
      return `D:${d.yearTag}-${d.day}`;
    }
    const rule = d.recurrenceRule ?? '↺';
    return `R:${rule}-${d.day}`;
  };

  for (const d of bucket.days) {
    const key = keyOf(d);
    const prev = map.get(key);
    if (!prev) {
      map.set(key, d);
      out.push(d);
      continue;
    }

    const a = (prev.content ?? '').trim();
    const b = (d.content ?? '').trim();
    let merged = a;
    if (a && b) {
      merged = `${a}\n\n${b}`;
    } else if (!a && b) {
      merged = b;
    }
    prev.content = merged;

    if (prev.yearTag == null && !prev.recurrenceRule && d.recurrenceRule) {
      prev.recurrenceRule = d.recurrenceRule;
    }
  }

  bucket.days = out;
}

function render(doc: ParsedDoc, today: Date): string {
  const {frontmatter, h1Line, h1Content, months, misc} = doc;

  const y = today.getFullYear();
  const todayMonth = today.getMonth();
  const todayDay = today.getDate();
  const order = monthOrderFrom(todayMonth);

  let hadCurrentMonth = false;
  let wrappedDaysForCurrent: DayEntry[] = [];
  let futureBeyondNextForCurrent: DayEntry[] = [];

  const monthSections: string[] = [];

  for (const mIdx of order) {
    const bucket = months[mIdx];
    if (!bucket) {
      continue;
    }

    const recurring = bucket.days.filter(d => d.yearTag == null && (d.recurrenceRule ?? '↺'));
    for (const d of recurring) {
      const rule = d.recurrenceRule ?? '↺';
      const next = computeNextOccurrence(today, rule, null, mIdx, d.day >= 1 && d.day <= 31 ? d.day : null);
      const targetMIdx = next.getMonth();
      const targetDay = next.getDate();

      if (targetMIdx !== mIdx) {
        bucket.days = bucket.days.filter(x => x !== d);

        if (!months[targetMIdx]) {
          const monthTitle = indexToMonthTitle[targetMIdx];
          months[targetMIdx] = {h2Line: `## ${monthTitle}`, intro: '', days: [], seen: true};
        }
        const tb = months[targetMIdx]!;

        const weekday = weekdayLong(next);
        const monthName = monthLong(next);
        const ordinal = getOrdinal(targetDay);
        d.titleLine = `### ${weekday}, ${monthName} ${ordinal}, ${rule}`;
        d.day = targetDay;
        d.recurrenceRule = rule;

        tb.days.push(d);
      } else {
        const weekday = weekdayLong(next);
        const monthName = monthLong(next);
        const ordinal = getOrdinal(targetDay);
        d.titleLine = `### ${weekday}, ${monthName} ${ordinal}, ${rule}`;
        d.day = targetDay;
        d.recurrenceRule = rule;
      }
    }

    mergeDuplicateH3s(bucket);

    {
      const localRecurring = bucket.days.filter(d => d.yearTag == null);
      for (const d of localRecurring) {
        if (!d.content || !d.content.trim()) {
          continue;
        }
        const rule = d.recurrenceRule ?? '↺';
        const anchorDay = d.day >= 1 && d.day <= 31 ? d.day : null;
        const anchorMonthIdx = mIdx;

        const {kept, moved} = splitOutImportantOneBullets(d.content.trim());
        d.content = kept;
        if (moved.length === 0) {
          continue;
        }

        const next = computeNextOccurrence(today, rule, null, anchorMonthIdx, anchorDay);
        const targetMIdx = next.getMonth();
        const targetYear = next.getFullYear();
        const targetDay = next.getDate();

        ensureRecurringEntry(months, today, rule, anchorMonthIdx, anchorDay, null);
        if (!months[targetMIdx]) {
          const monthTitle = indexToMonthTitle[targetMIdx];
          months[targetMIdx] = {h2Line: `## ${monthTitle}`, intro: '', days: [], seen: true};
        }
        const dated = ensureDatedEntry(months, targetMIdx, targetDay, targetYear);
        const joined = (dated.content ? dated.content + '\n' : '') + moved.join('\n');
        dated.content = trimBlankEdges(joined);
      }
    }

    const slotYear = mIdx >= todayMonth ? y : y + 1;
    const yearExact: DayEntry[] = [];
    const yearFuture: DayEntry[] = [];
    const noYear: DayEntry[] = [];

    for (const d of bucket.days) {
      if (d.yearTag == null) {
        noYear.push(d);
      } else if (d.yearTag < slotYear) {
        continue;
      } else if (d.yearTag === slotYear) {
        yearExact.push(d);
      } else {
        yearFuture.push(d);
      }
    }

    const byDay = (a: DayEntry, b: DayEntry) => a.day - b.day;
    const byYearThenDay = (a: DayEntry, b: DayEntry) => a.yearTag! - b.yearTag! || a.day - b.day;

    yearExact.sort(byDay);
    yearFuture.sort(byYearThenDay);
    noYear.sort(byDay);

    let monthTop: DayEntry[] = [];
    let monthWrapped: DayEntry[] = [];
    let monthDeferred: DayEntry[] = [];

    if (mIdx === todayMonth) {
      hadCurrentMonth = true;

      const yearExactPast = yearExact.filter(d => d.day < todayDay);

      for (const d of yearExactPast) {
        const {moved, newContent} = replanCheckedBulletsFromDayEntry(
          d,
          months,
          today,
          d.yearTag ?? today.getFullYear(),
          mIdx,
          d.day,
        );

        if (moved > 0 && newContent === '') {
          continue;
        }

        if (moved > 0) {
          d.content = newContent;
        }
      }

      const yearExactFuture = yearExact.filter(d => d.day >= todayDay);

      const topCandidates: DayEntry[] = [
        ...yearExactFuture,
        ...noYear.filter(d => d.day >= todayDay),
      ].sort(byDay);
      monthTop = topCandidates;

      monthWrapped = noYear.filter(d => d.day < todayDay).sort(byDay);
      monthDeferred = yearFuture;
    } else {
      const merged = [...yearExact, ...noYear].sort(byDay);
      monthTop = [...merged, ...yearFuture];
    }

    const buf: string[] = [];
    buf.push('');
    buf.push(bucket.h2Line);
    if (bucket.intro && bucket.intro.trim().length > 0) {
      buf.push('');
      buf.push(bucket.intro.trim());
    }
    for (const d of monthTop) {
      const titleOut = isTodayEntry(today, mIdx, d) ? highlightH3(d.titleLine) : d.titleLine;
      buf.push('');
      buf.push(titleOut);

      if (d.content && d.content.trim().length > 0) {
        const daySafe = Math.min(Math.max(d.day, 1), 31);
        let occYear = d.yearTag;
        if (occYear == null) {
          const rule = d.recurrenceRule ?? '↺';
          const next = computeNextOccurrence(today, rule, null, mIdx, daySafe);
          occYear = next.getFullYear();
        }
        buf.push('');
        buf.push(updateAgesInContent(d.content.trim(), occYear));
      }
    }
    if (mIdx === todayMonth) {
      wrappedDaysForCurrent = monthWrapped;
      futureBeyondNextForCurrent = monthDeferred;
    }

    monthSections.push(buf.join('\n'));
  }

  const out: string[] = [];

  if (frontmatter && frontmatter.trim()) {
    out.push(frontmatter.trim());
    out.push('');
  }

  if (h1Line) {
    out.push(h1Line);
    if (h1Content) {
      out.push('');
      out.push(h1Content);
    }
  } else if (h1Content) {
    out.push(h1Content.trim());
  }

  for (const s of misc) {
    out.push('');
    out.push(s.h2Line);
    if (s.content && s.content.trim().length > 0) {
      out.push('');
      out.push(s.content.trim());
    }
  }

  out.push(...monthSections);

  if (hadCurrentMonth && (wrappedDaysForCurrent.length > 0 || futureBeyondNextForCurrent.length > 0)) {
    const bucket = months[todayMonth]!;
    out.push('');
    out.push(bucket.h2Line);
    const byDay = (a: DayEntry, b: DayEntry) => a.day - b.day;

    const wrappedSorted = [...wrappedDaysForCurrent].sort(byDay);
    for (const d of wrappedSorted) {
      const titleOut = isTodayEntry(today, todayMonth, d) ? highlightH3(d.titleLine) : d.titleLine;
      out.push('');
      out.push(titleOut);
      if (d.content && d.content.trim().length > 0) {
        const daySafe = Math.min(Math.max(d.day, 1), 31);
        const occYear = d.yearTag ?? nextOccurrenceYear(today, todayMonth, daySafe);
        out.push('');
        out.push(updateAgesInContent(d.content.trim(), occYear));
      }
    }

    const beyondSorted = [...futureBeyondNextForCurrent].sort(
      (a, b) => a.yearTag! - b.yearTag! || a.day - b.day,
    );
    for (const d of beyondSorted) {
      const titleOut = isTodayEntry(today, todayMonth, d) ? highlightH3(d.titleLine) : d.titleLine;
      out.push('');
      out.push(titleOut);
      if (d.content && d.content.trim().length > 0) {
        out.push('');
        out.push(updateAgesInContent(d.content.trim(), d.yearTag!));
      }
    }
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '') + '\n';
}

/**
 * Normalizes a hub's agenda markdown in place (returns the canonical text). Pure and deterministic
 * for a fixed `now`; idempotent.
 */
export function normalizeAgenda(original: string, now: Date): string {
  const {frontmatter: existingFM, body} = splitFrontmatter(original);
  const parsed = parseMarkdown(body, now);
  const doc: ParsedDoc = {
    frontmatter: existingFM,
    h1Line: '',
    h1Content: parsed.preface ?? '',
    months: parsed.months,
    misc: parsed.misc,
  };
  return render(doc, now);
}

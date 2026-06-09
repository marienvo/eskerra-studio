/**
 * Shared helpers for the agenda normalizer and bullet parser (Part 2 of the calendar pipeline).
 * Ported from the legacy `Scripts/processors` calendar handler; behavior is intentionally preserved.
 * All time decisions derive from an injected `now` (deterministic under `TZ=UTC`).
 */

export function getOrdinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

export function trimBlankEdges(s: string): string {
  return s.replace(/^\n+/, '').replace(/\n+$/, '');
}

export function extractFirstInt(s: string): number | null {
  const m = s.match(/(\d{1,2})/);
  if (!m) {
    return null;
  }
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

export function extractYearTagFromH3(titleLine: string): number | null {
  const m = titleLine.match(/\b(19|20)\d{2}\b/);
  return m ? parseInt(m[0], 10) : null;
}

export function nextOccurrenceYear(today: Date, monthIdx: number, day: number): number {
  const y = today.getFullYear();
  const todayMid = new Date(y, today.getMonth(), today.getDate());
  const thisYearOccurrence = new Date(y, monthIdx, day);
  return thisYearOccurrence >= todayMid ? y : y + 1;
}

export function updateAgesInContent(content: string, occurrenceYear: number): string {
  const re = /⌚️\s*(\d{4}),\s*(\d{1,3})\s*years\b/g;
  return content.replace(re, (full, yStr: string) => {
    const birthYear = parseInt(yStr, 10);
    if (!Number.isFinite(birthYear)) {
      return full;
    }
    const age = Math.max(0, occurrenceYear - birthYear);
    return `⌚️ ${birthYear}, ${age} years`;
  });
}

export function isH2(line: string): boolean {
  return /^## (?!#)(.*)$/.test(line);
}

export function isH3(line: string): boolean {
  return /^### (.*)$/.test(line);
}

export function headingText(line: string, level: 2 | 3): string | null {
  const re = level === 2 ? /^## (.*)$/ : /^### (.*)$/;
  const m = line.match(re);
  return m ? (m[1] ?? '').trim() : null;
}

/** Split a markdown string into YAML frontmatter and body (legacy regex form, preserved). */
export function splitFrontmatter(md: string): {frontmatter: string; body: string} {
  const m = md.match(/^(\uFEFF?---\s*\n[\s\S]*?\n---)\s*\n?/);
  if (m) {
    return {frontmatter: m[1], body: md.slice(m[0].length)};
  }
  return {frontmatter: '', body: md};
}

/** Month names → 0-based index, English + Dutch, matched fuzzily on H2 titles. */
const monthAliases: Array<{idx: number; names: string[]}> = [
  {idx: 0, names: ['january', 'januari']},
  {idx: 1, names: ['february', 'februari']},
  {idx: 2, names: ['march', 'maart']},
  {idx: 3, names: ['april']},
  {idx: 4, names: ['may', 'mei']},
  {idx: 5, names: ['june', 'juni']},
  {idx: 6, names: ['july', 'juli']},
  {idx: 7, names: ['august', 'augustus']},
  {idx: 8, names: ['september']},
  {idx: 9, names: ['october', 'oktober']},
  {idx: 10, names: ['november']},
  {idx: 11, names: ['december']},
];

const monthFinders = monthAliases.map(({idx, names}) => {
  const pat = `(?:^|[^A-Za-z])(?:${names.join('|')})(?:[^A-Za-z]|$)`;
  return {idx, re: new RegExp(pat, 'i')};
});

export function monthIdxFromH2Title(raw: string): number | null {
  const asciiish = raw
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
  for (const {idx, re} of monthFinders) {
    if (re.test(asciiish)) {
      return idx;
    }
  }
  return null;
}

export const indexToMonthTitle = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const weekdayLongFormatter = new Intl.DateTimeFormat('en-US', {weekday: 'long'});
const monthLongFormatter = new Intl.DateTimeFormat('en-US', {month: 'long'});

export function weekdayLong(d: Date): string {
  return weekdayLongFormatter.format(d);
}

export function monthLong(d: Date): string {
  return monthLongFormatter.format(d);
}

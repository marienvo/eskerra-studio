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

/** Split a markdown string into YAML frontmatter and body. Linear scanner \u2014 no regex backtracking. */
export function splitFrontmatter(md: string): {frontmatter: string; body: string} {
  let i = 0;
  if (md.charCodeAt(0) === 0xFEFF) i = 1; // skip optional BOM
  // Opening line must be --- (optionally followed by spaces/tabs, then newline)
  if (md.charCodeAt(i) !== 45 || md.charCodeAt(i + 1) !== 45 || md.charCodeAt(i + 2) !== 45) {
    return {frontmatter: '', body: md};
  }
  let j = i + 3;
  while (j < md.length && (md.charCodeAt(j) === 32 || md.charCodeAt(j) === 9)) j++;
  if (md.charCodeAt(j) === 13) j++; // optional \r
  if (j >= md.length || md.charCodeAt(j) !== 10) return {frontmatter: '', body: md};
  j++; // consume \n
  // Scan line by line for closing ---
  while (j < md.length) {
    const lineStart = j;
    while (j < md.length && md.charCodeAt(j) !== 10 && md.charCodeAt(j) !== 13) j++;
    // Closing line: exactly --- with optional trailing spaces/tabs
    if (
      j - lineStart >= 3 &&
      md.charCodeAt(lineStart) === 45 &&
      md.charCodeAt(lineStart + 1) === 45 &&
      md.charCodeAt(lineStart + 2) === 45
    ) {
      let isClose = true;
      for (let k = lineStart + 3; k < j; k++) {
        const c = md.charCodeAt(k);
        if (c !== 32 && c !== 9) { isClose = false; break; }
      }
      if (isClose) {
        const frontmatter = md.slice(0, j);
        if (j < md.length && md.charCodeAt(j) === 13) j++;
        if (j < md.length && md.charCodeAt(j) === 10) j++;
        return {frontmatter, body: md.slice(j)};
      }
    }
    if (j < md.length && md.charCodeAt(j) === 13) j++;
    if (j < md.length && md.charCodeAt(j) === 10) j++;
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

/**
 * Linear-time string helpers to avoid regex backtracking (CodeQL / ReDoS).
 */

const WS_CODES = new Set<number>([9, 10, 13, 32]);

export function isAsciiWhitespaceCode(c: number): boolean {
  return WS_CODES.has(c);
}

/** Tab / LF / CR only: may appear inside `[`…`]` before the mark without consuming the unchecked space. */
function isCheckboxLeadingWhitespaceCode(c: number): boolean {
  return c === 9 || c === 10 || c === 13;
}

/**
 * Parses GitHub-style task checkbox content immediately after `[`.
 * Mirrors `/\[\s*([xX ])\s*\]/` on a single line: ` ` is a valid unchecked marker.
 * Leading tab / LF / CR before `x`, `X`, or the unchecked space is skipped; a leading
 * literal space stays the first body code unit so `[ x]` still resolves to checked.
 */
export function parseTaskCheckboxMarkAfterOpenBracket(
  s: string,
  indexAfterOpenBracket: number,
): {checked: boolean; indexAfterCheckboxBody: number} | null {
  const p = indexAfterOpenBracket;
  if (p >= s.length) {
    return null;
  }
  let r = p;
  while (r < s.length && isCheckboxLeadingWhitespaceCode(s.charCodeAt(r))) {
    r++;
  }
  if (r >= s.length) {
    return null;
  }
  const c0 = s.charCodeAt(r);
  if (c0 === 120 || c0 === 88) {
    return {checked: true, indexAfterCheckboxBody: r + 1};
  }
  if (c0 === 32) {
    let q = r + 1;
    while (q < s.length && isAsciiWhitespaceCode(s.charCodeAt(q))) {
      q++;
    }
    if (q < s.length) {
      const cq = s.charCodeAt(q);
      if (cq === 120 || cq === 88) {
        return {checked: true, indexAfterCheckboxBody: q + 1};
      }
    }
    return {checked: false, indexAfterCheckboxBody: r + 1};
  }
  return null;
}

export function trimEndAsciiWhitespace(s: string): string {
  let end = s.length;
  while (end > 0 && isAsciiWhitespaceCode(s.charCodeAt(end - 1))) {
    end--;
  }
  return end === s.length ? s : s.slice(0, end);
}

export function trimStartAsciiWhitespace(s: string): string {
  let start = 0;
  while (start < s.length && isAsciiWhitespaceCode(s.charCodeAt(start))) {
    start++;
  }
  return start === 0 ? s : s.slice(start);
}

export function trimAsciiWhitespace(s: string): string {
  return trimStartAsciiWhitespace(trimEndAsciiWhitespace(s));
}

export function replaceBackslashesWithSlashes(s: string): string {
  if (!s.includes('\\')) {
    return s;
  }
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out += c === 92 ? '/' : s[i]!;
  }
  return out;
}

/** `trim` + backslashes to slashes (vault path segments; no trailing-slash strip). */
export function trimAndUnixSlashes(s: string): string {
  return replaceBackslashesWithSlashes(trimAsciiWhitespace(s));
}

export function stripTrailingSlashes(s: string): string {
  let end = s.length;
  while (end > 0 && s.charCodeAt(end - 1) === 47) {
    end--;
  }
  return end === s.length ? s : s.slice(0, end);
}

export function stripLeadingSlashes(s: string): string {
  let start = 0;
  while (start < s.length && s.charCodeAt(start) === 47) {
    start++;
  }
  return start === 0 ? s : s.slice(start);
}

/** Lowercases ASCII `A–Z` only; leaves other code units unchanged. */
export function toAsciiLowercase(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 65 && c <= 90) {
      out += String.fromCharCode(c + 32);
    } else {
      out += s[i]!;
    }
  }
  return out;
}

/** `trim` + backslashes to slashes + strip trailing `/`. */
export function normalizeVaultSlashesUri(s: string): string {
  return stripTrailingSlashes(trimAndUnixSlashes(s));
}

export type ReadHrefSchemeResult = {
  schemeLower: string;
  /** Index of ':' in the original trimmed string. */
  colonIndex: number;
};

/**
 * Reads an RFC3986-style scheme at the start of `href` (after trim).
 * Returns null if there is no `scheme:` prefix.
 */
export function readHrefScheme(href: string): ReadHrefSchemeResult | null {
  const h = trimAsciiWhitespace(href);
  if (h.length < 2) {
    return null;
  }
  const c0 = h.charCodeAt(0);
  if (!isAsciiLetter(c0)) {
    return null;
  }
  let i = 1;
  while (i < h.length) {
    const c = h.charCodeAt(i);
    if (c === 58) {
      return {schemeLower: h.slice(0, i).toLowerCase(), colonIndex: i};
    }
    if (isSchemeChar(c)) {
      i++;
      continue;
    }
    return null;
  }
  return null;
}

function isAsciiLetter(c: number): boolean {
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
}

function isSchemeChar(c: number): boolean {
  return (
    isAsciiLetter(c) ||
    (c >= 48 && c <= 57) ||
    c === 43 ||
    c === 45 ||
    c === 46
  );
}

/**
 * For `scheme://path` URIs after {@link trimAndUnixSlashes}: returns `scheme://` length
 * (e.g. `content://` → 10).
 */
export function readUriSchemeWithDoubleSlashLength(normalized: string): number | null {
  const scheme = readHrefScheme(normalized);
  if (!scheme) {
    return null;
  }
  const afterColon = scheme.colonIndex + 1;
  if (
    afterColon + 1 < normalized.length &&
    normalized.charCodeAt(afterColon) === 47 &&
    normalized.charCodeAt(afterColon + 1) === 47
  ) {
    return afterColon + 2;
  }
  return null;
}

export function isExternalMarkdownHrefTrimmed(hrefTrimmed: string): boolean {
  if (hrefTrimmed === '' || hrefTrimmed.startsWith('//')) {
    return true;
  }
  return readHrefScheme(hrefTrimmed) != null;
}

/** Collapses runs of ASCII whitespace to a single space. */
export function collapseAsciiWhitespaceRunsToSpace(s: string): string {
  let out = '';
  let prevWasWs = false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (isAsciiWhitespaceCode(c)) {
      if (!prevWasWs) {
        out += ' ';
        prevWasWs = true;
      }
    } else {
      out += s[i]!;
      prevWasWs = false;
    }
  }
  return out;
}

const INBOX_ILLEGAL_NAME_CHARS = new Set<string>([
  '/',
  '\\',
  ':',
  '*',
  '?',
  '"',
  '<',
  '>',
  '|',
  "'",
  '`',
  '\u2018',
  '\u2019',
  '\u201c',
  '\u201d',
]);

export function stripInboxIllegalFilenameChars(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (!INBOX_ILLEGAL_NAME_CHARS.has(ch)) {
      out += ch;
    }
  }
  return out;
}

export function trimLeadingChars(s: string, chars: Set<string>): string {
  let start = 0;
  while (start < s.length && chars.has(s[start]!)) {
    start++;
  }
  return start === 0 ? s : s.slice(start);
}

export function trimTrailingChars(s: string, chars: Set<string>): string {
  let end = s.length;
  while (end > 0 && chars.has(s[end - 1]!)) {
    end--;
  }
  return end === s.length ? s : s.slice(0, end);
}

const DOT_OR_SPACE = new Set<string>(['.', ' ']);

export function trimLeadingDotsAndSpaces(s: string): string {
  return trimLeadingChars(s, DOT_OR_SPACE);
}

export function trimTrailingDotsAndSpaces(s: string): string {
  return trimTrailingChars(s, DOT_OR_SPACE);
}

export function collapseRunsOfChar(s: string, ch: string): string {
  if (!s.includes(ch)) {
    return s;
  }
  let out = '';
  let prev = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c === ch) {
      if (!prev) {
        out += ch;
        prev = true;
      }
    } else {
      out += c;
      prev = false;
    }
  }
  return out;
}

/** `[-_]+` → single space (note title from filename). */
export function replaceDashUnderscoreRunsWithSpace(s: string): string {
  let out = '';
  let inRun = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c === '-' || c === '_') {
      if (!inRun) {
        out += ' ';
        inRun = true;
      }
    } else {
      out += c;
      inRun = false;
    }
  }
  return out;
}

export function mergeAmpEntitiesToAmpersand(s: string): string {
  if (!s.includes('&')) {
    return s;
  }
  return s.split('&amp;').join('&');
}

export function extractXmlSimpleTagText(xml: string, tagName: string): string {
  const open = `<${tagName}>`;
  const close = `</${tagName}>`;
  const i = xml.indexOf(open);
  if (i < 0) {
    return '';
  }
  const start = i + open.length;
  const j = xml.indexOf(close, start);
  if (j < 0) {
    return '';
  }
  return xml.slice(start, j);
}

/** Leading indent length (spaces and tabs only). */
export function leadingSpaceTabIndentLen(line: string): number {
  let n = 0;
  while (n < line.length) {
    const c = line.charCodeAt(n);
    if (c === 32 || c === 9) {
      n++;
      continue;
    }
    break;
  }
  return n;
}

export function shouldTryJsonParsePrefix(rawValueTrimmed: string): boolean {
  if (rawValueTrimmed.length === 0) {
    return false;
  }
  const c0 = rawValueTrimmed.charCodeAt(0);
  if (c0 === 34) {
    return true; // "
  }
  if (c0 === 45) {
    // -0, -1.2, ...
    return true;
  }
  if (c0 >= 48 && c0 <= 57) {
    return true; // digit
  }
  const lower = rawValueTrimmed.toLowerCase();
  if (lower === 'true' || lower === 'false' || lower === 'null') {
    return true;
  }
  if (c0 === 123 || c0 === 91) {
    return true; // { [
  }
  return false;
}

/** Removes `suffix` from the end of `s` when case-insensitive match; otherwise `null`. */
export function stripSuffixCaseInsensitive(s: string, suffix: string): string | null {
  if (suffix.length === 0) {
    return s;
  }
  const low = s.toLowerCase();
  const suf = suffix.toLowerCase();
  if (!low.endsWith(suf)) {
    return null;
  }
  return s.slice(0, s.length - suffix.length);
}

/** Backslashes to slashes + strip trailing `/` without trimming the string ends. */
export function unixSlashesStripTrailingNoTrim(s: string): string {
  return stripTrailingSlashes(replaceBackslashesWithSlashes(s));
}

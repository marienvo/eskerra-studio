import {TODAY_HUB_SECTION_DELIMITER} from './todayHubSectionDelimiter';

/**
 * Paragraph break before the marker (`\n\n` preferred, `\n` allowed), optional horizontal spaces on
 * the marker line (`[ \t]*` only — not `\s*`), then a break after the marker: full blank line, single
 * newline before non-newline content, or end of file.
 *
 * **Do not** use `\s*` around `::today-section::`: it matches newlines, so with an empty middle
 * column the post-marker `\n\n` plus the next delimiter's leading `\n\n` can be eaten in one match,
 * collapsing column slots (3 cols → 2 chunks).
 */
const SPLIT_RX =
  /(?:\n\n|\n)[ \t]*::today-section::[ \t]*(?:\n\n|\n(?=[^\n])|$)/g;

/** A line that is only the section marker (optional spaces) — never valid user prose in a cell. */
const SECTION_MARKER_ONLY_LINE = /^\s*::today-section::\s*$/;

/**
 * Removes stray `::today-section::` lines from a column body. Malformed row text (adjacent markers,
 * marker at chunk start without a leading newline before it, etc.) can leave markers inside a segment;
 * those must not show in the hub cell editor.
 */
export function stripTodayHubDelimiterOnlyLinesFromColumn(body: string): string {
  const normalized = body.replace(/\r\n/g, '\n');
  return normalized
    .split('\n')
    .filter(line => !SECTION_MARKER_ONLY_LINE.test(line))
    .join('\n');
}

function sanitizeColumnChunks(chunks: string[]): string[] {
  return chunks.map(stripTodayHubDelimiterOnlyLinesFromColumn);
}

/**
 * Splits row file body into `columnCount` segments. Single column: whole text.
 * If `columnCount > 1` but no delimiter: segment 0 holds entire text, rest empty.
 * Extra delimited chunks are merged into the last column.
 * Delimiter matching is slightly relaxed vs the canonical `TODAY_HUB_SECTION_DELIMITER` (see `SPLIT_RX`).
 */
export function splitTodayRowIntoColumns(fullText: string, columnCount: number): string[] {
  if (columnCount < 1) {
    throw new Error('columnCount must be at least 1');
  }
  const normalized = fullText.replace(/\r\n/g, '\n');
  if (columnCount === 1) {
    return sanitizeColumnChunks([normalized]);
  }
  const chunks = normalized.split(SPLIT_RX);
  if (chunks.length === 1) {
    return sanitizeColumnChunks([chunks[0], ...Array.from({length: columnCount - 1}, () => '')]);
  }
  const head = chunks.slice(0, columnCount - 1);
  const tail = chunks.slice(columnCount - 1).join(TODAY_HUB_SECTION_DELIMITER);
  return sanitizeColumnChunks([...head, tail]);
}

export type TodayRowColumnSpan = {
  /** Sanitized section string the cell editor loads (identical to `splitTodayRowIntoColumns[i]`). */
  section: string;
  /** UTF-16 start offset of this column's content in the `\r\n`→`\n` normalized full row text. */
  sourceStart: number;
};

/**
 * Like {@link splitTodayRowIntoColumns}, but also reports each column's start offset in the
 * CRLF-normalized full row text. Lets callers map a full-file caret (e.g. a resolved reminder
 * token position) back to the column section the hub cell editor displays.
 *
 * Offsets mirror `String.split(SPLIT_RX)`: the matched delimiter text is consumed, so a column's
 * `sourceStart` is the position just after the preceding delimiter. For a well-formed row (exactly
 * `columnCount - 1` delimiters) each section is a contiguous slice of the normalized text, so
 * `sourceStart + offsetInSection` round-trips. Trailing empty columns (no delimiter present) and the
 * over-split tail (more delimiters than columns) report `sourceStart` at the start of their first
 * chunk; intra-section offsets past an internal delimiter in those malformed cases may drift.
 */
export function splitTodayRowIntoColumnSpans(
  fullText: string,
  columnCount: number,
): TodayRowColumnSpan[] {
  if (columnCount < 1) {
    throw new Error('columnCount must be at least 1');
  }
  const normalized = fullText.replace(/\r\n/g, '\n');
  const sections = splitTodayRowIntoColumns(normalized, columnCount);
  if (columnCount === 1) {
    return [{section: sections[0], sourceStart: 0}];
  }
  const starts: number[] = [0];
  const rx = new RegExp(SPLIT_RX.source, SPLIT_RX.flags);
  let m: RegExpExecArray | null;
  while ((m = rx.exec(normalized)) !== null) {
    starts.push(m.index + m[0].length);
    if (m[0].length === 0) {
      rx.lastIndex += 1;
    }
  }
  return sections.map((section, i) => ({
    section,
    sourceStart: i < starts.length ? starts[i] : normalized.length,
  }));
}

export function mergeTodayRowColumns(sections: string[]): string {
  if (sections.length === 0) {
    return '';
  }
  if (sections.length === 1) {
    return sections[0];
  }
  return sections.join(TODAY_HUB_SECTION_DELIMITER);
}

/** True if every section is empty or whitespace-only. */
export function todayHubRowSectionsAllBlank(sections: string[]): boolean {
  return sections.every(s => s.trim() === '');
}

/** Lines that contain only spaces or tabs become empty lines (same as a blank markdown line). */
function spaceTabOnlyLinesToEmpty(text: string): string {
  return text
    .split('\n')
    .map(line => (/^[ \t]*$/.test(line) ? '' : line))
    .join('\n');
}

function trimLeadingTrailingEmptyLines(text: string): string {
  const lines = text.split('\n');
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start] === '') {
    start += 1;
  }
  while (end > start && lines[end - 1] === '') {
    end -= 1;
  }
  return lines.slice(start, end).join('\n');
}

/**
 * Canonical hub row body for disk: space/tab-only lines become empty lines; each column is trimmed
 * of leading/trailing blank lines; multi-column joins use exactly {@link TODAY_HUB_SECTION_DELIMITER}
 * (one blank line before and after `::today-section::`).
 *
 * Call this when persisting a weekly hub row file.
 */
export function normalizeTodayHubRowForDisk(fullText: string, columnCount: number): string {
  const normalized = spaceTabOnlyLinesToEmpty(fullText.replace(/\r\n/g, '\n'));
  const sections = splitTodayRowIntoColumns(normalized, columnCount).map(s =>
    trimLeadingTrailingEmptyLines(s),
  );
  return mergeTodayRowColumns(sections);
}

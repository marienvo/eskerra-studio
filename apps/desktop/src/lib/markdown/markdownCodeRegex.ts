/**
 * Inline code span (single line). Opening and closing backtick runs must match
 * length (GFM / Turndown: `` `code` `` when the payload contains a backtick).
 */
export const INLINE_CODE_RE = /(`+)(?:[^`\n]|`(?!\1))*?\1/g;

export type MarkdownFencedCodeSpan = {
  readonly start: number;
  readonly end: number;
};

function lineStartIndex(md: string, index: number): number {
  const prevNewline = md.lastIndexOf('\n', index - 1);
  return prevNewline < 0 ? 0 : prevNewline + 1;
}

/** CommonMark: up to 3 spaces, then optional `>` blockquote markers. */
function skipFenceLinePrefix(line: string, start: number): number {
  let i = start;
  let spaces = 0;
  while (i < line.length && line[i] === ' ' && spaces < 3) {
    spaces += 1;
    i += 1;
  }
  while (i < line.length && line[i] === '>') {
    i += 1;
    if (i < line.length && line[i] === ' ') {
      i += 1;
    }
  }
  return i;
}

function openingFenceOnLine(
  line: string,
): {fenceStart: number; fenceLen: number} | null {
  const fenceStart = skipFenceLinePrefix(line, 0);
  if (fenceStart >= line.length || line[fenceStart] !== '`') {
    return null;
  }
  let fenceLen = 0;
  while (
    fenceStart + fenceLen < line.length
    && line[fenceStart + fenceLen] === '`'
  ) {
    fenceLen += 1;
  }
  if (fenceLen < 3) {
    return null;
  }
  return {fenceStart, fenceLen};
}

function isClosingFenceLine(line: string, fenceLen: number): boolean {
  const fenceStart = skipFenceLinePrefix(line, 0);
  if (fenceStart >= line.length || line[fenceStart] !== '`') {
    return false;
  }
  let closeLen = 0;
  while (
    fenceStart + closeLen < line.length
    && line[fenceStart + closeLen] === '`'
  ) {
    closeLen += 1;
  }
  if (closeLen < fenceLen) {
    return false;
  }
  for (let i = fenceStart + closeLen; i < line.length; i += 1) {
    if (line[i] !== ' ' && line[i] !== '\t') {
      return false;
    }
  }
  return true;
}

function findClosingFenceEnd(
  md: string,
  bodyStart: number,
  fenceLen: number,
): number {
  let lineStart = bodyStart;
  while (lineStart < md.length) {
    const lineEnd = md.indexOf('\n', lineStart);
    const lineEndPos = lineEnd < 0 ? md.length : lineEnd;
    const line = md.slice(lineStart, lineEndPos);
    if (isClosingFenceLine(line, fenceLen)) {
      return lineEnd < 0 ? md.length : lineEnd + 1;
    }
    if (lineEnd < 0) {
      return -1;
    }
    lineStart = lineEnd + 1;
  }
  return -1;
}

function tryFencedBlockAt(
  md: string,
  tickIndex: number,
): MarkdownFencedCodeSpan | null {
  const openLineStart = lineStartIndex(md, tickIndex);
  const openLineEnd = md.indexOf('\n', tickIndex);
  if (openLineEnd < 0) {
    return null;
  }
  const openLine = md.slice(openLineStart, openLineEnd);
  const opening = openingFenceOnLine(openLine);
  if (!opening || openLineStart + opening.fenceStart !== tickIndex) {
    return null;
  }
  const closeEnd = findClosingFenceEnd(
    md,
    openLineEnd + 1,
    opening.fenceLen,
  );
  if (closeEnd < 0) {
    return null;
  }
  return {start: openLineStart, end: closeEnd};
}

/**
 * Linear scan for GFM fenced code blocks (3+ backtick opening line, matching close line).
 * Supports four-backtick fences from pasted `<pre>` content that contains triple backticks.
 */
export function findFencedCodeSpans(md: string): MarkdownFencedCodeSpan[] {
  const spans: MarkdownFencedCodeSpan[] = [];
  let searchFrom = 0;

  while (searchFrom < md.length) {
    const tickIndex = md.indexOf('`', searchFrom);
    if (tickIndex < 0) {
      break;
    }
    const block = tryFencedBlockAt(md, tickIndex);
    if (block) {
      spans.push(block);
      searchFrom = block.end;
    } else {
      searchFrom = tickIndex + 1;
    }
  }

  return spans;
}

/** Apply `transformOutsideFences` to prose while leaving fenced code blocks literal. */
export function transformMarkdownPreservingFencedCode(
  md: string,
  transformOutsideFences: (segment: string) => string,
): string {
  const spans = findFencedCodeSpans(md);
  let out = '';
  let last = 0;
  for (const span of spans) {
    if (span.start > last) {
      out += transformOutsideFences(md.slice(last, span.start));
    }
    out += md.slice(span.start, span.end);
    last = span.end;
  }
  if (last < md.length) {
    out += transformOutsideFences(md.slice(last));
  }
  return out;
}

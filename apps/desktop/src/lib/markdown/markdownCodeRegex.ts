/**
 * Inline code span (single line). Opening and closing backtick runs must match
 * length (GFM / Turndown: `` `code` `` when the payload contains a backtick).
 */
export const INLINE_CODE_RE = /(`+)(?:[^`\n]|`(?!\1))*?\1/g;

export type MarkdownFencedCodeSpan = {
  readonly start: number;
  readonly end: number;
};

function isLineStart(md: string, index: number): boolean {
  return index === 0 || md[index - 1] === '\n';
}

function backtickRunLength(md: string, index: number): number {
  let len = 0;
  while (index + len < md.length && md[index + len] === '`') {
    len += 1;
  }
  return len;
}

function isClosingFenceLine(line: string, fenceLen: number): boolean {
  if (line.length !== fenceLen) {
    return false;
  }
  for (let i = 0; i < fenceLen; i += 1) {
    if (line[i] !== '`') {
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
  if (!isLineStart(md, tickIndex)) {
    return null;
  }
  const fenceLen = backtickRunLength(md, tickIndex);
  if (fenceLen < 3) {
    return null;
  }
  const openLineEnd = md.indexOf('\n', tickIndex);
  if (openLineEnd < 0) {
    return null;
  }
  const closeEnd = findClosingFenceEnd(md, openLineEnd + 1, fenceLen);
  if (closeEnd < 0) {
    return null;
  }
  return {start: tickIndex, end: closeEnd};
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

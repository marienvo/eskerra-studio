/** Result of applying the open-note caret policy to a markdown body slice. */
export type OpenNoteCaretPlacement = {
  /** Body text loaded into the editor (may include buffer-only blank lines). */
  doc: string;
  /** Caret offset in `doc` (end of line 3 or end of line 1). */
  caret: number;
};

const ATX_H1_LINE_RE = /^# /;

function splitBodyLines(body: string): string[] {
  return body.split('\n');
}

function lineOneIsAtxH1(lines: string[]): boolean {
  return lines.length > 0 && ATX_H1_LINE_RE.test(lines[0] ?? '');
}

function lineTwoMissingOrEmpty(lines: string[]): boolean {
  return lines.length < 2 || lines[1] === '';
}

/** Pad with trailing empty lines until `body` has at least `minLines` lines. */
function ensureMinimumLineCount(body: string, minLines: number): string {
  const lines = splitBodyLines(body);
  while (lines.length < minLines) {
    lines.push('');
  }
  return lines.join('\n');
}

/** Offset immediately after the last character on the 1-based `lineNumber` line. */
export function offsetAtEndOfLine(doc: string, lineNumber: number): number {
  if (lineNumber < 1) {
    return 0;
  }
  let line = 1;
  for (let i = 0; i <= doc.length; i++) {
    if (i === doc.length || doc[i] === '\n') {
      if (line === lineNumber) {
        return i;
      }
      line += 1;
    }
  }
  return doc.length;
}

/**
 * When opening a vault note in the capture editor: place the caret at the end of line 3
 * when line 1 is ATX h1 (`# `) and line 2 is missing or empty (padding is buffer-only).
 * Otherwise place the caret at the end of line 1.
 */
export function computeOpenNoteCaretPlacement(body: string): OpenNoteCaretPlacement {
  const lines = splitBodyLines(body);
  if (lineOneIsAtxH1(lines) && lineTwoMissingOrEmpty(lines)) {
    const doc = ensureMinimumLineCount(body, 3);
    return {doc, caret: offsetAtEndOfLine(doc, 3)};
  }
  return {doc: body, caret: offsetAtEndOfLine(body, 1)};
}

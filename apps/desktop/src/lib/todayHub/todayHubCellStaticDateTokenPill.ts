import {
  DATE_TOKEN_PATTERN,
  formatDateTokenPretty,
  isDateTokenInPast,
  parseDateToken,
} from '../../editor/noteEditor/dateToken/dateToken';
import type {CellStaticSegment} from '../../editor/noteEditor/eskerraTableV1/eskerraTableCellStaticSegments';

import {clipSegmentsToRange} from './todayHubCellStaticView';

/** Pretty reminder pill rendered in place of a raw `@date` token in read mode. */
export type TodayHubStaticPillPart = {
  kind: 'date-pill';
  from: number;
  to: number;
  /** Pretty label (e.g. `Tomorrow 12:00`), matching the CodeMirror widget. */
  label: string;
  past: boolean;
};

/** Run of styled segments rendered as plain `<span>`s. */
export type TodayHubStaticSegmentsPart = {
  kind: 'segments';
  segments: CellStaticSegment[];
};

export type TodayHubStaticLinePart =
  | TodayHubStaticSegmentsPart
  | TodayHubStaticPillPart;

/**
 * Collect reminder-pill placements on one line. Mirrors
 * `collectDateTokenRangesForLine` in `dateTokenHighlightCodemirror.ts` so read mode
 * and the non-focused CodeMirror line agree on which tokens become pills.
 */
function collectDateTokenPillsForLine(
  lineFrom: number,
  lineText: string,
  now: Date,
): TodayHubStaticPillPart[] {
  const out: TodayHubStaticPillPart[] = [];
  DATE_TOKEN_PATTERN.lastIndex = 0;
  let match = DATE_TOKEN_PATTERN.exec(lineText);
  while (match) {
    const token = match[1]!;
    const value = parseDateToken(token);
    if (value !== null) {
      const tokenStartInLine = match.index + match[0].length - token.length;
      const from = lineFrom + tokenStartInLine;
      out.push({
        kind: 'date-pill',
        from,
        to: from + token.length,
        label: formatDateTokenPretty(value, now),
        past: isDateTokenInPast(value, now),
      });
    }
    match = DATE_TOKEN_PATTERN.exec(lineText);
  }
  return out;
}

/** True when the cell contains at least one valid date token (used to gate the minute clock). */
export function cellTextHasDateTokenPill(cellText: string): boolean {
  DATE_TOKEN_PATTERN.lastIndex = 0;
  let match = DATE_TOKEN_PATTERN.exec(cellText);
  while (match) {
    if (parseDateToken(match[1]!) !== null) {
      return true;
    }
    match = DATE_TOKEN_PATTERN.exec(cellText);
  }
  return false;
}

/**
 * Split a line's styled segments into an ordered list of segment runs and reminder pills.
 * Pills replace the raw `@date` token text exactly as the CodeMirror `Decoration.replace`
 * widget does on non-focused lines; everything else stays as normal segments.
 */
export function todayHubStaticLineParts(
  lineFrom: number,
  lineText: string,
  lineSegments: readonly CellStaticSegment[],
  now: Date,
): TodayHubStaticLinePart[] {
  const pills = collectDateTokenPillsForLine(lineFrom, lineText, now);
  if (pills.length === 0) {
    return [{kind: 'segments', segments: [...lineSegments]}];
  }
  const parts: TodayHubStaticLinePart[] = [];
  const lineEnd = lineFrom + lineText.length;
  let cursor = lineFrom;
  for (const pill of pills) {
    if (cursor < pill.from) {
      parts.push({
        kind: 'segments',
        segments: clipSegmentsToRange(lineSegments, cursor, pill.from),
      });
    }
    parts.push(pill);
    cursor = pill.to;
  }
  if (cursor < lineEnd) {
    parts.push({
      kind: 'segments',
      segments: clipSegmentsToRange(lineSegments, cursor, lineEnd),
    });
  }
  return parts;
}

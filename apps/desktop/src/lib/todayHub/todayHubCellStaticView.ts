import {syntaxTree} from '@codemirror/language';
import {EditorState} from '@codemirror/state';

import {
  markdownEditorBlockLineClasses,
} from '../../editor/noteEditor/markdownEditorStyling';
import {
  buildCellStaticSegments,
  type CellStaticResolvePredicates,
  type CellStaticSegment,
} from '../../editor/noteEditor/eskerraTableV1/eskerraTableCellStaticSegments';

export type TodayHubStaticLine = {
  from: number;
  /** Line text without the line separator (CodeMirror `line.text`). */
  text: string;
  /** Full line extent including line break when present (`line.to`). */
  to: number;
  lineClassName: string;
};

export type TodayHubCellStaticViewModel = {
  hitState: EditorState;
  lines: TodayHubStaticLine[];
  segments: CellStaticSegment[];
};

/**
 * Parsed markdown for an inactive Today hub cell: block line classes (same as CodeMirror
 * `markdownBlockLineStyle`) + styled segments for inline highlights and links.
 */
export function buildTodayHubCellStaticViewModel(
  cellText: string,
  resolve: CellStaticResolvePredicates,
): TodayHubCellStaticViewModel {
  const {state: hitState, segments} = buildCellStaticSegments(cellText, resolve);
  const tree = syntaxTree(hitState);
  const lineClassMap = markdownEditorBlockLineClasses(hitState.doc, tree);
  const doc = hitState.doc;
  const lines: TodayHubStaticLine[] = [];
  for (let i = 1; i <= doc.lines; i += 1) {
    const line = doc.line(i);
    const set = lineClassMap.get(line.from);
    const extra = set && set.size > 0 ? [...set].sort().join(' ') : '';
    const lineClassName = extra ? `cm-line ${extra}` : 'cm-line';
    lines.push({
      from: line.from,
      text: line.text,
      to: line.to,
      lineClassName,
    });
  }
  return {hitState, lines, segments};
}

/** Clip highlight/link segments to the visible line slice `[rangeFrom, rangeTo)` (exclusive end). */
export function clipSegmentsToRange(
  segments: readonly CellStaticSegment[],
  rangeFrom: number,
  rangeTo: number,
): CellStaticSegment[] {
  if (rangeFrom >= rangeTo) {
    return [];
  }
  const out: CellStaticSegment[] = [];
  for (const seg of segments) {
    const a = Math.max(seg.from, rangeFrom);
    const b = Math.min(seg.to, rangeTo);
    if (a < b) {
      out.push({from: a, to: b, className: seg.className});
    }
  }
  return out;
}

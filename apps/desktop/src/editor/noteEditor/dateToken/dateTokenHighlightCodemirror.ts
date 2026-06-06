import {type Extension, type Range} from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';

import {DATE_TOKEN_PATTERN, parseDateToken} from './dateToken';

import './dateTokenHighlight.css';

/** Mark class for valid date tokens in the capture editor. */
export const CM_DATE_TOKEN_CLASS = 'cm-date-token';

const dateTokenMark = Decoration.mark({
  class: CM_DATE_TOKEN_CLASS,
  attributes: {'data-date-token': ''},
});

function collectDateTokenRangesForLine(
  doc: EditorView['state']['doc'],
  lineNumber: number,
): Range<Decoration>[] {
  const ranges: Range<Decoration>[] = [];
  const line = doc.line(lineNumber);
  const text = line.text;
  DATE_TOKEN_PATTERN.lastIndex = 0;
  let match = DATE_TOKEN_PATTERN.exec(text);
  while (match) {
    const token = match[1]!;
    if (parseDateToken(token) !== null) {
      const tokenStartInLine =
        match.index + match[0].length - token.length;
      const from = line.from + tokenStartInLine;
      const to = from + token.length;
      ranges.push(dateTokenMark.range(from, to));
    }
    match = DATE_TOKEN_PATTERN.exec(text);
  }
  return ranges;
}

/** Scans one document line for valid date-token chip decorations. */
export function buildDateTokenDecorationsForLine(
  doc: EditorView['state']['doc'],
  lineNumber: number,
): Range<Decoration>[] {
  return collectDateTokenRangesForLine(doc, lineNumber);
}

/** Scans a document line span for valid date-token chip decorations. */
export function buildDateTokenDecorationsForLineRange(
  doc: EditorView['state']['doc'],
  from: number,
  to: number,
): Range<Decoration>[] {
  const startLine = doc.lineAt(from).number;
  const endLine = doc.lineAt(to).number;
  const ranges: Range<Decoration>[] = [];
  for (let lineNumber = startLine; lineNumber <= endLine; lineNumber++) {
    ranges.push(...collectDateTokenRangesForLine(doc, lineNumber));
  }
  return ranges;
}

/** Builds date-token chip decorations; exported for tests. */
export function buildDateTokenDecorations(view: EditorView): DecorationSet {
  const ranges = buildDateTokenDecorationsForLineRange(
    view.state.doc,
    0,
    view.state.doc.length,
  );
  return ranges.length ? Decoration.set(ranges, true) : Decoration.none;
}

/** Incrementally refreshes chip decorations after a document change. */
export function updateDateTokenDecorationsForDocChange(
  decorations: DecorationSet,
  update: ViewUpdate,
): DecorationSet {
  let next = decorations.map(update.changes);
  update.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
    const doc = update.state.doc;
    const lineFrom = doc.lineAt(fromB).from;
    const lineTo = doc.lineAt(toB).to;
    const fresh = buildDateTokenDecorationsForLineRange(doc, lineFrom, lineTo);
    next = next.update({
      filterFrom: lineFrom,
      filterTo: lineTo,
      filter: () => false,
      add: fresh,
    });
  });
  return next;
}

/** Highlights valid `@YYYY-MM-DD` / `@YYYY-MM-DD_HHMM` tokens as editable chips. */
export function dateTokenHighlightExtensions(): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildDateTokenDecorations(view);
      }

      update(update: ViewUpdate) {
        if (update.docChanged) {
          this.decorations = updateDateTokenDecorationsForDocChange(
            this.decorations,
            update,
          );
        }
      }
    },
    {decorations: instance => instance.decorations},
  );

  return plugin;
}

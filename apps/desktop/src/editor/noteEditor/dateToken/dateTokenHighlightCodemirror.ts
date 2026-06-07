import {type Extension, type Range} from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';

import {computeMarkerFocusLineStarts} from '../markdownMarkerFocusLine';

import {
  DATE_TOKEN_PATTERN,
  formatDateTokenPretty,
  isDateTokenInPast,
  parseDateToken,
} from './dateToken';

import './dateTokenHighlight.css';

/** Mark class for date tokens shown raw on the focused line. */
export const CM_DATE_TOKEN_CLASS = 'cm-date-token';

/** Class for the pretty pill that replaces a token on non-focused lines. */
export const CM_DATE_TOKEN_PILL_CLASS = 'cm-date-token-pill';

/** Modifier class for pills whose moment has already passed. */
export const CM_DATE_TOKEN_PILL_PAST_CLASS = 'cm-date-token-pill--past';

const dateTokenMark = Decoration.mark({
  class: CM_DATE_TOKEN_CLASS,
  attributes: {'data-date-token': ''},
});

/** Pretty pill rendered in place of the raw token text on non-focused lines. */
class DateTokenPillWidget extends WidgetType {
  readonly label: string;
  readonly past: boolean;

  constructor(label: string, past: boolean) {
    super();
    this.label = label;
    this.past = past;
  }

  eq(other: DateTokenPillWidget): boolean {
    return other.label === this.label && other.past === this.past;
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = this.past
      ? `${CM_DATE_TOKEN_PILL_CLASS} ${CM_DATE_TOKEN_PILL_PAST_CLASS}`
      : CM_DATE_TOKEN_PILL_CLASS;
    span.setAttribute('data-date-token', '');
    span.textContent = `${this.past ? '☑️' : '🔔'} ${this.label}`;
    return span;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

function collectDateTokenRangesForLine(
  doc: EditorView['state']['doc'],
  lineNumber: number,
  isFocusedLine: boolean,
  now: Date,
): Range<Decoration>[] {
  const ranges: Range<Decoration>[] = [];
  const line = doc.line(lineNumber);
  const text = line.text;
  DATE_TOKEN_PATTERN.lastIndex = 0;
  let match = DATE_TOKEN_PATTERN.exec(text);
  while (match) {
    const token = match[1]!;
    const value = parseDateToken(token);
    if (value !== null) {
      const tokenStartInLine = match.index + match[0].length - token.length;
      const from = line.from + tokenStartInLine;
      const to = from + token.length;
      if (isFocusedLine) {
        ranges.push(dateTokenMark.range(from, to));
      } else {
        const widget = new DateTokenPillWidget(
          formatDateTokenPretty(value, now),
          isDateTokenInPast(value, now),
        );
        ranges.push(Decoration.replace({widget}).range(from, to));
      }
    }
    match = DATE_TOKEN_PATTERN.exec(text);
  }
  return ranges;
}

/** Line `from` offsets for lines that should show the raw editable chip. */
export function computeDateTokenFocusLineStarts(view: EditorView): Set<number> {
  if (!view.hasFocus) {
    return new Set<number>();
  }
  return new Set(
    computeMarkerFocusLineStarts(view.state.doc, view.state.selection),
  );
}

function focusLineStartsEqual(
  left: Set<number>,
  right: Set<number>,
): boolean {
  if (left.size !== right.size) {
    return false;
  }
  for (const start of left) {
    if (!right.has(start)) {
      return false;
    }
  }
  return true;
}

/** Scans one document line for date-token decorations. */
export function buildDateTokenDecorationsForLine(
  doc: EditorView['state']['doc'],
  lineNumber: number,
  focusLineStarts: Set<number>,
  now: Date = new Date(),
): Range<Decoration>[] {
  const isFocusedLine = focusLineStarts.has(doc.line(lineNumber).from);
  return collectDateTokenRangesForLine(doc, lineNumber, isFocusedLine, now);
}

/** Scans a document line span for date-token decorations. */
export function buildDateTokenDecorationsForLineRange(
  doc: EditorView['state']['doc'],
  from: number,
  to: number,
  focusLineStarts: Set<number>,
  now: Date = new Date(),
): Range<Decoration>[] {
  const startLine = doc.lineAt(from).number;
  const endLine = doc.lineAt(to).number;
  const ranges: Range<Decoration>[] = [];
  for (let lineNumber = startLine; lineNumber <= endLine; lineNumber++) {
    ranges.push(
      ...buildDateTokenDecorationsForLine(
        doc,
        lineNumber,
        focusLineStarts,
        now,
      ),
    );
  }
  return ranges;
}

/**
 * Builds date-token decorations: an editable monospace chip on the focused
 * line, a pretty `🔔` pill everywhere else. Exported for tests.
 */
export function buildDateTokenDecorations(
  view: EditorView,
  now: Date = new Date(),
): DecorationSet {
  const {doc} = view.state;
  const focusLineStarts = computeDateTokenFocusLineStarts(view);
  const ranges = buildDateTokenDecorationsForLineRange(
    doc,
    0,
    doc.length,
    focusLineStarts,
    now,
  );
  return ranges.length ? Decoration.set(ranges, true) : Decoration.none;
}

/** Incrementally refreshes chip/pill decorations after a document change. */
export function updateDateTokenDecorationsForDocChange(
  decorations: DecorationSet,
  update: ViewUpdate,
  focusLineStarts: Set<number>,
  now: Date = new Date(),
): DecorationSet {
  let next = decorations.map(update.changes);
  update.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
    const doc = update.state.doc;
    const lineFrom = doc.lineAt(fromB).from;
    const lineTo = doc.lineAt(toB).to;
    const fresh = buildDateTokenDecorationsForLineRange(
      doc,
      lineFrom,
      lineTo,
      focusLineStarts,
      now,
    );
    next = next.update({
      filterFrom: lineFrom,
      filterTo: lineTo,
      filter: () => false,
      add: fresh,
    });
  });
  return next;
}

/** Refreshes chip/pill decorations on lines whose focus state changed. */
export function updateDateTokenDecorationsForFocusChange(
  decorations: DecorationSet,
  view: EditorView,
  previousFocusLineStarts: Set<number>,
  nextFocusLineStarts: Set<number>,
  now: Date = new Date(),
): DecorationSet {
  const affectedLineStarts = new Set<number>();
  for (const start of previousFocusLineStarts) {
    if (!nextFocusLineStarts.has(start)) {
      affectedLineStarts.add(start);
    }
  }
  for (const start of nextFocusLineStarts) {
    if (!previousFocusLineStarts.has(start)) {
      affectedLineStarts.add(start);
    }
  }
  if (affectedLineStarts.size === 0) {
    return decorations;
  }

  const {doc} = view.state;
  let next = decorations;
  for (const lineStart of affectedLineStarts) {
    const line = doc.lineAt(lineStart);
    const fresh = buildDateTokenDecorationsForLine(
      doc,
      line.number,
      nextFocusLineStarts,
      now,
    );
    next = next.update({
      filterFrom: line.from,
      filterTo: line.to,
      filter: () => false,
      add: fresh,
    });
  }
  return next;
}

/** Highlights valid `@YYYY-MM-DD` / `@YYYY-MM-DD_HHMM` tokens as chips or pills. */
export function dateTokenHighlightExtensions(): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      focusLineStarts: Set<number>;

      constructor(view: EditorView) {
        this.focusLineStarts = computeDateTokenFocusLineStarts(view);
        this.decorations = buildDateTokenDecorations(view);
      }

      update(update: ViewUpdate) {
        const nextFocusLineStarts = computeDateTokenFocusLineStarts(update.view);

        if (update.docChanged) {
          this.decorations = updateDateTokenDecorationsForDocChange(
            this.decorations,
            update,
            nextFocusLineStarts,
          );
          this.focusLineStarts = nextFocusLineStarts;
          return;
        }

        if (
          (update.selectionSet || update.focusChanged)
          && !focusLineStartsEqual(this.focusLineStarts, nextFocusLineStarts)
        ) {
          this.decorations = updateDateTokenDecorationsForFocusChange(
            this.decorations,
            update.view,
            this.focusLineStarts,
            nextFocusLineStarts,
          );
          this.focusLineStarts = nextFocusLineStarts;
        }
      }
    },
    {decorations: instance => instance.decorations},
  );

  return plugin;
}

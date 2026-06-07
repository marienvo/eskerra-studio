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

import {DATE_TOKEN_PATTERN, formatDateTokenPretty, parseDateToken} from './dateToken';

import './dateTokenHighlight.css';

/** Mark class for date tokens shown raw on the focused line. */
export const CM_DATE_TOKEN_CLASS = 'cm-date-token';

/** Class for the pretty pill that replaces a token on non-focused lines. */
export const CM_DATE_TOKEN_PILL_CLASS = 'cm-date-token-pill';

const dateTokenMark = Decoration.mark({
  class: CM_DATE_TOKEN_CLASS,
  attributes: {'data-date-token': ''},
});

/** Pretty `🔔 <label>` pill rendered in place of the raw token text. */
class DateTokenPillWidget extends WidgetType {
  readonly label: string;

  constructor(label: string) {
    super();
    this.label = label;
  }

  eq(other: DateTokenPillWidget): boolean {
    return other.label === this.label;
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = CM_DATE_TOKEN_PILL_CLASS;
    span.setAttribute('data-date-token', '');
    span.textContent = `🔔 ${this.label}`;
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
        const widget = new DateTokenPillWidget(formatDateTokenPretty(value, now));
        ranges.push(Decoration.replace({widget}).range(from, to));
      }
    }
    match = DATE_TOKEN_PATTERN.exec(text);
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
  const {doc, selection} = view.state;
  const focusLineStarts = view.hasFocus
    ? new Set(computeMarkerFocusLineStarts(doc, selection))
    : new Set<number>();
  const ranges: Range<Decoration>[] = [];
  for (let lineNumber = 1; lineNumber <= doc.lines; lineNumber++) {
    const isFocusedLine = focusLineStarts.has(doc.line(lineNumber).from);
    ranges.push(
      ...collectDateTokenRangesForLine(doc, lineNumber, isFocusedLine, now),
    );
  }
  return ranges.length ? Decoration.set(ranges, true) : Decoration.none;
}

/** Highlights valid `@YYYY-MM-DD` / `@YYYY-MM-DD_HHMM` tokens as chips or pills. */
export function dateTokenHighlightExtensions(): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildDateTokenDecorations(view);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.selectionSet || update.focusChanged) {
          this.decorations = buildDateTokenDecorations(update.view);
        }
      }
    },
    {decorations: instance => instance.decorations},
  );

  return plugin;
}

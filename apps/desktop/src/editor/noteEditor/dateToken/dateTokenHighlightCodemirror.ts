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

/** Builds date-token chip decorations; exported for tests. */
export function buildDateTokenDecorations(view: EditorView): DecorationSet {
  const {doc} = view.state;
  const ranges: Range<Decoration>[] = [];

  for (let lineNumber = 1; lineNumber <= doc.lines; lineNumber++) {
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
        ranges.push(
          Decoration.mark({
            class: CM_DATE_TOKEN_CLASS,
            attributes: {'data-date-token': ''},
          }).range(from, to),
        );
      }
      match = DATE_TOKEN_PATTERN.exec(text);
    }
  }

  return ranges.length ? Decoration.set(ranges, true) : Decoration.none;
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
          this.decorations = buildDateTokenDecorations(update.view);
        }
      }
    },
    {decorations: instance => instance.decorations},
  );

  return plugin;
}

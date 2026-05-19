import {EditorSelection, Prec, type Extension} from '@codemirror/state';
import {type EditorView, keymap} from '@codemirror/view';

import {MARKDOWN_CASE_TOGGLE_USER_EVENT} from './markdownEditorUserEvents';

function toggleSelectedTextCase(text: string): string {
  const upper = text.toUpperCase();
  const lower = text.toLowerCase();
  return text === upper && text !== lower ? lower : upper;
}

export function runMarkdownCaseToggle(view: EditorView): boolean {
  const {state} = view;
  const replacements = state.selection.ranges
    .filter(range => !range.empty)
    .map(range => ({
      from: range.from,
      to: range.to,
      insert: toggleSelectedTextCase(state.doc.sliceString(range.from, range.to)),
    }));

  if (!replacements.length) {
    return false;
  }

  let offset = 0;
  const ranges = state.selection.ranges.map(range => {
    const replacement = replacements.find(
      r => r.from === range.from && r.to === range.to,
    );
    const mappedFrom = range.from + offset;
    if (!replacement) {
      return range.empty
        ? EditorSelection.cursor(mappedFrom)
        : EditorSelection.range(range.anchor + offset, range.head + offset);
    }
    const insertedLength = replacement.insert.length;
    const anchorAtStart = range.anchor <= range.head;
    const mappedRange = anchorAtStart
      ? EditorSelection.range(mappedFrom, mappedFrom + insertedLength)
      : EditorSelection.range(mappedFrom + insertedLength, mappedFrom);
    offset += insertedLength - (range.to - range.from);
    return mappedRange;
  });

  view.dispatch({
    changes: replacements,
    selection: EditorSelection.create(ranges, state.selection.mainIndex),
    scrollIntoView: true,
    userEvent: MARKDOWN_CASE_TOGGLE_USER_EVENT,
  });
  return true;
}

export function markdownCaseToggleKeymap(): Extension {
  return Prec.high(
    keymap.of([
      {key: 'Alt-c', run: runMarkdownCaseToggle},
    ]),
  );
}

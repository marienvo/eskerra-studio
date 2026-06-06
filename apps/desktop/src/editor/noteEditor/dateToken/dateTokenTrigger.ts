import {EditorState, type Extension} from '@codemirror/state';
import {EditorView, type Rect} from '@codemirror/view';

import {DATE_TOKEN_PREFIX_PATTERN, type DateTokenValue} from './dateToken';

export type DateTokenPickerOpenRequest = {
  readonly view: EditorView;
  readonly tokenFrom: number;
  readonly tokenTo: number;
  readonly initialValue?: DateTokenValue;
  readonly anchorRect: Rect | null;
};

export type DateTokenPickerOpenHandler = (
  request: DateTokenPickerOpenRequest,
) => void;

export function isDateTokenAtTrigger(
  state: EditorState,
  from: number,
  to: number,
  text: string,
): boolean {
  if (text !== '@' || from !== to) {
    return false;
  }

  const line = state.doc.lineAt(from);
  const prefixWithAt = `${line.text.slice(0, from - line.from)}@`;
  return DATE_TOKEN_PREFIX_PATTERN.test(prefixWithAt);
}

function coordsAtDateTokenTrigger(view: EditorView, pos: number): Rect | null {
  try {
    return view.coordsAtPos(pos, 1);
  } catch {
    return null;
  }
}

export function dateTokenTriggerExtension(
  onOpenDateTokenPicker: () => DateTokenPickerOpenHandler | undefined,
): Extension {
  return EditorView.inputHandler.of((view, from, to, text, insert) => {
    const openPicker = onOpenDateTokenPicker();
    if (!openPicker || !isDateTokenAtTrigger(view.state, from, to, text)) {
      return false;
    }

    view.dispatch(insert());

    const tokenTo = from + text.length;
    if (view.state.sliceDoc(from, tokenTo) !== text) {
      return true;
    }

    openPicker({
      view,
      tokenFrom: from,
      tokenTo,
      anchorRect: coordsAtDateTokenTrigger(view, from),
    });
    return true;
  });
}

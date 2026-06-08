import {type EditorState} from '@codemirror/state';
import {EditorView, type Rect} from '@codemirror/view';

import {
  collectDateTokenSpansInLine,
  parseDateTokenSpan,
  type DateTokenValue,
} from './dateToken';
import type {DateTokenPickerOpenHandler} from './dateTokenTrigger';

export type DateTokenAtPosition = {
  readonly from: number;
  readonly to: number;
  readonly text: string;
  readonly value: DateTokenValue;
};

function hasDateTokenMarkTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest('[data-date-token]') !== null
  );
}

export function dateTokenAtPosition(
  state: EditorState,
  pos: number,
  options: {includeBoundaries?: boolean} = {},
): DateTokenAtPosition | null {
  const line = state.doc.lineAt(Math.max(0, Math.min(pos, state.doc.length)));
  for (const {token, tokenStartInLine} of collectDateTokenSpansInLine(
    line.text,
  )) {
    const value = parseDateTokenSpan(token);
    if (!value) {
      continue;
    }
    const from = line.from + tokenStartInLine;
    const to = from + token.length;
    const inside = options.includeBoundaries
      ? pos >= from && pos <= to
      : pos > from && pos < to;
    if (inside) {
      return {from, to, text: token, value};
    }
  }
  return null;
}

function coordsAtDateToken(view: EditorView, from: number, to: number): Rect | null {
  try {
    return view.coordsAtPos(from, 1) ?? view.coordsAtPos(to, -1);
  } catch {
    return null;
  }
}

export function openDateTokenPickerAtClickPosition(
  view: EditorView,
  pos: number,
  event: MouseEvent,
  openPicker: DateTokenPickerOpenHandler | undefined,
  options: {forceIncludeBoundaries?: boolean} = {},
): boolean {
  if (!openPicker) {
    return false;
  }

  const hit = dateTokenAtPosition(view.state, pos, {
    includeBoundaries:
      options.forceIncludeBoundaries === true ||
      hasDateTokenMarkTarget(event.target),
  });
  if (!hit) {
    return false;
  }

  openPicker({
    view,
    tokenFrom: hit.from,
    tokenTo: hit.to,
    initialValue: hit.value,
    anchorRect: coordsAtDateToken(view, hit.from, hit.to),
  });
  return true;
}

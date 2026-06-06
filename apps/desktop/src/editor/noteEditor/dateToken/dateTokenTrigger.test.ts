import {EditorState, type Transaction} from '@codemirror/state';
import {EditorView} from '@codemirror/view';
import {afterEach, describe, expect, it, vi} from 'vitest';

import {
  dateTokenTriggerExtension,
  isDateTokenAtTrigger,
  type DateTokenPickerOpenRequest,
} from './dateTokenTrigger';

function dispatchInput(
  view: EditorView,
  from: number,
  text: string,
): boolean {
  const insert = (): Transaction =>
    view.state.update({
      changes: {from, to: from, insert: text},
      selection: {anchor: from + text.length},
    });
  const handlers = view.state.facet(EditorView.inputHandler);
  const handled = handlers.some(handler => handler(view, from, from, text, insert));
  if (!handled) {
    view.dispatch(insert());
  }
  return handled;
}

function createView(
  doc: string,
  onOpen: (request: DateTokenPickerOpenRequest) => void,
): EditorView {
  const parent = document.createElement('div');
  document.body.append(parent);
  return new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [dateTokenTriggerExtension(() => onOpen)],
    }),
  });
}

describe('dateTokenTrigger', () => {
  let view: EditorView | null = null;

  afterEach(() => {
    view?.destroy();
    view = null;
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('detects @ at start or after whitespace only', () => {
    const state = EditorState.create({doc: 'foo bar'});
    const multilineState = EditorState.create({doc: 'foo\nbar'});

    expect(isDateTokenAtTrigger(state, 0, 0, '@')).toBe(true);
    expect(isDateTokenAtTrigger(state, 4, 4, '@')).toBe(true);
    expect(isDateTokenAtTrigger(multilineState, 4, 4, '@')).toBe(true);
    expect(isDateTokenAtTrigger(state, 3, 3, '@')).toBe(false);
    expect(isDateTokenAtTrigger(state, 4, 5, '@')).toBe(false);
    expect(isDateTokenAtTrigger(state, 4, 4, 'x')).toBe(false);
  });

  it('fires after inserting @ at the start of a line', () => {
    const onOpen = vi.fn<(request: DateTokenPickerOpenRequest) => void>();
    view = createView('', onOpen);
    const rect = {
      bottom: 12,
      height: 12,
      left: 3,
      right: 7,
      top: 0,
      width: 4,
      x: 3,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect;
    vi.spyOn(view, 'coordsAtPos').mockReturnValue(rect);

    expect(dispatchInput(view, 0, '@')).toBe(true);

    expect(view.state.doc.toString()).toBe('@');
    expect(onOpen).toHaveBeenCalledWith({
      view,
      tokenFrom: 0,
      tokenTo: 1,
      anchorRect: rect,
    });
  });

  it('fires after inserting @ after whitespace', () => {
    const onOpen = vi.fn<(request: DateTokenPickerOpenRequest) => void>();
    view = createView('Meet ', onOpen);

    expect(dispatchInput(view, 5, '@')).toBe(true);

    expect(view.state.doc.toString()).toBe('Meet @');
    expect(onOpen).toHaveBeenCalledWith(
      expect.objectContaining({
        tokenFrom: 5,
        tokenTo: 6,
      }),
    );
  });

  it('does not fire inside a word or email address', () => {
    const onOpen = vi.fn<(request: DateTokenPickerOpenRequest) => void>();
    view = createView('foo', onOpen);

    expect(dispatchInput(view, 3, '@')).toBe(false);

    expect(view.state.doc.toString()).toBe('foo@');
    expect(onOpen).not.toHaveBeenCalled();
  });
});

import {EditorState} from '@codemirror/state';
import {EditorView} from '@codemirror/view';
import {afterEach, describe, expect, it, vi} from 'vitest';

import {
  dateTokenAtPosition,
  openDateTokenPickerAtClickPosition,
} from './dateTokenClick';
import type {DateTokenPickerOpenRequest} from './dateTokenTrigger';

function createView(doc: string): EditorView {
  const parent = document.createElement('div');
  document.body.append(parent);
  return new EditorView({
    parent,
    state: EditorState.create({doc}),
  });
}

describe('dateTokenClick', () => {
  let view: EditorView | null = null;

  afterEach(() => {
    view?.destroy();
    view = null;
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('resolves the full token range and parsed value at a clicked position', () => {
    const doc = 'Due @2026-12-28_2352 please';
    const from = doc.indexOf('@2026-12-28_2352');
    view = createView(doc);

    expect(dateTokenAtPosition(view.state, doc.indexOf('12-28'))).toEqual({
      from,
      to: from + '@2026-12-28_2352'.length,
      text: '@2026-12-28_2352',
      value: {year: 2026, month: 12, day: 28, hour: 23, minute: 52},
    });
  });

  it('opens the picker with the clicked token range and initial value', () => {
    const doc = 'Due @2026-12-28 please';
    const from = doc.indexOf('@2026-12-28');
    view = createView(doc);
    const rect = {left: 10, right: 40, top: 5, bottom: 25};
    vi.spyOn(view, 'coordsAtPos').mockReturnValue(rect);
    const onOpen = vi.fn<(request: DateTokenPickerOpenRequest) => void>();

    expect(
      openDateTokenPickerAtClickPosition(
        view,
        doc.indexOf('12-28'),
        new MouseEvent('click'),
        onOpen,
      ),
    ).toBe(true);

    expect(onOpen).toHaveBeenCalledWith({
      view,
      tokenFrom: from,
      tokenTo: from + '@2026-12-28'.length,
      initialValue: {year: 2026, month: 12, day: 28},
      anchorRect: rect,
    });
  });

  it('does nothing outside a valid date token', () => {
    view = createView('Due @2026-13-99 and tomorrow');
    const onOpen = vi.fn<(request: DateTokenPickerOpenRequest) => void>();

    expect(
      openDateTokenPickerAtClickPosition(
        view,
        view.state.doc.toString().indexOf('tomorrow'),
        new MouseEvent('click'),
        onOpen,
      ),
    ).toBe(false);

    expect(onOpen).not.toHaveBeenCalled();
  });
});

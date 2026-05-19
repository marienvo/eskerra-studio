import {EditorSelection, EditorState} from '@codemirror/state';
import {EditorView, runScopeHandlers} from '@codemirror/view';
import {afterEach, describe, expect, it} from 'vitest';

import {markdownCaseToggleKeymap, runMarkdownCaseToggle} from './markdownCaseToggle';

function altCKeydown(view: EditorView): boolean {
  return runScopeHandlers(
    view,
    new KeyboardEvent('keydown', {
      key: 'c',
      code: 'KeyC',
      altKey: true,
      bubbles: true,
    }),
    'editor',
  );
}

describe('markdownCaseToggle', () => {
  let view: EditorView | null = null;

  afterEach(() => {
    view?.destroy();
    view = null;
    document.body.replaceChildren();
  });

  function createView(doc: string, selection: EditorSelection): EditorView {
    const parent = document.createElement('div');
    document.body.append(parent);
    return new EditorView({
      parent,
      state: EditorState.create({
        doc,
        selection,
        extensions: [
          EditorState.allowMultipleSelections.of(true),
          markdownCaseToggleKeymap(),
        ],
      }),
    });
  }

  it('uppercases a lowercase selection with Alt+C', () => {
    view = createView('alpha beta', EditorSelection.range(0, 5));

    expect(altCKeydown(view)).toBe(true);

    expect(view.state.doc.toString()).toBe('ALPHA beta');
    expect(view.state.selection.main.from).toBe(0);
    expect(view.state.selection.main.to).toBe(5);
  });

  it('lowercases an uppercase selection with Alt+C', () => {
    view = createView('ALPHA beta', EditorSelection.range(0, 5));

    expect(altCKeydown(view)).toBe(true);

    expect(view.state.doc.toString()).toBe('alpha beta');
    expect(view.state.selection.main.from).toBe(0);
    expect(view.state.selection.main.to).toBe(5);
  });

  it('updates every non-empty selection range', () => {
    view = createView(
      'one TWO three',
      EditorSelection.create([
        EditorSelection.range(0, 3),
        EditorSelection.range(4, 7),
      ]),
    );

    expect(runMarkdownCaseToggle(view)).toBe(true);

    expect(view.state.doc.toString()).toBe('ONE two three');
    expect(view.state.selection.ranges.map(r => [r.from, r.to])).toEqual([
      [0, 3],
      [4, 7],
    ]);
  });

  it('falls through without a selection', () => {
    view = createView('alpha', EditorSelection.cursor(2));

    expect(altCKeydown(view)).toBe(false);
    expect(runMarkdownCaseToggle(view)).toBe(false);
    expect(view.state.doc.toString()).toBe('alpha');
  });
});

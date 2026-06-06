import {EditorState} from '@codemirror/state';
import {EditorView} from '@codemirror/view';
import {afterEach, describe, expect, it} from 'vitest';

import {
  buildDateTokenDecorations,
  CM_DATE_TOKEN_CLASS,
} from './dateTokenHighlightCodemirror';

type MarkInterval = {
  readonly from: number;
  readonly to: number;
  readonly class: string | undefined;
  readonly attributes: Record<string, string> | undefined;
};

function collectMarkIntervals(view: EditorView): MarkInterval[] {
  const set = buildDateTokenDecorations(view);
  const out: MarkInterval[] = [];
  set.between(0, view.state.doc.length, (from, to, deco) => {
    const spec =
      typeof deco.spec === 'object' && deco.spec
        ? (deco.spec as {
            class?: string;
            attributes?: Record<string, string>;
          })
        : {};
    out.push({
      from,
      to,
      class: spec.class,
      attributes: spec.attributes,
    });
  });
  return out;
}

describe('dateTokenHighlightCodemirror', () => {
  let view: EditorView | null = null;

  afterEach(() => {
    view?.destroy();
    view = null;
    document.body.replaceChildren();
  });

  it('decorates valid date tokens at word boundaries', () => {
    const doc = 'Due @2026-06-06_1200 tomorrow\n@2026-12-28 end';
    const parent = document.createElement('div');
    document.body.append(parent);
    const state = EditorState.create({doc});
    view = new EditorView({state, parent});

    const intervals = collectMarkIntervals(view);
    const withTimeFrom = doc.indexOf('@2026-06-06_1200');
    const dateOnlyFrom = doc.indexOf('@2026-12-28');

    expect(intervals).toEqual([
      {
        from: withTimeFrom,
        to: withTimeFrom + '@2026-06-06_1200'.length,
        class: CM_DATE_TOKEN_CLASS,
        attributes: {'data-date-token': ''},
      },
      {
        from: dateOnlyFrom,
        to: dateOnlyFrom + '@2026-12-28'.length,
        class: CM_DATE_TOKEN_CLASS,
        attributes: {'data-date-token': ''},
      },
    ]);
  });

  it('does not decorate invalid tokens', () => {
    const doc = 'bad @2026-13-99 and @2026-02-29';
    const parent = document.createElement('div');
    document.body.append(parent);
    const state = EditorState.create({doc});
    view = new EditorView({state, parent});

    expect(collectMarkIntervals(view)).toEqual([]);
  });

  it('does not decorate tokens without a word boundary', () => {
    const doc = 'foo@2026-06-06';
    const parent = document.createElement('div');
    document.body.append(parent);
    const state = EditorState.create({doc});
    view = new EditorView({state, parent});

    expect(collectMarkIntervals(view)).toEqual([]);
  });
});

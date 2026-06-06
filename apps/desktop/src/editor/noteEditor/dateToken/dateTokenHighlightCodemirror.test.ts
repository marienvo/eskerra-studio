import {EditorState} from '@codemirror/state';
import {EditorView, ViewPlugin, type ViewUpdate} from '@codemirror/view';
import {afterEach, describe, expect, it} from 'vitest';

import {
  buildDateTokenDecorations,
  CM_DATE_TOKEN_CLASS,
  dateTokenHighlightExtensions,
  updateDateTokenDecorationsForDocChange,
} from './dateTokenHighlightCodemirror';

type MarkInterval = {
  readonly from: number;
  readonly to: number;
  readonly class: string | undefined;
  readonly attributes: Record<string, string> | undefined;
};

function collectMarkIntervalsFromSet(
  view: EditorView,
  set: ReturnType<typeof buildDateTokenDecorations>,
): MarkInterval[] {
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

function collectMarkIntervals(view: EditorView): MarkInterval[] {
  return collectMarkIntervalsFromSet(view, buildDateTokenDecorations(view));
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

  it('incrementally updates decorations to match a full rescan after a line edit', () => {
    const initialDoc = 'Due @2026-06-06 tomorrow\n@2026-12-28 end';
    const parent = document.createElement('div');
    document.body.append(parent);
    let lastDocChange: ViewUpdate | null = null;
    const captureUpdate = ViewPlugin.fromClass(
      class {
        update(update: ViewUpdate) {
          if (update.docChanged) {
            lastDocChange = update;
          }
        }
      },
    );
    const state = EditorState.create({
      doc: initialDoc,
      extensions: [dateTokenHighlightExtensions(), captureUpdate],
    });
    view = new EditorView({state, parent});

    const beforeDecorations = buildDateTokenDecorations(view);
    const line1End = initialDoc.indexOf('\n');

    view.dispatch({
      changes: {from: 0, to: line1End, insert: 'Meet @2026-12-15 today'},
    });

    if (!lastDocChange) {
      throw new Error('Expected a captured document change update');
    }

    const incremental = updateDateTokenDecorationsForDocChange(
      beforeDecorations,
      lastDocChange,
    );
    const fullRescan = buildDateTokenDecorations(view);

    expect(collectMarkIntervalsFromSet(view, incremental)).toEqual(
      collectMarkIntervalsFromSet(view, fullRescan),
    );
    const docText = view.state.doc.toString();
    const dec15From = docText.indexOf('@2026-12-15');
    const dec28From = docText.indexOf('@2026-12-28');
    expect(collectMarkIntervalsFromSet(view, incremental)).toEqual([
      {
        from: dec15From,
        to: dec15From + '@2026-12-15'.length,
        class: CM_DATE_TOKEN_CLASS,
        attributes: {'data-date-token': ''},
      },
      {
        from: dec28From,
        to: dec28From + '@2026-12-28'.length,
        class: CM_DATE_TOKEN_CLASS,
        attributes: {'data-date-token': ''},
      },
    ]);
  });
});

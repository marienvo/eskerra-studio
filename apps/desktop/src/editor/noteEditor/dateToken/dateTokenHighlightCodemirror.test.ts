import {EditorSelection, EditorState} from '@codemirror/state';
import {EditorView} from '@codemirror/view';
import {afterEach, describe, expect, it, vi} from 'vitest';

import {
  buildDateTokenDecorations,
  CM_DATE_TOKEN_CLASS,
  CM_DATE_TOKEN_PILL_CLASS,
} from './dateTokenHighlightCodemirror';

type DecoInterval = {
  readonly from: number;
  readonly to: number;
  readonly kind: 'mark' | 'replace';
  readonly class: string | undefined;
  readonly pillText: string | undefined;
};

function collectIntervals(
  view: EditorView,
  set: ReturnType<typeof buildDateTokenDecorations>,
): DecoInterval[] {
  const out: DecoInterval[] = [];
  set.between(0, view.state.doc.length, (from, to, deco) => {
    const spec =
      typeof deco.spec === 'object' && deco.spec
        ? (deco.spec as {
            class?: string;
            widget?: {toDOM: () => HTMLElement};
          })
        : {};
    const widget = spec.widget;
    out.push({
      from,
      to,
      kind: widget ? 'replace' : 'mark',
      class: spec.class,
      pillText: widget ? (widget.toDOM().textContent ?? undefined) : undefined,
    });
  });
  return out;
}

// 2026-06-06 is a Saturday; tokens far in the future render as absolute pills.
const NOW = new Date(2026, 5, 6, 12, 0);

function mountView(doc: string): EditorView {
  const parent = document.createElement('div');
  document.body.append(parent);
  return new EditorView({state: EditorState.create({doc}), parent});
}

describe('dateTokenHighlightCodemirror', () => {
  let view: EditorView | null = null;

  afterEach(() => {
    view?.destroy();
    view = null;
    document.body.replaceChildren();
  });

  it('renders pretty pills for valid tokens when no line is focused', () => {
    const doc = 'Due @2026-06-06_1200 tomorrow\n@2026-12-28 end';
    view = mountView(doc);
    vi.spyOn(view, 'hasFocus', 'get').mockReturnValue(false);

    const intervals = collectIntervals(view, buildDateTokenDecorations(view, NOW));
    const withTimeFrom = doc.indexOf('@2026-06-06_1200');
    const dateOnlyFrom = doc.indexOf('@2026-12-28');

    expect(intervals).toEqual([
      {
        from: withTimeFrom,
        to: withTimeFrom + '@2026-06-06_1200'.length,
        kind: 'replace',
        class: undefined,
        pillText: '🔔 Today at 12:00',
      },
      {
        from: dateOnlyFrom,
        to: dateOnlyFrom + '@2026-12-28'.length,
        kind: 'replace',
        class: undefined,
        pillText: '🔔 28 Dec',
      },
    ]);
  });

  it('shows the raw editable chip on the focused line, pills elsewhere', () => {
    const doc = 'Due @2026-06-06_1200 tomorrow\n@2026-12-28 end';
    view = mountView(doc);
    vi.spyOn(view, 'hasFocus', 'get').mockReturnValue(true);
    // Put the caret on the first line.
    view.dispatch({selection: EditorSelection.cursor(0)});

    const intervals = collectIntervals(view, buildDateTokenDecorations(view, NOW));
    const withTimeFrom = doc.indexOf('@2026-06-06_1200');
    const dateOnlyFrom = doc.indexOf('@2026-12-28');

    expect(intervals).toEqual([
      {
        from: withTimeFrom,
        to: withTimeFrom + '@2026-06-06_1200'.length,
        kind: 'mark',
        class: CM_DATE_TOKEN_CLASS,
        pillText: undefined,
      },
      {
        from: dateOnlyFrom,
        to: dateOnlyFrom + '@2026-12-28'.length,
        kind: 'replace',
        class: undefined,
        pillText: '🔔 28 Dec',
      },
    ]);
  });

  it('does not decorate invalid tokens', () => {
    view = mountView('bad @2026-13-99 and @2026-02-29');
    vi.spyOn(view, 'hasFocus', 'get').mockReturnValue(false);

    expect(collectIntervals(view, buildDateTokenDecorations(view, NOW))).toEqual(
      [],
    );
  });

  it('does not decorate tokens without a word boundary', () => {
    view = mountView('foo@2026-06-06');
    vi.spyOn(view, 'hasFocus', 'get').mockReturnValue(false);

    expect(collectIntervals(view, buildDateTokenDecorations(view, NOW))).toEqual(
      [],
    );
  });

  it('renders past tokens with a check icon and the past modifier class', () => {
    const doc = '@2026-06-05 done';
    view = mountView(doc);
    vi.spyOn(view, 'hasFocus', 'get').mockReturnValue(false);

    const set = buildDateTokenDecorations(view, NOW);
    let dom: HTMLElement | null = null;
    set.between(0, view.state.doc.length, (_from, _to, deco) => {
      const widget = (deco.spec as {widget?: {toDOM: () => HTMLElement}}).widget;
      if (widget) {
        dom = widget.toDOM();
      }
    });

    expect(dom).not.toBeNull();
    const pill = dom as unknown as HTMLElement;
    expect(pill.textContent).toBe('☑️ 5 Jun');
    expect(pill.classList.contains('cm-date-token-pill--past')).toBe(true);
  });

  it('exposes the pill class for styling', () => {
    expect(CM_DATE_TOKEN_PILL_CLASS).toBe('cm-date-token-pill');
  });
});

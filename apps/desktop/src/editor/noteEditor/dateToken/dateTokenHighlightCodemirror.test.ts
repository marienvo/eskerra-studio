import {EditorSelection, EditorState} from '@codemirror/state';
import {EditorView, ViewPlugin, type ViewUpdate} from '@codemirror/view';
import {afterEach, describe, expect, it, vi} from 'vitest';

import * as dateTokenHighlightModule from './dateTokenHighlightCodemirror';
import {
  buildDateTokenDecorations,
  CM_DATE_TOKEN_CLASS,
  CM_DATE_TOKEN_PILL_CLASS,
  CM_DATE_TOKEN_PILL_COMPLETED_CLASS,
  CM_DATE_TOKEN_PILL_PAST_CLASS,
  dateTokenHighlightExtensions,
  documentHasVisibleDateTokenPills,
  updateDateTokenDecorationsForDocChange,
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
      pillText: widget
        ? (() => {
          const dom = widget.toDOM();
          const emoji = dom.querySelector('.cm-date-token-pill__emoji')?.textContent ?? '';
          const label = dom.querySelector('.cm-date-token-pill__label')?.textContent ?? '';
          return emoji || label ? `${emoji} ${label}` : undefined;
        })()
        : undefined,
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

function mountViewWithHighlight(doc: string): EditorView {
  const parent = document.createElement('div');
  document.body.append(parent);
  const state = EditorState.create({
    doc,
    extensions: [dateTokenHighlightExtensions()],
  });
  return new EditorView({state, parent});
}

describe('dateTokenHighlightCodemirror', () => {
  let view: EditorView | null = null;

  afterEach(() => {
    vi.useRealTimers();
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

  it('renders struck tokens as completed pills with structured label DOM', () => {
    const doc = 'done @~~2026-06-07_0930~~';
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
    expect(pill.classList.contains(CM_DATE_TOKEN_PILL_COMPLETED_CLASS)).toBe(true);
    expect(pill.querySelector('.cm-date-token-pill__emoji')?.textContent).toBe('🔕');
    expect(pill.querySelector('.cm-date-token-pill__label')?.textContent).toBe(
      'Tom at 09:30',
    );
    expect(pill.classList.contains('cm-date-token-pill--past')).toBe(false);
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
    expect(pill.querySelector('.cm-date-token-pill__emoji')?.textContent).toBe('☑️');
    expect(pill.querySelector('.cm-date-token-pill__label')?.textContent).toBe('5 Jun');
    expect(pill.classList.contains('cm-date-token-pill--past')).toBe(true);
  });

  it('exposes the pill class for styling', () => {
    expect(CM_DATE_TOKEN_PILL_CLASS).toBe('cm-date-token-pill');
  });

  it('incrementally updates decorations to match a full rescan after a line edit', () => {
    const initialDoc = 'Due @2026-06-06 tomorrow\n@2026-12-28 end';
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
    const parent = document.createElement('div');
    document.body.append(parent);
    const state = EditorState.create({
      doc: initialDoc,
      extensions: [dateTokenHighlightExtensions(), captureUpdate],
    });
    view = new EditorView({state, parent});
    vi.spyOn(view, 'hasFocus', 'get').mockReturnValue(false);

    const beforeDecorations = buildDateTokenDecorations(view, NOW);
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
      new Set<number>(),
      NOW,
    );
    const fullRescan = buildDateTokenDecorations(view, NOW);

    expect(collectIntervals(view, incremental)).toEqual(
      collectIntervals(view, fullRescan),
    );
    const docText = view.state.doc.toString();
    const dec15From = docText.indexOf('@2026-12-15');
    const dec28From = docText.indexOf('@2026-12-28');
    expect(collectIntervals(view, incremental)).toEqual([
      {
        from: dec15From,
        to: dec15From + '@2026-12-15'.length,
        kind: 'replace',
        class: undefined,
        pillText: '🔔 15 Dec',
      },
      {
        from: dec28From,
        to: dec28From + '@2026-12-28'.length,
        kind: 'replace',
        class: undefined,
        pillText: '🔔 28 Dec',
      },
    ]);
  });

  it('does not rebuild when selection moves within the same focused line', () => {
    const doc = 'Due @2026-06-06_1200 tomorrow\n@2026-12-28 end';
    const focusSpy = vi.spyOn(
      dateTokenHighlightModule,
      'updateDateTokenDecorationsForFocusChange',
    );
    view = mountViewWithHighlight(doc);
    vi.spyOn(view, 'hasFocus', 'get').mockReturnValue(true);

    view.dispatch({selection: EditorSelection.cursor(0)});
    focusSpy.mockClear();

    view.dispatch({selection: EditorSelection.cursor(5)});

    expect(focusSpy).not.toHaveBeenCalled();
    focusSpy.mockRestore();
  });

  it('detects visible pills only on non-focused lines with valid tokens', () => {
    const doc = 'Due @2026-06-06_1200 tomorrow\n@2026-12-28 end';
    view = mountView(doc);
    vi.spyOn(view, 'hasFocus', 'get').mockReturnValue(false);
    expect(documentHasVisibleDateTokenPills(view)).toBe(true);

    vi.spyOn(view, 'hasFocus', 'get').mockReturnValue(true);
    view.dispatch({selection: EditorSelection.cursor(0)});
    expect(documentHasVisibleDateTokenPills(view)).toBe(true);

    const secondLineStart = doc.indexOf('\n') + 1;
    view.dispatch({selection: EditorSelection.cursor(secondLineStart)});
    expect(documentHasVisibleDateTokenPills(view)).toBe(true);

    view.dispatch({
      changes: {from: 0, to: view.state.doc.length, insert: 'no tokens here'},
    });
    expect(documentHasVisibleDateTokenPills(view)).toBe(false);
  });

  it('refreshes pill labels when the aligned minute clock fires', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 6, 11, 59, 30));

    const doc = 'Due @2026-06-06_1200 tomorrow';
    view = mountViewWithHighlight(doc);
    vi.spyOn(view, 'hasFocus', 'get').mockReturnValue(false);

    const pill = () =>
      view!.dom.querySelector(`.${CM_DATE_TOKEN_PILL_CLASS}`) as HTMLElement | null;

    expect(pill()?.querySelector('.cm-date-token-pill__emoji')?.textContent).toBe('🔔');
    expect(pill()?.querySelector('.cm-date-token-pill__label')?.textContent).toBe('Today at 12:00');
    expect(pill()?.classList.contains(CM_DATE_TOKEN_PILL_PAST_CLASS)).toBe(false);

    vi.setSystemTime(new Date(2026, 5, 6, 12, 0, 1));
    await vi.advanceTimersByTimeAsync(30_000);
    await Promise.resolve();

    expect(pill()?.querySelector('.cm-date-token-pill__emoji')?.textContent).toBe('☑️');
    expect(pill()?.querySelector('.cm-date-token-pill__label')?.textContent).toBe('Today at 12:00');
    expect(pill()?.classList.contains(CM_DATE_TOKEN_PILL_PAST_CLASS)).toBe(true);
  });

  it('swaps chip/pill only on affected lines when focus moves between lines', () => {
    const doc = 'Due @2026-06-06_1200 tomorrow\n@2026-12-28 end';
    view = mountViewWithHighlight(doc);
    vi.spyOn(view, 'hasFocus', 'get').mockReturnValue(true);

    view.dispatch({selection: EditorSelection.cursor(0)});
    const beforeMove = collectIntervals(view, buildDateTokenDecorations(view, NOW));
    const withTimeFrom = doc.indexOf('@2026-06-06_1200');
    const dateOnlyFrom = doc.indexOf('@2026-12-28');

    expect(beforeMove).toEqual([
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

    const secondLineStart = doc.indexOf('\n') + 1;
    view.dispatch({selection: EditorSelection.cursor(secondLineStart)});
    const afterMove = collectIntervals(view, buildDateTokenDecorations(view, NOW));

    expect(afterMove).toEqual([
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
        kind: 'mark',
        class: CM_DATE_TOKEN_CLASS,
        pillText: undefined,
      },
    ]);
  });
});

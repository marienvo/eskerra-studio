import {ensureSyntaxTree, syntaxTree} from '@codemirror/language';
import {EditorSelection, Prec, type Extension} from '@codemirror/state';
import {
  EditorView,
  RectangleMarker,
  layer,
  type LayerMarker,
} from '@codemirror/view';

import {layerBaseOffset} from './markdownEditorLayerCoords';
import {
  equalHighlightPaintRange,
  finalizeEqualHighlightBackgroundMarkers,
} from './markdownEqualHighlightGeometry';

/** Enough for long notes so `EqualHighlight` exists when the code-background layer builds. */
const SYNTAX_TREE_BUDGET_MS = 1000;

/** Class on {@link RectangleMarker}s for inline `` `code` `` backgrounds (styled in App.css). */
export const markdownInlineCodeBackgroundClass = 'cm-md-inline-code-bg';

/** Class on {@link RectangleMarker}s for `==highlight==` backgrounds (styled in App.css). */
export const markdownEqualHighlightBackgroundClass = 'cm-md-equal-highlight-bg';

/**
 * `RectangleMarker.forRange` returns [] when the range does not overlap `view.viewport` (including
 * a degenerate `viewport.to <= viewport.from` before the first layout) or when coords are missing.
 * These fallbacks keep inline pills visible once DOM positions exist.
 */
function inlineRangeBackgroundMarkers(
  view: EditorView,
  from: number,
  to: number,
  cls: string,
): LayerMarker[] {
  const range = EditorSelection.range(from, to);
  const primary = [...RectangleMarker.forRange(view, cls, range)];
  if (primary.length > 0) {
    return primary;
  }

  const c1 = view.coordsAtPos(from, 1);
  const c2 = view.coordsAtPos(to, -1);
  if (c1 && c2) {
    const base = layerBaseOffset(view);
    const left = Math.min(c1.left, c2.left) - base.left;
    const top = Math.min(c1.top, c2.top) - base.top;
    const right = Math.max(c1.right, c2.right) - base.left;
    const bottom = Math.max(c1.bottom, c2.bottom) - base.top;
    return [
      new RectangleMarker(
        cls,
        left,
        top,
        Math.max(0, right - left),
        bottom - top,
      ),
    ];
  }

  try {
    const start = view.domAtPos(from);
    const end = view.domAtPos(to);
    const domRange = document.createRange();
    domRange.setStart(start.node, start.offset);
    domRange.setEnd(end.node, end.offset);
    const rects = domRange.getClientRects();
    if (rects.length === 0) {
      return [];
    }
    const base = layerBaseOffset(view);
    const out: RectangleMarker[] = [];
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i]!;
      if (r.width <= 0 && r.height <= 0) {
        continue;
      }
      out.push(
        new RectangleMarker(
          cls,
          r.left - base.left,
          r.top - base.top,
          r.width,
          r.height,
        ),
      );
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * One rectangle covering an entire fenced / indented code block, drawn in a {@link layer} below
 * `drawSelection()`'s `.cm-selectionLayer` so opaque fills never hide selection.
 *
 * `left` / `width` are explicit (not CSS `left: 0; right: 0`) because `.cm-layer` has
 * `contain: size` and no explicit width, giving descendants a 0-width containing block.
 */
export class MarkdownFenceBlockBackgroundMarker implements LayerMarker {
  readonly top: number;
  readonly height: number;
  readonly left: number;
  readonly width: number;

  constructor(top: number, height: number, left: number, width: number) {
    this.top = top;
    this.height = height;
    this.left = left;
    this.width = width;
  }

  draw(): HTMLElement {
    const el = document.createElement('div');
    el.className = 'cm-md-fence-bg';
    el.style.top = `${this.top}px`;
    el.style.height = `${this.height}px`;
    el.style.left = `${this.left}px`;
    el.style.width = `${this.width}px`;
    return el;
  }

  update(elt: HTMLElement, prev: LayerMarker): boolean {
    /* CodeMirror's `LayerView.draw` reuses an old DOM element when `update()` returns true, but it
     * does not check that `prev` is the same marker class. Returning true here for a `RectangleMarker`
     * (inline-code / equal-highlight pill) left the old className and inline `left`/`width` in place
     * while overwriting `top`/`height` — producing a pill at the previous note's horizontal position
     * stretched to fence-block height after switching tabs. Force a fresh draw when types differ. */
    if (!(prev instanceof MarkdownFenceBlockBackgroundMarker)) {
      return false;
    }
    elt.style.top = `${this.top}px`;
    elt.style.height = `${this.height}px`;
    elt.style.left = `${this.left}px`;
    elt.style.width = `${this.width}px`;
    return true;
  }

  eq(other: LayerMarker): boolean {
    return (
      other instanceof MarkdownFenceBlockBackgroundMarker
      && other.top === this.top
      && other.height === this.height
      && other.left === this.left
      && other.width === this.width
    );
  }
}

/**
 * `.cm-md-fence-bg` geometry helpers:
 * - `left` / `width`: match `.cm-line` (cm-content content-box, excluding the editor's gutter
 *   padding) so the fill sits under fenced lines without spilling into the fold rail.
 * - `docTopInLayer`: `BlockInfo.top` is measured from `view.documentTop` (top of the first text
 *   line, i.e. after `cm-content`'s `paddingTop`). The layer's coordinate origin is at the scroller
 *   padding box, so converting needs `documentTop - base.top`. Without this the rect sits one
 *   `paddingTop` above the fenced text.
 */
function fenceBackgroundGeometry(view: EditorView): {
  left: number;
  width: number;
  docTopInLayer: number;
} {
  const contentRect = view.contentDOM.getBoundingClientRect();
  const cs = window.getComputedStyle(view.contentDOM);
  const padL = parseFloat(cs.paddingLeft) || 0;
  const padR = parseFloat(cs.paddingRight) || 0;
  const base = layerBaseOffset(view);
  return {
    left: contentRect.left + padL - base.left,
    width: Math.max(0, contentRect.width - padL - padR),
    docTopInLayer: view.documentTop - base.top,
  };
}

/**
 * Builds the same markers as {@link markdownCodeBackgroundLayer} (for tests and debugging).
 */
export function collectMarkdownCodeBackgroundMarkers(
  view: EditorView,
): readonly LayerMarker[] {
  return buildMarkdownCodeBackgroundMarkers(view);
}

function buildMarkdownCodeBackgroundMarkers(view: EditorView): LayerMarker[] {
  const doc = view.state.doc;
  const docLen = doc.length;
  ensureSyntaxTree(view.state, docLen, SYNTAX_TREE_BUDGET_MS);
  const tree = syntaxTree(view.state);
  const out: LayerMarker[] = [];
  let fenceGeom: {left: number; width: number; docTopInLayer: number} | null = null;

  /* Full-doc walk: `view.viewport` can omit the first lines (or be degenerate) before layout; inline
   * `` `…` `` near the top must still get markers once coords exist. */
  tree.iterate({
    from: 0,
    to: docLen,
    enter(cursor) {
      const name = cursor.name;
      if (name === 'FencedCode' || name === 'CodeBlock') {
        const blockFrom = cursor.from;
        const blockTo = Math.min(cursor.to, docLen);
        const lastChar = Math.max(blockFrom, blockTo - 1);
        const startLine = doc.lineAt(blockFrom);
        const endLine = doc.lineAt(Math.min(lastChar, docLen - 1));
        const first = view.lineBlockAt(startLine.from);
        const last = view.lineBlockAt(endLine.from);
        if (fenceGeom === null) {
          fenceGeom = fenceBackgroundGeometry(view);
        }
        out.push(
          new MarkdownFenceBlockBackgroundMarker(
            fenceGeom.docTopInLayer + first.top,
            last.bottom - first.top,
            fenceGeom.left,
            fenceGeom.width,
          ),
        );
        return false;
      }
      if (name === 'InlineCode') {
        for (const m of inlineRangeBackgroundMarkers(view, cursor.from, cursor.to, markdownInlineCodeBackgroundClass)) {
          out.push(m);
        }
      }
      if (name === 'EqualHighlight') {
        /* Prefer inner text (skips `==` when present) so coords stay valid when delimiter spans are
         * `display:none` off the marker-focus line. If the tree node is already inner-only, the
         * slice guard leaves the range unchanged. */
        const {from: paintFrom, to: paintTo} = equalHighlightPaintRange(doc, cursor.from, cursor.to);
        let markers = inlineRangeBackgroundMarkers(
          view,
          paintFrom,
          paintTo,
          markdownEqualHighlightBackgroundClass,
        );
        if (
          markers.length === 0
          && (paintFrom !== cursor.from || paintTo !== cursor.to)
        ) {
          markers = inlineRangeBackgroundMarkers(
            view,
            cursor.from,
            cursor.to,
            markdownEqualHighlightBackgroundClass,
          );
        }
        markers = finalizeEqualHighlightBackgroundMarkers(
          view,
          paintFrom,
          paintTo,
          markers,
          markdownEqualHighlightBackgroundClass,
        );
        for (const m of markers) {
          out.push(m);
        }
      }
    },
  });

  return out;
}

/**
 * Renders fenced-code block fills and inline-code pill fills below CodeMirror's selection layer
 * (see discuss.codemirror.net: line backgrounds in `.cm-content` cover `.cm-selectionLayer`).
 */
export const markdownCodeBackgroundLayer: Extension = Prec.low(
  layer({
    above: false,
    class: 'cm-md-codeBackgroundLayer',
    update: u =>
      u.docChanged
      || u.viewportChanged
      || u.geometryChanged
      || u.heightChanged
      || u.selectionSet
      || u.focusChanged,
    markers: view => buildMarkdownCodeBackgroundMarkers(view),
  }),
);

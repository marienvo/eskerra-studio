/** Pointer → UTF-16 offset for Today Hub static cell DOM (same layout as read-only rich text). */

/** Pixels past the last laid-out character before we treat the click as end-of-line (trailing whitespace). */
const TRAILING_WHITESPACE_HIT_SLACK_PX = 3;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * True if `el` is inside a link span that stays visible in
 * `[data-app-surface='capture'] .today-hub-canvas__cell-static-rich` (brackets + hrefs are
 * `display: none` there).
 */
export function isVisibleTodayHubStaticLinkTokenElement(el: Element): boolean {
  if (el.closest('.cm-wiki-link')) {
    return true;
  }
  const rel = el.closest('.cm-md-rel-link');
  if (rel && !rel.classList.contains('cm-md-rel-link-href')) {
    return true;
  }
  const ext = el.closest('.cm-md-external-link');
  if (ext && !ext.classList.contains('cm-md-external-href')) {
    return true;
  }
  return false;
}

/**
 * Whether a primary hit at `(clientX, clientY)` lies on visible link paint (not bare `.cm-line`
 * padding / trailing gap).
 */
export function todayHubStaticRichTextPointerHitsVisibleLinkToken(
  root: HTMLElement,
  clientX: number,
  clientY: number,
): boolean {
  const hit = root.ownerDocument.elementFromPoint(clientX, clientY);
  if (!hit || !root.contains(hit)) {
    return false;
  }
  return isVisibleTodayHubStaticLinkTokenElement(hit);
}

/**
 * WebKitGTK may return null from `caretRangeFromPoint`/`caretPositionFromPoint` even on plain text.
 * Find the nearest collapsed-range rect (caret position) inside `lineEl` to the click point.
 */
type CaretGeometryScan = {
  bestDist: number;
  bestOffset: number;
  base: number;
  maxRight: number;
};

function scanLineTextRectsForNearestCaret(
  doc: Document,
  lineEl: HTMLElement,
  clientX: number,
  clientY: number,
): CaretGeometryScan | null {
  let bestDist = Infinity;
  let bestOffset = 0;
  let base = 0;
  let maxRight = -Infinity;
  const tw = doc.createTreeWalker(lineEl, NodeFilter.SHOW_TEXT);
  let n: Node | null;
  while ((n = tw.nextNode())) {
    const tn = n as Text;
    const len = tn.length;
    for (let o = 0; o <= len; o++) {
      const r = doc.createRange();
      try {
        r.setStart(tn, o);
        r.setEnd(tn, o);
      } catch {
        continue;
      }
      const rects = r.getClientRects();
      for (let i = 0; i < rects.length; i++) {
        const br = rects[i];
        maxRight = Math.max(maxRight, br.right);
        const cx = clamp(clientX, br.left, br.right);
        const cy = clamp(clientY, br.top, br.bottom);
        const d = (clientX - cx) ** 2 + (clientY - cy) ** 2;
        if (d < bestDist) {
          bestDist = d;
          bestOffset = base + o;
        }
      }
    }
    base += len;
  }

  if (bestDist === Infinity) {
    return null;
  }
  return {bestDist, bestOffset, base, maxRight};
}

function localOffsetInLineFromCaretGeometry(
  lineEl: HTMLElement,
  clientX: number,
  clientY: number,
): number | null {
  const doc = lineEl.ownerDocument;
  const bounds = lineEl.getBoundingClientRect();
  const pad = 6;
  if (
    clientX < bounds.left - pad
    || clientX > bounds.right + pad
    || clientY < bounds.top - pad
    || clientY > bounds.bottom + pad
  ) {
    return null;
  }

  const scan = scanLineTextRectsForNearestCaret(doc, lineEl, clientX, clientY);
  if (!scan) {
    return null;
  }
  const {bestOffset, base, maxRight} = scan;
  if (Number.isFinite(maxRight) && clientX > maxRight + TRAILING_WHITESPACE_HIT_SLACK_PX) {
    return base;
  }
  return bestOffset;
}

/**
 * Local UTF-16 offset within `lineEl` using `caretRangeFromPoint` + Range length (WebKitGTK: often no
 * `caretPositionFromPoint`). Works for both text and element boundary positions.
 */
function localOffsetInLineFromCaretRange(
  lineEl: HTMLElement,
  clientX: number,
  clientY: number,
): number | null {
  const doc = lineEl.ownerDocument;
  const crfp = doc.caretRangeFromPoint?.bind(doc);
  if (!crfp) {
    return null;
  }
  let pointRange: Range | null;
  try {
    pointRange = crfp(clientX, clientY);
  } catch {
    return null;
  }
  if (!pointRange || !lineEl.contains(pointRange.startContainer)) {
    return null;
  }
  const pre = doc.createRange();
  try {
    pre.selectNodeContents(lineEl);
    pre.setEnd(pointRange.startContainer, pointRange.startOffset);
  } catch {
    return null;
  }
  return pre.toString().length;
}

function legacyCaretTextHit(
  doc: Document,
  root: HTMLElement,
  clientX: number,
  clientY: number,
): {offsetNode: Text; offset: number} | null {
  let offsetNode: Node | null = null;
  let offset = 0;

  if (doc.caretPositionFromPoint) {
    const pos = doc.caretPositionFromPoint(clientX, clientY);
    if (pos && root.contains(pos.offsetNode)) {
      offsetNode = pos.offsetNode;
      offset = pos.offset;
    }
  }
  if (offsetNode == null && doc.caretRangeFromPoint) {
    const range = doc.caretRangeFromPoint(clientX, clientY);
    if (range && root.contains(range.startContainer)) {
      if (range.startContainer.nodeType === Node.TEXT_NODE) {
        offsetNode = range.startContainer;
        offset = range.startOffset;
      }
    }
  }
  if (offsetNode == null || offsetNode.nodeType !== Node.TEXT_NODE) {
    return null;
  }
  return {offsetNode: offsetNode as Text, offset};
}

/** Local UTF-16 offset within `root` (sum of text-node lengths under root). Legacy: needs TEXT_NODE hits. */
function utf16OffsetFromPointerLegacy(
  root: HTMLElement,
  clientX: number,
  clientY: number,
): number | null {
  const doc = root.ownerDocument;
  const hit = legacyCaretTextHit(doc, root, clientX, clientY);
  if (!hit) {
    return null;
  }
  const {offsetNode, offset} = hit;
  let total = 0;
  const tw = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n: Node | null;
  while ((n = tw.nextNode())) {
    if (n === offsetNode) {
      return total + offset;
    }
    total += (n as Text).length;
  }
  return null;
}

/** UTF-16 document offset for a primary click inside the static hub cell (for opening edit at the same place). */
export function todayHubStaticCellDocOffsetFromPointer(
  root: HTMLElement,
  clientX: number,
  clientY: number,
): number | null {
  const lineEls = root.querySelectorAll<HTMLElement>('[data-doc-line-from]');
  for (const el of lineEls) {
    const fromRange = localOffsetInLineFromCaretRange(el, clientX, clientY);
    if (fromRange != null) {
      const from = Number(el.dataset.docLineFrom);
      return from + fromRange;
    }
    const fromLegacy = utf16OffsetFromPointerLegacy(el, clientX, clientY);
    if (fromLegacy != null) {
      const from = Number(el.dataset.docLineFrom);
      return from + fromLegacy;
    }
    const fromGeom = localOffsetInLineFromCaretGeometry(el, clientX, clientY);
    if (fromGeom != null) {
      const from = Number(el.dataset.docLineFrom);
      return from + fromGeom;
    }
  }
  return null;
}

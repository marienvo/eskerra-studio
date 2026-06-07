import type {EditorView} from '@codemirror/view';

/** Max pointer movement (px) between mousedown and click to prefer mousedown `posAtCoords`. */
const LINK_PRIMARY_CLICK_MAX_MOVE_PX = 8;

/** Drop stale mousedown samples so an old gesture cannot affect a later click. */
const LINK_PRIMARY_CLICK_MAX_MDOWN_TO_CLICK_MS = 800;

export type LinkPointerDownSample = {
  x: number;
  y: number;
  pos: number | null;
  timeStamp: number;
  markerFocusLine: boolean;
  dateToken: boolean;
};

const lastPrimaryDownByView = new WeakMap<EditorView, LinkPointerDownSample>();
const dateTokenPickerOpenedForGestureByView = new WeakMap<EditorView, boolean>();

function targetInMarkerFocusLine(target: EventTarget | null): boolean {
  return target instanceof Element
    && target.closest('.cm-line')?.classList.contains('cm-eskerra-marker-focus-line') === true;
}

/**
 * Whether the gesture started on a rendered date token (chip or pill). Captured
 * at mousedown because focusing the line swaps a pill for the raw chip before
 * the click fires, which would otherwise lose the `data-date-token` target.
 */
function targetOnDateToken(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[data-date-token]') !== null;
}

export function recordPrimaryPointerDownForLinkClick(
  view: EditorView,
  e: MouseEvent,
): void {
  if (e.button !== 0) {
    return;
  }
  dateTokenPickerOpenedForGestureByView.delete(view);
  lastPrimaryDownByView.set(view, {
    x: e.clientX,
    y: e.clientY,
    pos: view.posAtCoords({x: e.clientX, y: e.clientY}),
    timeStamp: e.timeStamp,
    markerFocusLine: targetInMarkerFocusLine(e.target),
    dateToken: targetOnDateToken(e.target),
  });
}

export function discardStoredPrimaryPointerDownForLinkClick(
  view: EditorView,
): void {
  lastPrimaryDownByView.delete(view);
}

export function peekStoredPrimaryPointerDownForLinkClick(
  view: EditorView,
): LinkPointerDownSample | undefined {
  return lastPrimaryDownByView.get(view);
}

/** Whether mouseup/click is still the same short gesture as a stored mousedown. */
export function isSamePrimaryPointerGesture(
  down: LinkPointerDownSample,
  event: {timeStamp: number; clientX: number; clientY: number},
): boolean {
  if (event.timeStamp < down.timeStamp) {
    return false;
  }
  if (event.timeStamp - down.timeStamp > LINK_PRIMARY_CLICK_MAX_MDOWN_TO_CLICK_MS) {
    return false;
  }
  const dx = event.clientX - down.x;
  const dy = event.clientY - down.y;
  const max = LINK_PRIMARY_CLICK_MAX_MOVE_PX;
  return dx * dx + dy * dy <= max * max;
}

export function markDateTokenPickerOpenedForGesture(view: EditorView): void {
  dateTokenPickerOpenedForGestureByView.set(view, true);
}

/** Returns true once per gesture when mouseup already opened the date picker. */
export function consumeDateTokenPickerOpenedForGesture(view: EditorView): boolean {
  if (!dateTokenPickerOpenedForGestureByView.get(view)) {
    return false;
  }
  dateTokenPickerOpenedForGestureByView.delete(view);
  return true;
}

/**
 * Prefer the document position from primary mousedown when the click is the same inert gesture
 * (marker-focus line toggles `display:none` markers and would otherwise shift `posAtCoords`).
 */
export function pickDocPosForLinkPrimaryClick(
  atClick: number | null,
  click: {timeStamp: number; clientX: number; clientY: number},
  down: LinkPointerDownSample | undefined,
): number | null {
  if (down == null || down.pos == null) {
    return atClick;
  }
  if (click.timeStamp < down.timeStamp) {
    return atClick;
  }
  if (click.timeStamp - down.timeStamp > LINK_PRIMARY_CLICK_MAX_MDOWN_TO_CLICK_MS) {
    return atClick;
  }
  const dx = click.clientX - down.x;
  const dy = click.clientY - down.y;
  const max = LINK_PRIMARY_CLICK_MAX_MOVE_PX;
  if (dx * dx + dy * dy > max * max) {
    return atClick;
  }
  return down.pos;
}

export function pickPrimaryLinkClickContext(
  atClick: number | null,
  click: {timeStamp: number; clientX: number; clientY: number},
  down: LinkPointerDownSample | undefined,
  atClickMarkerFocusLine: boolean,
  atClickDateToken: boolean,
): {pos: number | null; markerFocusLine: boolean; dateToken: boolean} {
  const pos = pickDocPosForLinkPrimaryClick(atClick, click, down);
  if (pos != null && down != null && pos === down.pos) {
    return {pos, markerFocusLine: down.markerFocusLine, dateToken: down.dateToken};
  }
  return {pos, markerFocusLine: atClickMarkerFocusLine, dateToken: atClickDateToken};
}

export function resolveDocPositionForLinkPrimaryClick(
  view: EditorView,
  e: MouseEvent,
): number | null {
  return resolvePrimaryLinkClickContext(view, e).pos;
}

export function resolvePrimaryLinkClickContext(
  view: EditorView,
  e: MouseEvent,
): {pos: number | null; markerFocusLine: boolean; dateToken: boolean} {
  const down = lastPrimaryDownByView.get(view);
  lastPrimaryDownByView.delete(view);
  const atClick = view.posAtCoords({x: e.clientX, y: e.clientY});
  return pickPrimaryLinkClickContext(
    atClick,
    e,
    down,
    targetInMarkerFocusLine(e.target),
    targetOnDateToken(e.target),
  );
}

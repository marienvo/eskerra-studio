/** Max ms between consecutive Ctrl releases for a double-tap. */
export const DOUBLE_CTRL_WINDOW_MS = 400;

export type DoubleCtrlState = {
  /** Timestamp from `performance.now()` or `Date.now()` of the last bare Ctrl keyup. */
  lastCtrlUpAt: number | null;
};

export const initialDoubleCtrlState: DoubleCtrlState = {lastCtrlUpAt: null};

/**
 * Call on capture-phase `keydown`. Any key chord that is not a lone Ctrl clears progress.
 */
export function reduceDoubleCtrlKeyDown(
  state: DoubleCtrlState,
  key: string,
  ctrlKey: boolean,
  metaKey: boolean,
  altKey: boolean,
): DoubleCtrlState {
  const loneCtrl = key === 'Control' && !metaKey && !altKey;
  if (!loneCtrl || !ctrlKey) {
    return {lastCtrlUpAt: null};
  }
  return state;
}

/**
 * Call on capture-phase `keyup`. Returns `shouldOpen` when a second bare Ctrl release lands
 * within {@link DOUBLE_CTRL_WINDOW_MS} after the previous one.
 */
export function reduceDoubleCtrlKeyUp(
  state: DoubleCtrlState,
  now: number,
  key: string,
  _ctrlKey: boolean,
  metaKey: boolean,
  altKey: boolean,
): {state: DoubleCtrlState; shouldOpen: boolean} {
  if (key !== 'Control') {
    return {state: {lastCtrlUpAt: null}, shouldOpen: false};
  }
  // On keyup for Control, `ctrlKey` can already be false; only block if other modifiers are held.
  if (metaKey || altKey) {
    return {state: {lastCtrlUpAt: null}, shouldOpen: false};
  }
  const prev = state.lastCtrlUpAt;
  if (prev == null) {
    return {state: {lastCtrlUpAt: now}, shouldOpen: false};
  }
  if (now - prev <= DOUBLE_CTRL_WINDOW_MS) {
    return {state: {lastCtrlUpAt: null}, shouldOpen: true};
  }
  return {state: {lastCtrlUpAt: now}, shouldOpen: false};
}

/** Max ms between consecutive Ctrl releases for a double-tap. */
export const DOUBLE_CTRL_WINDOW_MS = 400;

export type DoubleCtrlState = {
  /** Timestamp from `performance.now()` or `Date.now()` of the last bare Ctrl keyup. */
  lastCtrlUpAt: number | null;
  /**
   * After a Ctrl chord (e.g. Ctrl+Shift+T), the next bare Control keyup should not seed
   * `lastCtrlUpAt`, otherwise a single later Ctrl tap can false-trigger within the window.
   */
  suppressNextBareCtrlUp: boolean;
};

export const initialDoubleCtrlState: DoubleCtrlState = {
  lastCtrlUpAt: null,
  suppressNextBareCtrlUp: false,
};

/**
 * Call on capture-phase `keydown`. Any key chord that is not a lone Ctrl clears progress;
 * Ctrl+non-Control chords latch {@link DoubleCtrlState.suppressNextBareCtrlUp}.
 */
export function reduceDoubleCtrlKeyDown(
  state: DoubleCtrlState,
  key: string,
  ctrlKey: boolean,
  metaKey: boolean,
  altKey: boolean,
  shiftKey: boolean,
): DoubleCtrlState {
  const loneCtrl = key === 'Control' && ctrlKey && !metaKey && !altKey && !shiftKey;
  if (loneCtrl) {
    return {...state, suppressNextBareCtrlUp: false};
  }
  if (ctrlKey && (key !== 'Control' || metaKey || altKey || shiftKey)) {
    return {lastCtrlUpAt: null, suppressNextBareCtrlUp: true};
  }
  return {lastCtrlUpAt: null, suppressNextBareCtrlUp: false};
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
  shiftKey: boolean,
): {state: DoubleCtrlState; shouldOpen: boolean} {
  if (key !== 'Control') {
    return {
      state: {
        lastCtrlUpAt: null,
        suppressNextBareCtrlUp: state.suppressNextBareCtrlUp,
      },
      shouldOpen: false,
    };
  }
  // On keyup for Control, `ctrlKey` can already be false; block other modifiers.
  if (metaKey || altKey || shiftKey) {
    return {state: {lastCtrlUpAt: null, suppressNextBareCtrlUp: false}, shouldOpen: false};
  }
  if (state.suppressNextBareCtrlUp) {
    return {state: {lastCtrlUpAt: null, suppressNextBareCtrlUp: false}, shouldOpen: false};
  }
  const prev = state.lastCtrlUpAt;
  if (prev == null) {
    return {
      state: {lastCtrlUpAt: now, suppressNextBareCtrlUp: false},
      shouldOpen: false,
    };
  }
  if (now - prev <= DOUBLE_CTRL_WINDOW_MS) {
    return {state: {lastCtrlUpAt: null, suppressNextBareCtrlUp: false}, shouldOpen: true};
  }
  return {
    state: {lastCtrlUpAt: now, suppressNextBareCtrlUp: false},
    shouldOpen: false,
  };
}

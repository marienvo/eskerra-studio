import {describe, expect, it} from 'vitest';

import {
  DOUBLE_CTRL_WINDOW_MS,
  initialDoubleCtrlState,
  reduceDoubleCtrlKeyDown,
  reduceDoubleCtrlKeyUp,
} from './doubleCtrlKeySequence';

describe('reduceDoubleCtrlKeyDown', () => {
  it('clears after non-Ctrl key', () => {
    let s = initialDoubleCtrlState;
    ({state: s} = reduceDoubleCtrlKeyUp(s, 0, 'Control', false, false, false));
    expect(s.lastCtrlUpAt).toBe(0);
    s = reduceDoubleCtrlKeyDown(s, 'a', false, false, false);
    expect(s.lastCtrlUpAt).toBeNull();
  });

  it('clears when Ctrl is pressed with Meta', () => {
    let s = initialDoubleCtrlState;
    ({state: s} = reduceDoubleCtrlKeyUp(s, 0, 'Control', false, false, false));
    s = reduceDoubleCtrlKeyDown(s, 'Control', true, true, false);
    expect(s.lastCtrlUpAt).toBeNull();
  });

  it('preserves state on lone Ctrl keydown', () => {
    let s = initialDoubleCtrlState;
    ({state: s} = reduceDoubleCtrlKeyUp(s, 100, 'Control', false, false, false));
    const t = reduceDoubleCtrlKeyDown(s, 'Control', true, false, false);
    expect(t.lastCtrlUpAt).toBe(100);
  });
});

describe('reduceDoubleCtrlKeyUp', () => {
  it('opens on second Ctrl within window', () => {
    let s = initialDoubleCtrlState;
    ({state: s} = reduceDoubleCtrlKeyUp(s, 1000, 'Control', false, false, false));
    expect(s.lastCtrlUpAt).toBe(1000);
    const r = reduceDoubleCtrlKeyUp(
      s,
      1000 + DOUBLE_CTRL_WINDOW_MS,
      'Control',
      false,
      false,
      false,
    );
    expect(r.shouldOpen).toBe(true);
    expect(r.state.lastCtrlUpAt).toBeNull();
  });

  it('does not open when gap exceeds window', () => {
    let s = initialDoubleCtrlState;
    ({state: s} = reduceDoubleCtrlKeyUp(s, 0, 'Control', false, false, false));
    const r = reduceDoubleCtrlKeyUp(
      s,
      DOUBLE_CTRL_WINDOW_MS + 1,
      'Control',
      false,
      false,
      false,
    );
    expect(r.shouldOpen).toBe(false);
    expect(r.state.lastCtrlUpAt).toBe(DOUBLE_CTRL_WINDOW_MS + 1);
  });

  it('clears progress on Ctrl keyup with Meta', () => {
    let s = initialDoubleCtrlState;
    ({state: s} = reduceDoubleCtrlKeyUp(s, 0, 'Control', false, false, false));
    const r = reduceDoubleCtrlKeyUp(s, 10, 'Control', false, true, false);
    expect(r.shouldOpen).toBe(false);
    expect(r.state.lastCtrlUpAt).toBeNull();
  });
});

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
    ({state: s} = reduceDoubleCtrlKeyUp(s, 0, 'Control', false, false, false, false));
    expect(s.lastCtrlUpAt).toBe(0);
    s = reduceDoubleCtrlKeyDown(s, 'a', false, false, false, false);
    expect(s.lastCtrlUpAt).toBeNull();
  });

  it('clears when Ctrl is pressed with Meta', () => {
    let s = initialDoubleCtrlState;
    ({state: s} = reduceDoubleCtrlKeyUp(s, 0, 'Control', false, false, false, false));
    s = reduceDoubleCtrlKeyDown(s, 'Control', true, true, false, false);
    expect(s.lastCtrlUpAt).toBeNull();
  });

  it('preserves state on lone Ctrl keydown', () => {
    let s = initialDoubleCtrlState;
    ({state: s} = reduceDoubleCtrlKeyUp(s, 100, 'Control', false, false, false, false));
    const t = reduceDoubleCtrlKeyDown(s, 'Control', true, false, false, false);
    expect(t.lastCtrlUpAt).toBe(100);
  });

  it('latches suppress after Ctrl+Shift Control down', () => {
    let s = initialDoubleCtrlState;
    s = reduceDoubleCtrlKeyDown(s, 'Control', true, false, false, true);
    expect(s).toEqual({lastCtrlUpAt: null, suppressNextBareCtrlUp: true});
  });

  it('latches suppress after Ctrl+letter chord', () => {
    let s = initialDoubleCtrlState;
    ({state: s} = reduceDoubleCtrlKeyUp(s, 0, 'Control', false, false, false, false));
    s = reduceDoubleCtrlKeyDown(s, 't', true, false, false, true);
    expect(s.suppressNextBareCtrlUp).toBe(true);
    expect(s.lastCtrlUpAt).toBeNull();
  });
});

describe('reduceDoubleCtrlKeyUp', () => {
  it('opens on second Ctrl within window', () => {
    let s = initialDoubleCtrlState;
    ({state: s} = reduceDoubleCtrlKeyUp(s, 1000, 'Control', false, false, false, false));
    expect(s.lastCtrlUpAt).toBe(1000);
    const r = reduceDoubleCtrlKeyUp(
      s,
      1000 + DOUBLE_CTRL_WINDOW_MS,
      'Control',
      false,
      false,
      false,
      false,
    );
    expect(r.shouldOpen).toBe(true);
    expect(r.state.lastCtrlUpAt).toBeNull();
  });

  it('does not open when gap exceeds window', () => {
    let s = initialDoubleCtrlState;
    ({state: s} = reduceDoubleCtrlKeyUp(s, 0, 'Control', false, false, false, false));
    const r = reduceDoubleCtrlKeyUp(
      s,
      DOUBLE_CTRL_WINDOW_MS + 1,
      'Control',
      false,
      false,
      false,
      false,
    );
    expect(r.shouldOpen).toBe(false);
    expect(r.state.lastCtrlUpAt).toBe(DOUBLE_CTRL_WINDOW_MS + 1);
  });

  it('clears progress on Ctrl keyup with Meta', () => {
    let s = initialDoubleCtrlState;
    ({state: s} = reduceDoubleCtrlKeyUp(s, 0, 'Control', false, false, false, false));
    const r = reduceDoubleCtrlKeyUp(s, 10, 'Control', false, true, false, false);
    expect(r.shouldOpen).toBe(false);
    expect(r.state.lastCtrlUpAt).toBeNull();
  });

  it('clears progress on Ctrl keyup with Shift', () => {
    let s = initialDoubleCtrlState;
    ({state: s} = reduceDoubleCtrlKeyUp(s, 0, 'Control', false, false, false, false));
    const r = reduceDoubleCtrlKeyUp(s, 10, 'Control', false, false, false, true);
    expect(r.shouldOpen).toBe(false);
    expect(r.state.lastCtrlUpAt).toBeNull();
  });

  it('does not seed after Ctrl+Shift+letter chord then one bare Ctrl release', () => {
    let s = initialDoubleCtrlState;
    s = reduceDoubleCtrlKeyDown(s, 'Control', true, false, false, true);
    s = reduceDoubleCtrlKeyDown(s, 't', true, false, false, true);
    ({state: s} = reduceDoubleCtrlKeyUp(s, 100, 't', false, false, false, false));
    const afterCtrl = reduceDoubleCtrlKeyUp(s, 150, 'Control', false, false, false, false);
    expect(afterCtrl.shouldOpen).toBe(false);
    expect(afterCtrl.state).toEqual({lastCtrlUpAt: null, suppressNextBareCtrlUp: false});

    const lone = reduceDoubleCtrlKeyUp(
      afterCtrl.state,
      200,
      'Control',
      false,
      false,
      false,
      false,
    );
    expect(lone.shouldOpen).toBe(false);
    expect(lone.state.lastCtrlUpAt).toBe(200);

    const second = reduceDoubleCtrlKeyUp(
      lone.state,
      250,
      'Control',
      false,
      false,
      false,
      false,
    );
    expect(second.shouldOpen).toBe(true);
  });
});

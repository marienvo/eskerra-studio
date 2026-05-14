import {describe, expect, it} from 'vitest';

import {
  clampSplitTopHeightPx,
  shouldPersistVerticalSplitTopHeightClamp,
} from './desktopVerticalSplitClamp';

describe('shouldPersistVerticalSplitTopHeightClamp', () => {
  it('returns false when max top slot is below min top (degenerate)', () => {
    expect(shouldPersistVerticalSplitTopHeightClamp(0, 20, 560)).toBe(false);
    expect(shouldPersistVerticalSplitTopHeightClamp(19, 20, 560)).toBe(false);
  });

  it('returns false when stored height does not fit and maxH is barely above reference (transient squeeze)', () => {
    expect(shouldPersistVerticalSplitTopHeightClamp(129, 20, 560)).toBe(false);
  });

  it('returns true when maxH is well above reference so clamp should persist', () => {
    expect(shouldPersistVerticalSplitTopHeightClamp(200, 20, 560)).toBe(true);
  });

  it('returns true when stored height fits', () => {
    expect(shouldPersistVerticalSplitTopHeightClamp(400, 20, 280)).toBe(true);
  });

  it('returns false when a huge downward clamp hits a still-small maxH (transient parent height)', () => {
    expect(shouldPersistVerticalSplitTopHeightClamp(289, 20, 910)).toBe(false);
  });

  it('returns true when shrinking to fit a genuinely smaller window (moderate drop)', () => {
    expect(shouldPersistVerticalSplitTopHeightClamp(375, 20, 600)).toBe(true);
  });
});

describe('clampSplitTopHeightPx', () => {
  const softMaxPx = 10_000;

  it('clamps to min, soft max, and container', () => {
    expect(clampSplitTopHeightPx(280, 20, softMaxPx, 800, 5, 20)).toBe(280);
    expect(clampSplitTopHeightPx(900, 20, softMaxPx, 800, 5, 20)).toBe(775);
    expect(clampSplitTopHeightPx(10, 20, softMaxPx, 800, 5, 20)).toBe(20);
  });

  it('applies configured max top when above container limit', () => {
    expect(clampSplitTopHeightPx(900, 20, 400, 800, 5, 20)).toBe(400);
  });

  it('shrinks when container is short', () => {
    expect(clampSplitTopHeightPx(280, 20, softMaxPx, 300, 5, 20)).toBe(275);
  });
});

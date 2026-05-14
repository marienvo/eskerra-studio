import {describe, expect, it} from 'vitest';

import {
  clampSplitLeftWidthPx,
  clampSplitRightWidthPx,
  shouldPersistLeftSplitWidthClamp,
} from './desktopHorizontalSplitClamp';

describe('clampSplitLeftWidthPx', () => {
  it('clamps to min/max and container', () => {
    expect(clampSplitLeftWidthPx(280, 20, 520, 1200, 13, 20)).toBe(280);
    expect(clampSplitLeftWidthPx(900, 20, 520, 1200, 13, 20)).toBe(520);
    expect(clampSplitLeftWidthPx(10, 20, 520, 1200, 13, 20)).toBe(20);
  });

  it('shrinks when container is narrow', () => {
    expect(clampSplitLeftWidthPx(280, 20, 520, 300, 13, 20)).toBe(267);
  });
});

describe('shouldPersistLeftSplitWidthClamp', () => {
  it('returns false when available space is below min left (transient or degenerate)', () => {
    expect(shouldPersistLeftSplitWidthClamp(0, 20)).toBe(false);
    expect(shouldPersistLeftSplitWidthClamp(19, 20)).toBe(false);
  });

  it('returns true when enough space exists to honor min left', () => {
    expect(shouldPersistLeftSplitWidthClamp(20, 20)).toBe(true);
    expect(shouldPersistLeftSplitWidthClamp(400, 20)).toBe(true);
  });
});

describe('clampSplitRightWidthPx', () => {
  it('clamps to min/max and container', () => {
    expect(clampSplitRightWidthPx(280, 20, 480, 1200, 13, 20)).toBe(280);
    expect(clampSplitRightWidthPx(900, 20, 480, 1200, 13, 20)).toBe(480);
    expect(clampSplitRightWidthPx(10, 20, 480, 1200, 13, 20)).toBe(20);
  });

  it('shrinks when container is narrow', () => {
    expect(clampSplitRightWidthPx(280, 20, 480, 240, 13, 20)).toBe(207);
  });
});

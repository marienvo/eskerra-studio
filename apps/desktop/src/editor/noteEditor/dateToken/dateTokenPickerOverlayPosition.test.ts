import {describe, expect, it} from 'vitest';

import {
  clampDateTokenPickerOverlayPosition,
  DATE_TOKEN_PICKER_OVERLAY_GAP_PX,
  DATE_TOKEN_PICKER_OVERLAY_VIEWPORT_PADDING_PX,
} from './dateTokenPickerOverlayPosition';

const SIZE = {width: 280, height: 360};
const VIEWPORT = {width: 1000, height: 700};
const GAP = DATE_TOKEN_PICKER_OVERLAY_GAP_PX;
const PAD = DATE_TOKEN_PICKER_OVERLAY_VIEWPORT_PADDING_PX;

describe('clampDateTokenPickerOverlayPosition', () => {
  it('places the overlay below the anchor when it fits', () => {
    const anchor = {left: 120, top: 200, bottom: 220};

    expect(
      clampDateTokenPickerOverlayPosition(anchor, SIZE, VIEWPORT),
    ).toEqual({
      left: 120,
      top: 220 + GAP,
    });
  });

  it('clamps left when the overlay would overflow the right edge', () => {
    const anchor = {left: 900, top: 200, bottom: 220};

    expect(
      clampDateTokenPickerOverlayPosition(anchor, SIZE, VIEWPORT),
    ).toEqual({
      left: VIEWPORT.width - SIZE.width - PAD,
      top: 220 + GAP,
    });
  });

  it('clamps left when the anchor is past the left edge', () => {
    const anchor = {left: 2, top: 200, bottom: 220};

    expect(
      clampDateTokenPickerOverlayPosition(anchor, SIZE, VIEWPORT),
    ).toEqual({
      left: PAD,
      top: 220 + GAP,
    });
  });

  it('flips above the anchor when the overlay would overflow the bottom edge', () => {
    const anchor = {left: 120, top: 520, bottom: 540};

    expect(
      clampDateTokenPickerOverlayPosition(anchor, SIZE, VIEWPORT),
    ).toEqual({
      left: 120,
      top: anchor.top - SIZE.height - GAP,
    });
  });

  it('clamps top when flipped placement still overflows the top edge', () => {
    const anchor = {left: 120, top: 40, bottom: 60};
    const viewport = {width: 1000, height: 200};

    expect(
      clampDateTokenPickerOverlayPosition(anchor, SIZE, viewport),
    ).toEqual({
      left: 120,
      top: PAD,
    });
  });
});

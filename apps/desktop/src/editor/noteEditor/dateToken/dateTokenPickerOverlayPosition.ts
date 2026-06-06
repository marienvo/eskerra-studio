export const DATE_TOKEN_PICKER_OVERLAY_GAP_PX = 6;
export const DATE_TOKEN_PICKER_OVERLAY_VIEWPORT_PADDING_PX = 8;

export type DateTokenPickerOverlayAnchor = {
  readonly left: number;
  readonly top: number;
  readonly bottom: number;
};

export type DateTokenPickerOverlaySize = {
  readonly width: number;
  readonly height: number;
};

export type DateTokenPickerOverlayViewport = {
  readonly width: number;
  readonly height: number;
};

export type DateTokenPickerOverlayPosition = {
  readonly left: number;
  readonly top: number;
};

export function clampDateTokenPickerOverlayPosition(
  anchor: DateTokenPickerOverlayAnchor,
  size: DateTokenPickerOverlaySize,
  viewport: DateTokenPickerOverlayViewport,
  options: {
    gapPx?: number;
    paddingPx?: number;
  } = {},
): DateTokenPickerOverlayPosition {
  const gap = options.gapPx ?? DATE_TOKEN_PICKER_OVERLAY_GAP_PX;
  const padding =
    options.paddingPx ?? DATE_TOKEN_PICKER_OVERLAY_VIEWPORT_PADDING_PX;

  const maxLeft = Math.max(padding, viewport.width - size.width - padding);
  const left = Math.min(Math.max(anchor.left, padding), maxLeft);

  const belowTop = anchor.bottom + gap;
  const aboveTop = anchor.top - size.height - gap;
  const maxTop = Math.max(padding, viewport.height - size.height - padding);

  let top = belowTop;
  if (belowTop + size.height > viewport.height - padding) {
    top = aboveTop;
  }
  top = Math.min(Math.max(top, padding), maxTop);

  return {left, top};
}

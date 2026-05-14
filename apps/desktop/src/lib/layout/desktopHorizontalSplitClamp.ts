/**
 * Horizontal split: fixed left | separator | flexible **center workspace** (editor).
 * `minCenterPx` is the minimum width reserved for the center column when clamping the left width.
 */

/**
 * Max CSS pixels available for the left column given container width and a minimum center reserve.
 * Matches the `maxW` step inside {@link clampSplitLeftWidthPx}.
 */
export function maxAvailableLeftWidthPx(
  containerInnerWidthPx: number,
  separatorWidthPx: number,
  minCenterPx: number,
): number {
  return Math.max(
    0,
    Math.floor(containerInnerWidthPx - separatorWidthPx - minCenterPx),
  );
}

/**
 * When the space available for the left column is below `minLeftPx`, the clamp result is
 * dominated by the minimum width — often a transient layout (parent not yet sized) or a
 * degenerately narrow window. Avoid persisting that clamp so we do not overwrite the
 * user's stored width before the real container size is known.
 */
export function shouldPersistLeftSplitWidthClamp(
  maxAvailableLeftPx: number,
  minLeftPx: number,
): boolean {
  return maxAvailableLeftPx >= minLeftPx;
}

export function clampSplitLeftWidthPx(
  px: number,
  minLeftPx: number,
  maxLeftPx: number,
  containerInnerWidthPx: number,
  separatorWidthPx: number,
  minCenterPx: number,
): number {
  const maxW = maxAvailableLeftWidthPx(
    containerInnerWidthPx,
    separatorWidthPx,
    minCenterPx,
  );
  let w = Math.round(px);
  w = Math.min(maxLeftPx, w);
  w = Math.min(w, maxW);
  w = Math.max(minLeftPx, w);
  return w;
}

/**
 * Clamp **end** fixed column width (px): flex main | separator | end.
 * Used when the resizable panel is on the **right** (main fills remaining space).
 */
export function clampSplitRightWidthPx(
  px: number,
  minRightPx: number,
  maxRightPx: number,
  containerInnerWidthPx: number,
  separatorWidthPx: number,
  minMainPx: number,
): number {
  const maxW = Math.max(
    0,
    Math.floor(containerInnerWidthPx - separatorWidthPx - minMainPx),
  );
  let w = Math.round(px);
  w = Math.min(maxRightPx, w);
  w = Math.min(w, maxW);
  w = Math.max(minRightPx, w);
  return w;
}

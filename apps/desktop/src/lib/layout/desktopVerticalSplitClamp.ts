/**
 * Vertical split: top | separator | bottom.
 * Bottom pane is flexible; `minBottomPx` is a minimum reserve for the bottom pane.
 */

/**
 * Max CSS pixels available for the top pane given container height and a minimum bottom reserve.
 * Matches the `maxH` step inside {@link clampSplitTopHeightPx}.
 */
export function maxAvailableTopHeightPx(
  containerInnerHeightPx: number,
  separatorHeightPx: number,
  minBottomPx: number,
): number {
  return Math.max(
    0,
    Math.floor(containerInnerHeightPx - separatorHeightPx - minBottomPx),
  );
}

/**
 * Whether to persist a clamped top height. Skips degenerate measurements (same idea as the
 * horizontal split `shouldPersistLeftSplitWidthClamp`) and transient squeezes: when the stored height does
 * not fit (`storedTopPx > maxH`) but `maxH` is only slightly above a **reference** height, the layout
 * is often not final yet (parent still settling). The squeeze band must **not** use `minTopPx` for
 * that comparison: lowering `minTopPx` to 20 would make `maxH - minTop` almost always large and would
 * persist premature clamps, wiping the saved split on disk.
 */
/** Legacy "typical" top minimum (px); squeeze is detected vs this, not the live `minTopPx` (e.g. 20). */
export const TRANSIENT_VSPLIT_TOP_REFERENCE_MIN_PX = 120;

/** Margin above {@link TRANSIENT_VSPLIT_TOP_REFERENCE_MIN_PX} for the squeeze band. */
export const TRANSIENT_VSPLIT_TOP_SQUEEZE_MAX_PX = 12;

/**
 * If the stored top is much larger than `maxH` and `maxH` is still small, the parent column often
 * has not reached its final height yet (first layout / paint). Persisting would overwrite disk with
 * a bogus value (e.g. stored 910, maxH 289 while the column is still ~314px tall).
 */
export const TRANSIENT_VSPLIT_LARGE_DROP_MIN_PX = 500;

/** When `maxH` is below this, treat large drops as possibly transient (not a real small window). */
export const TRANSIENT_VSPLIT_SMALL_MAX_TOP_PX = 350;

export function shouldPersistVerticalSplitTopHeightClamp(
  maxAvailableTopPx: number,
  minTopPx: number,
  storedTopPx: number,
): boolean {
  if (maxAvailableTopPx < minTopPx) {
    return false;
  }
  if (
    storedTopPx > maxAvailableTopPx &&
    storedTopPx - maxAvailableTopPx > TRANSIENT_VSPLIT_LARGE_DROP_MIN_PX &&
    maxAvailableTopPx < TRANSIENT_VSPLIT_SMALL_MAX_TOP_PX
  ) {
    return false;
  }
  if (
    storedTopPx > maxAvailableTopPx &&
    maxAvailableTopPx - TRANSIENT_VSPLIT_TOP_REFERENCE_MIN_PX <=
      TRANSIENT_VSPLIT_TOP_SQUEEZE_MAX_PX
  ) {
    return false;
  }
  return true;
}

export function clampSplitTopHeightPx(
  px: number,
  minTopPx: number,
  maxTopPx: number,
  containerInnerHeightPx: number,
  separatorHeightPx: number,
  minBottomPx: number,
): number {
  const maxH = maxAvailableTopHeightPx(
    containerInnerHeightPx,
    separatorHeightPx,
    minBottomPx,
  );
  let h = Math.round(px);
  h = Math.min(maxTopPx, h);
  h = Math.min(h, maxH);
  h = Math.max(minTopPx, h);
  return h;
}

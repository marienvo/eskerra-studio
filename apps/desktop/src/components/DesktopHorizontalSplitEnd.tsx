import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import {clampSplitRightWidthPx} from '../lib/layout/desktopHorizontalSplitClamp';

export type DesktopHorizontalSplitEndProps = {
  /** Current end column width in CSS pixels (shell end column: notifications ± inbox tree; not the rail). */
  endWidthPx: number;
  minEndPx: number;
  maxEndPx: number;
  /** Minimum width reserved for the flex **main** column (left of the separator). */
  minMainPx?: number;
  onEndWidthPxChanged: (px: number) => void;
  main: ReactNode;
  /** Shell end column (notifications and/or inbox tree). Hidden when `endVisible` is false. */
  end: ReactNode;
  endVisible: boolean;
  className?: string;
};

/**
 * Main (flex) | separator | end (fixed px). Drag the separator to resize the end column;
 * mirrors {@link DesktopHorizontalSplit} for a **trailing** fixed-width shell column (after the center workspace).
 */
export function DesktopHorizontalSplitEnd({
  endWidthPx,
  minEndPx,
  maxEndPx,
  minMainPx = 280,
  onEndWidthPxChanged,
  main,
  end,
  endVisible,
  className,
}: DesktopHorizontalSplitEndProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const separatorRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  const dragStartXRef = useRef(0);
  const dragStartWidthRef = useRef(0);
  const latestDragWidthRef = useRef<number | null>(null);

  const [dragWidthPx, setDragWidthPx] = useState<number | null>(null);
  const displayEndPx = dragWidthPx ?? endWidthPx;

  const measureAndClamp = useCallback(() => {
    const container = containerRef.current;
    const sep = separatorRef.current;
    if (!container || !sep || !endVisible) {
      return;
    }
    const cw = container.clientWidth;
    const sepW = sep.offsetWidth;
    if (cw <= 0) {
      return;
    }
    const next = clampSplitRightWidthPx(
      endWidthPx,
      minEndPx,
      maxEndPx,
      cw,
      sepW,
      minMainPx,
    );
    if (next !== endWidthPx) {
      onEndWidthPxChanged(next);
    }
  }, [endVisible, endWidthPx, maxEndPx, minEndPx, minMainPx, onEndWidthPxChanged]);

  useLayoutEffect(() => {
    measureAndClamp();
  }, [measureAndClamp]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) {
      return;
    }
    const ro = new ResizeObserver(() => {
      if (draggingRef.current) {
        return;
      }
      measureAndClamp();
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, [measureAndClamp]);

  const onSeparatorPointerDown = useCallback(
    (e: {
      button: number;
      clientX: number;
      currentTarget: HTMLDivElement;
      pointerId: number;
      preventDefault: () => void;
    }) => {
      if (e.button !== 0) {
        return;
      }
      e.preventDefault();
      draggingRef.current = true;
      dragStartXRef.current = e.clientX;
      dragStartWidthRef.current = endWidthPx;
      latestDragWidthRef.current = endWidthPx;
      setDragWidthPx(endWidthPx);
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [endWidthPx],
  );

  const onSeparatorPointerMove = useCallback(
    (e: {clientX: number}) => {
      if (!draggingRef.current) {
        return;
      }
      const container = containerRef.current;
      const sep = separatorRef.current;
      if (!container || !sep) {
        return;
      }
      const delta = dragStartXRef.current - e.clientX;
      const cw = container.clientWidth;
      const sepW = sep.offsetWidth;
      const next = clampSplitRightWidthPx(
        dragStartWidthRef.current + delta,
        minEndPx,
        maxEndPx,
        cw,
        sepW,
        minMainPx,
      );
      latestDragWidthRef.current = next;
      setDragWidthPx(next);
    },
    [maxEndPx, minEndPx, minMainPx],
  );

  const endDrag = useCallback(
    (e: {currentTarget: HTMLDivElement; pointerId: number}) => {
      if (!draggingRef.current) {
        return;
      }
      draggingRef.current = false;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      const w = latestDragWidthRef.current ?? dragStartWidthRef.current;
      latestDragWidthRef.current = null;
      setDragWidthPx(null);
      if (Number.isFinite(w)) {
        onEndWidthPxChanged(Math.round(w));
      }
    },
    [onEndWidthPxChanged],
  );

  const rootClass = ['main-end-split', className].filter(Boolean).join(' ');

  return (
    <div
      ref={containerRef}
      className={rootClass}
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'stretch',
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        gap: 0,
      }}
    >
      <div
        className="main-end-split__main"
        style={{
          flex: '1 1 0',
          minWidth: 0,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {main}
      </div>
      {endVisible ? (
        <>
          <div
            ref={separatorRef}
            className="resize-sep resize-sep--canvas"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize panels"
            onPointerDown={onSeparatorPointerDown}
            onPointerMove={onSeparatorPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          />
          <div
            className="main-end-split__end desktop-hsplit-end-pane"
            style={{
              flex: `0 0 ${displayEndPx}px`,
              width: displayEndPx,
              minHeight: 0,
              minWidth: 0,
              maxWidth: displayEndPx,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            {end}
          </div>
        </>
      ) : null}
    </div>
  );
}

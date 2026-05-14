import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import {
  clampSplitTopHeightPx,
  maxAvailableTopHeightPx,
  shouldPersistVerticalSplitTopHeightClamp,
} from '../lib/layout/desktopVerticalSplitClamp';
import {MIN_RESIZABLE_PANE_PX} from '../lib/layout/layoutStore';

export type DesktopVerticalSplitProps = {
  /** Current top pane height in CSS pixels (controlled by parent). */
  topHeightPx: number;
  minTopPx: number;
  maxTopPx: number;
  /** Minimum height reserved for the bottom pane. */
  minBottomPx?: number;
  onTopHeightPxChanged: (px: number) => void;
  top: ReactNode;
  bottom: ReactNode;
  className?: string;
  /**
   * When true, only the top pane renders at flex height with no separator and no bottom pane.
   * Keeps the top React subtree stable when toggling an optional bottom pane (e.g. Inbox tree).
   */
  bottomCollapsed?: boolean;
  /**
   * When true, only the bottom pane renders at flex height with no separator and no top pane.
   * Use when the top region is hidden but the bottom must stay mounted (e.g. Inbox-only shell column).
   */
  topCollapsed?: boolean;
};

/**
 * App-owned vertical split: fixed-px top row, flex bottom row.
 * Mirrors {@link DesktopHorizontalSplit} for the Vault + Episodes stack.
 *
 * **`topCollapsed` and `bottomCollapsed` must not both be true.** Callers should only mount this
 * split when at least one child is needed (e.g. shell end column visible) so at most one flag is true.
 * If both were true, this component evaluates `bottomCollapsed` first and would render only the top
 * subtree.
 */
export function DesktopVerticalSplit({
  topHeightPx,
  minTopPx,
  maxTopPx,
  minBottomPx = MIN_RESIZABLE_PANE_PX,
  onTopHeightPxChanged,
  top,
  bottom,
  className,
  bottomCollapsed = false,
  topCollapsed = false,
}: DesktopVerticalSplitProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const separatorRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  const dragStartYRef = useRef(0);
  const dragStartHeightRef = useRef(0);
  const latestDragHeightRef = useRef<number | null>(null);

  const [dragHeightPx, setDragHeightPx] = useState<number | null>(null);
  const displayTopPx = bottomCollapsed ? 0 : (dragHeightPx ?? topHeightPx);

  useEffect(() => {
    if (!bottomCollapsed && !topCollapsed) {
      return;
    }
    draggingRef.current = false;
    latestDragHeightRef.current = null;
    const id = window.requestAnimationFrame(() => {
      setDragHeightPx(null);
    });
    return () => {
      window.cancelAnimationFrame(id);
    };
  }, [bottomCollapsed, topCollapsed]);

  const measureAndClamp = useCallback(() => {
    if (bottomCollapsed || topCollapsed) {
      return;
    }
    const container = containerRef.current;
    const sep = separatorRef.current;
    if (!container || !sep) {
      return;
    }
    const ch = container.clientHeight;
    const sepH = sep.offsetHeight;
    if (ch <= 0) {
      return;
    }
    const maxH = maxAvailableTopHeightPx(ch, sepH, minBottomPx);
    const next = clampSplitTopHeightPx(
      topHeightPx,
      minTopPx,
      maxTopPx,
      ch,
      sepH,
      minBottomPx,
    );
    if (next !== topHeightPx) {
      if (!shouldPersistVerticalSplitTopHeightClamp(maxH, minTopPx, topHeightPx)) {
        return;
      }
      onTopHeightPxChanged(next);
    }
  }, [
    bottomCollapsed,
    topCollapsed,
    topHeightPx,
    minTopPx,
    maxTopPx,
    minBottomPx,
    onTopHeightPxChanged,
  ]);

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
      clientY: number;
      currentTarget: HTMLDivElement;
      pointerId: number;
      preventDefault: () => void;
    }) => {
      if (bottomCollapsed || topCollapsed || e.button !== 0) {
        return;
      }
      e.preventDefault();
      draggingRef.current = true;
      dragStartYRef.current = e.clientY;
      dragStartHeightRef.current = topHeightPx;
      latestDragHeightRef.current = topHeightPx;
      setDragHeightPx(topHeightPx);
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [bottomCollapsed, topCollapsed, topHeightPx],
  );

  const onSeparatorPointerMove = useCallback(
    (e: {clientY: number}) => {
      if (bottomCollapsed || topCollapsed || !draggingRef.current) {
        return;
      }
      const container = containerRef.current;
      const sep = separatorRef.current;
      if (!container || !sep) {
        return;
      }
      const delta = e.clientY - dragStartYRef.current;
      const ch = container.clientHeight;
      const sepH = sep.offsetHeight;
      const next = clampSplitTopHeightPx(
        dragStartHeightRef.current + delta,
        minTopPx,
        maxTopPx,
        ch,
        sepH,
        minBottomPx,
      );
      latestDragHeightRef.current = next;
      setDragHeightPx(next);
    },
    [bottomCollapsed, topCollapsed, minTopPx, maxTopPx, minBottomPx],
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
      const h = latestDragHeightRef.current ?? dragStartHeightRef.current;
      latestDragHeightRef.current = null;
      setDragHeightPx(null);
      if (Number.isFinite(h)) {
        onTopHeightPxChanged(Math.round(h));
      }
    },
    [onTopHeightPxChanged],
  );

  const rootClass = ['desktop-vsplit', className].filter(Boolean).join(' ');

  if (bottomCollapsed) {
    return (
      <div
        ref={containerRef}
        className={rootClass}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'stretch',
          flex: 1,
          minHeight: 0,
          minWidth: 0,
        }}
      >
        <div
          className="desktop-vsplit-top"
          style={{
            flex: '1 1 0',
            minHeight: 0,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {top}
        </div>
      </div>
    );
  }

  if (topCollapsed) {
    return (
      <div
        ref={containerRef}
        className={rootClass}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'stretch',
          flex: 1,
          minHeight: 0,
          minWidth: 0,
        }}
      >
        <div
          className="desktop-vsplit-bottom"
          style={{
            flex: '1 1 0',
            minHeight: 0,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {bottom}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={rootClass}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        flex: 1,
        minHeight: 0,
        minWidth: 0,
      }}
    >
      <div
        className="desktop-vsplit-top"
        style={{
          flex: `0 0 ${displayTopPx}px`,
          height: displayTopPx,
          minHeight: 0,
          minWidth: 0,
          maxHeight: displayTopPx,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {top}
      </div>
      <div
        ref={separatorRef}
        className="resize-sep resize-sep--row resize-sep--canvas"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize panels"
        onPointerDown={onSeparatorPointerDown}
        onPointerMove={onSeparatorPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      />
      <div
        className="desktop-vsplit-bottom"
        style={{
          flex: '1 1 0',
          minHeight: 0,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {bottom}
      </div>
    </div>
  );
}

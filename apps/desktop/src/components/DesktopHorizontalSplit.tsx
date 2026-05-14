import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import {
  clampSplitLeftWidthPx,
  maxAvailableLeftWidthPx,
  shouldPersistLeftSplitWidthClamp,
} from '../lib/layout/desktopHorizontalSplitClamp';
import {MIN_RESIZABLE_PANE_PX} from '../lib/layout/layoutStore';

export type DesktopHorizontalSplitProps = {
  /** Current left column width in CSS pixels (controlled by parent). */
  leftWidthPx: number;
  minLeftPx: number;
  maxLeftPx: number;
  /** Minimum width reserved for the center workspace column (editor stage; approximates former %-min). */
  minCenterWorkspacePx?: number;
  onLeftWidthPxChanged: (px: number) => void;
  left: ReactNode;
  /** Main editor workspace (between the left rail and the optional shell end column). */
  centerWorkspace: ReactNode;
  className?: string;
  /**
   * When true, the left column renders at 0px with no separator and width clamp/persist is
   * skipped so stored widths are not overwritten. Used when both Vault and Episodes are hidden.
   */
  leftCollapsed?: boolean;
};

/**
 * App-owned horizontal split: fixed-px left column, flex **center workspace** column.
 * Avoids react-resizable-panels percentage remapping jitter on window resize.
 */
export function DesktopHorizontalSplit({
  leftWidthPx,
  minLeftPx,
  maxLeftPx,
  minCenterWorkspacePx = MIN_RESIZABLE_PANE_PX,
  onLeftWidthPxChanged,
  left,
  centerWorkspace,
  className,
  leftCollapsed = false,
}: DesktopHorizontalSplitProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const separatorRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  const dragStartXRef = useRef(0);
  const dragStartWidthRef = useRef(0);
  const latestDragWidthRef = useRef<number | null>(null);

  /** Local width while dragging so the parent debounce does not lag the handle. */
  const [dragWidthPx, setDragWidthPx] = useState<number | null>(null);
  const displayLeftPx = leftCollapsed ? 0 : (dragWidthPx ?? leftWidthPx);

  useEffect(() => {
    if (!leftCollapsed) {
      return;
    }
    draggingRef.current = false;
    latestDragWidthRef.current = null;
    const id = window.requestAnimationFrame(() => {
      setDragWidthPx(null);
    });
    return () => {
      window.cancelAnimationFrame(id);
    };
  }, [leftCollapsed]);

  const measureAndClamp = useCallback(() => {
    if (leftCollapsed) {
      return;
    }
    const container = containerRef.current;
    const sep = separatorRef.current;
    if (!container || !sep) {
      return;
    }
    const cw = container.clientWidth;
    const sepW = sep.offsetWidth;
    if (cw <= 0) {
      return;
    }
    const maxW = maxAvailableLeftWidthPx(cw, sepW, minCenterWorkspacePx);
    const next = clampSplitLeftWidthPx(
      leftWidthPx,
      minLeftPx,
      maxLeftPx,
      cw,
      sepW,
      minCenterWorkspacePx,
    );
    if (next !== leftWidthPx) {
      if (!shouldPersistLeftSplitWidthClamp(maxW, minLeftPx)) {
        return;
      }
      onLeftWidthPxChanged(next);
    }
  }, [
    leftCollapsed,
    leftWidthPx,
    minLeftPx,
    maxLeftPx,
    minCenterWorkspacePx,
    onLeftWidthPxChanged,
  ]);

  useLayoutEffect(() => {
    measureAndClamp();
  }, [measureAndClamp]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || leftCollapsed) {
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
  }, [leftCollapsed, measureAndClamp]);

  const onSeparatorPointerDown = useCallback(
    (e: {button: number; clientX: number; currentTarget: HTMLDivElement; pointerId: number; preventDefault: () => void}) => {
      if (leftCollapsed) {
        return;
      }
      if (e.button !== 0) {
        return;
      }
      e.preventDefault();
      draggingRef.current = true;
      dragStartXRef.current = e.clientX;
      dragStartWidthRef.current = leftWidthPx;
      latestDragWidthRef.current = leftWidthPx;
      setDragWidthPx(leftWidthPx);
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [leftCollapsed, leftWidthPx],
  );

  const onSeparatorPointerMove = useCallback(
    (e: {clientX: number}) => {
      if (leftCollapsed || !draggingRef.current) {
        return;
      }
      const container = containerRef.current;
      const sep = separatorRef.current;
      if (!container || !sep) {
        return;
      }
      const delta = e.clientX - dragStartXRef.current;
      const cw = container.clientWidth;
      const sepW = sep.offsetWidth;
      const next = clampSplitLeftWidthPx(
        dragStartWidthRef.current + delta,
        minLeftPx,
        maxLeftPx,
        cw,
        sepW,
        minCenterWorkspacePx,
      );
      latestDragWidthRef.current = next;
      setDragWidthPx(next);
    },
    [leftCollapsed, minLeftPx, maxLeftPx, minCenterWorkspacePx],
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
        onLeftWidthPxChanged(Math.round(w));
      }
    },
    [onLeftWidthPxChanged],
  );

  const rootClass = ['panel-group', 'fill', className].filter(Boolean).join(' ');

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
      }}
    >
      <div
        className="desktop-hsplit-left"
        style={{
          flex: `0 0 ${displayLeftPx}px`,
          width: displayLeftPx,
          minHeight: 0,
          minWidth: 0,
          maxWidth: displayLeftPx,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {left}
      </div>
      {leftCollapsed ? null : (
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
      )}
      <div
        className="desktop-hsplit-center-workspace"
        style={{
          flex: '1 1 0',
          minWidth: 0,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {centerWorkspace}
      </div>
    </div>
  );
}

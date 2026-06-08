import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';

import {DateTimePicker} from './DateTimePicker';
import type {DateTimePickerProps} from './dateTimePicker/types';
import type {DateTokenValue} from './dateToken';
import {
  clampDateTokenPickerOverlayPosition,
  DATE_TOKEN_PICKER_OVERLAY_GAP_PX,
  type DateTokenPickerOverlayAnchor,
  type DateTokenPickerOverlayPosition,
} from './dateTokenPickerOverlayPosition';

export type DateTokenPickerOverlayProps = {
  readonly anchorRect: DateTokenPickerOverlayAnchor;
  readonly initialValue: DateTokenValue | null;
  readonly onConfirm: (value: DateTokenValue) => void;
  readonly onReturnFocus?: () => void;
  readonly onCancel: () => void;
  readonly onStrikeRequest?: DateTimePickerProps['onStrikeRequest'];
  readonly now?: Date;
};

export function DateTokenPickerOverlay({
  anchorRect,
  initialValue,
  onConfirm,
  onReturnFocus,
  onCancel,
  onStrikeRequest,
  now,
}: DateTokenPickerOverlayProps) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const onCancelRef = useRef(onCancel);
  useLayoutEffect(() => {
    onCancelRef.current = onCancel;
  }, [onCancel]);
  const [position, setPosition] = useState<DateTokenPickerOverlayPosition | null>(
    null,
  );

  useLayoutEffect(() => {
    const measureAndClamp = () => {
      const overlay = overlayRef.current;
      if (!overlay) {
        return;
      }
      const {width, height} = overlay.getBoundingClientRect();
      setPosition(
        clampDateTokenPickerOverlayPosition(
          anchorRect,
          {width, height},
          {width: window.innerWidth, height: window.innerHeight},
        ),
      );
    };

    measureAndClamp();

    const overlay = overlayRef.current;
    let resizeObserver: ResizeObserver | null = null;
    if (overlay && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(measureAndClamp);
      resizeObserver.observe(overlay);
    }
    window.addEventListener('resize', measureAndClamp);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', measureAndClamp);
    };
  }, [anchorRect]);

  useEffect(() => {
    const onDocumentPointerDown = (event: PointerEvent) => {
      const overlay = overlayRef.current;
      if (!overlay) {
        return;
      }
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (overlay.contains(target)) {
        return;
      }
      onCancelRef.current();
    };
    document.addEventListener('pointerdown', onDocumentPointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', onDocumentPointerDown, true);
    };
  }, []);

  useEffect(() => {
    const onDocumentKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onCancelRef.current();
      }
    };
    document.addEventListener('keydown', onDocumentKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onDocumentKeyDown, true);
    };
  }, []);

  return createPortal(
    <div
      ref={overlayRef}
      data-date-token-picker-overlay
      style={{
        position: 'fixed',
        left: position?.left ?? anchorRect.left,
        top:
          position?.top
          ?? anchorRect.bottom + DATE_TOKEN_PICKER_OVERLAY_GAP_PX,
        zIndex: 320,
      }}
    >
      <DateTimePicker
        initialValue={initialValue}
        onConfirm={onConfirm}
        onReturnFocus={onReturnFocus}
        onCancel={onCancel}
        onStrikeRequest={onStrikeRequest}
        now={now}
      />
    </div>,
    document.body,
  );
}

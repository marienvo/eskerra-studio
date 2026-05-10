import {useRef, useState} from 'react';

import {formatPlaybackMs} from '../lib/formatPlaybackMs';

/** Suppress duplicate `onSeek` from a stray `change` right after pointer-driven commit (browser/React timing). */
const POINTER_SEEK_CHANGE_DEDUPE_MS = 80;

export type NowPlayingProgressSliderProps = {
  positionMs: number;
  durationMs: number;
  disabled: boolean;
  onSeek: (ms: number) => void;
  ariaLabel?: string;
};

/**
 * Native range control for desktop now-playing scrubbing.
 * Pointer release commits on `pointerup` / `pointercancel`. Keyboard and other non-pointer updates
 * commit via `onChange`. React maps `onChange` on range inputs to `input`, so there is no separate
 * deferred `change` after release; a short post-pointer dedupe window avoids double `onSeek` if a
 * stray `change` still arrives.
 */
export function NowPlayingProgressSlider({
  positionMs,
  durationMs,
  disabled: disabledProp,
  onSeek,
  ariaLabel = 'Playback progress',
}: NowPlayingProgressSliderProps) {
  const maxMs = Math.max(0, durationMs);
  const hardDisabled = disabledProp || maxMs <= 0;
  const [dragging, setDragging] = useState(false);
  const [dragMs, setDragMs] = useState(0);
  const scrubbingRef = useRef(false);
  const pendingMsRef = useRef(0);
  const scrubOriginMsRef = useRef(0);
  const lastPointerDrivenSeekAtRef = useRef(0);

  let displayMs: number;
  if (hardDisabled) {
    displayMs = 0;
  } else if (dragging) {
    displayMs = Math.min(maxMs, Math.max(0, dragMs));
  } else {
    displayMs = Math.min(maxMs, Math.max(0, positionMs));
  }

  const ariaValueText =
    hardDisabled || maxMs <= 0
      ? undefined
      : `${formatPlaybackMs(displayMs)} of ${formatPlaybackMs(maxMs)}`;

  const applyPendingToState = (raw: number) => {
    const v = Math.min(maxMs, Math.max(0, raw));
    pendingMsRef.current = v;
    setDragMs(v);
    setDragging(true);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLInputElement>) => {
    if (hardDisabled) {
      return;
    }
    scrubbingRef.current = true;
    scrubOriginMsRef.current = Math.min(maxMs, Math.max(0, positionMs));
    applyPendingToState(Number(e.currentTarget.value));
  };

  const finishScrubIfNeeded = () => {
    if (!scrubbingRef.current) {
      return;
    }
    scrubbingRef.current = false;
    setDragging(false);
    const pending = pendingMsRef.current;
    if (pending !== scrubOriginMsRef.current) {
      onSeek(pending);
      lastPointerDrivenSeekAtRef.current = Date.now();
    }
  };

  const handleInput = (e: React.FormEvent<HTMLInputElement>) => {
    if (hardDisabled) {
      return;
    }
    applyPendingToState(Number(e.currentTarget.value));
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (hardDisabled) {
      return;
    }
    applyPendingToState(Number(e.currentTarget.value));
    if (!scrubbingRef.current) {
      setDragging(false);
      if (Date.now() - lastPointerDrivenSeekAtRef.current < POINTER_SEEK_CHANGE_DEDUPE_MS) {
        return;
      }
      const next = pendingMsRef.current;
      const cur = Math.min(maxMs, Math.max(0, positionMs));
      if (next !== cur) {
        onSeek(next);
      }
    }
  };

  return (
    <span className="now-playing-progress-slider">
      <input
        aria-label={ariaLabel}
        aria-valuetext={ariaValueText}
        className="now-playing-progress-slider__input"
        disabled={hardDisabled}
        max={maxMs}
        min={0}
        onChange={handleChange}
        onInput={handleInput}
        onPointerCancel={finishScrubIfNeeded}
        onPointerDown={handlePointerDown}
        onPointerUp={finishScrubIfNeeded}
        step={5000}
        type="range"
        value={displayMs}
      />
    </span>
  );
}

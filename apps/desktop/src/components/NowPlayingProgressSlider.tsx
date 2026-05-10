import {useRef, useState} from 'react';

import {formatPlaybackMs} from '../lib/formatPlaybackMs';

export type NowPlayingProgressSliderProps = {
  positionMs: number;
  durationMs: number;
  disabled: boolean;
  onSeek: (ms: number) => void;
  ariaLabel?: string;
};

/**
 * Native range control for desktop now-playing scrubbing.
 * Pointer drags commit on release; keyboard and simple clicks commit via `change` when not scrubbing.
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
    applyPendingToState(Number(e.currentTarget.value));
  };

  const finishScrubIfNeeded = () => {
    if (!scrubbingRef.current) {
      return;
    }
    scrubbingRef.current = false;
    setDragging(false);
    onSeek(pendingMsRef.current);
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
      onSeek(pendingMsRef.current);
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
        step={1000}
        type="range"
        value={displayMs}
      />
    </span>
  );
}

/**
 * GNOME / MPRIS integration via WebKitGTK's `navigator.mediaSession` (single player entry).
 * No-ops when `mediaSession` is missing (non-browser or unsupported runtime).
 */

import {buildMediaSessionArtwork} from './desktopMediaSessionArtwork';
import {
  clearDesktopMediaSession as clearDesktopMediaSessionDom,
  getMediaSession,
  __resetDesktopMediaSessionForTests as resetDomForTests,
} from './desktopMediaSessionDom';

export type DesktopMediaSessionPlaybackState = 'playing' | 'paused' | 'none';

export {clearDesktopMediaSessionDom as clearDesktopMediaSession};
export {resetDomForTests as __resetDesktopMediaSessionForTests};
export {buildMediaSessionArtwork, resolveArtworkSrcForMediaSession} from './desktopMediaSessionArtwork';

export function setDesktopMediaSessionMetadata(params: {
  title: string;
  artist: string;
  artworkUrl?: string | null;
}): void {
  const ms = getMediaSession();
  if (!ms) {
    return;
  }
  const {title, artist, artworkUrl} = params;
  const artwork = buildMediaSessionArtwork(artworkUrl);
  try {
    ms.metadata = new MediaMetadata({
      title,
      artist,
      artwork,
    });
  } catch {
    /* ignore */
  }
}

function isValidPositionState(durationMs: number, positionMs: number): boolean {
  return (
    Number.isFinite(durationMs) &&
    durationMs > 0 &&
    Number.isFinite(positionMs) &&
    positionMs >= 0
  );
}

/**
 * Updates MPRIS position when duration and position are known and consistent.
 */
export function setDesktopMediaSessionPositionState(
  positionMs: number,
  durationMs: number,
  playbackRate = 1,
): void {
  const ms = getMediaSession();
  if (!ms?.setPositionState) {
    return;
  }
  if (!isValidPositionState(durationMs, positionMs)) {
    return;
  }
  const durationSec = durationMs / 1000;
  const positionSec = Math.min(durationMs / 1000, positionMs / 1000);
  try {
    ms.setPositionState({
      duration: durationSec,
      position: positionSec,
      playbackRate,
    });
  } catch {
    /* WebKit may throw if inputs are inconsistent */
  }
}

export function setDesktopMediaSessionPlaybackState(
  state: DesktopMediaSessionPlaybackState,
): void {
  const ms = getMediaSession();
  if (!ms) {
    return;
  }
  ms.playbackState = state;
}

/**
 * Applies metadata, playback state, and position (when duration is valid).
 */
export function syncDesktopMediaSessionPlayback(params: {
  title: string;
  artist: string;
  artworkUrl?: string | null;
  durationMs: number | null;
  positionMs: number;
  playing: boolean;
}): void {
  const {title, artist, artworkUrl, durationMs, positionMs, playing} = params;
  setDesktopMediaSessionMetadata({title, artist, artworkUrl});
  setDesktopMediaSessionPlaybackState(playing ? 'playing' : 'paused');
  if (durationMs != null) {
    setDesktopMediaSessionPositionState(positionMs, durationMs);
  }
}

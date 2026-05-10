/**
 * DOM-only MediaSession helpers (no Tauri). Imported from `vitest.setup.ts` for teardown.
 */

export function getMediaSession(): MediaSession | undefined {
  if (typeof navigator === 'undefined') {
    return undefined;
  }
  return navigator.mediaSession;
}

export function clearDesktopMediaSession(): void {
  const ms = getMediaSession();
  if (!ms) {
    return;
  }
  ms.metadata = null;
  ms.playbackState = 'none';
  if (ms.setPositionState) {
    try {
      ms.setPositionState({
        duration: 0,
        position: 0,
        playbackRate: 1,
      });
    } catch {
      /* ignore */
    }
  }
}

/** Vitest: clear session state; safe when `mediaSession` is mocked or missing. */
export function __resetDesktopMediaSessionForTests(): void {
  clearDesktopMediaSession();
}

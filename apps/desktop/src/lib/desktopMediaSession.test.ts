import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {
  clearDesktopMediaSession,
  setDesktopMediaSessionPositionState,
  syncDesktopMediaSessionPlayback,
} from './desktopMediaSession';

describe('desktopMediaSession', () => {
  let setPositionState: ReturnType<typeof vi.fn>;
  let mediaSession: {
    metadata: MediaMetadata | null;
    playbackState: MediaSessionPlaybackState;
    setPositionState: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    setPositionState = vi.fn();
    mediaSession = {
      metadata: null,
      playbackState: 'none',
      setPositionState,
    };
    vi.stubGlobal(
      'MediaMetadata',
      class MockMediaMetadata {
        title: string;
        artist: string;
        artwork: MediaImage[];
        constructor(init: MediaMetadataInit) {
          this.title = init.title ?? '';
          this.artist = init.artist ?? '';
          this.artwork = init.artwork ?? [];
        }
      },
    );
    vi.stubGlobal('navigator', {
      ...navigator,
      mediaSession,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('syncDesktopMediaSessionPlayback sets metadata with title, artist, and artwork when available', () => {
    syncDesktopMediaSessionPlayback({
      title: 'Episode 1',
      artist: 'My Show',
      artworkUrl: 'file:///tmp/cover.jpg',
      durationMs: 60_000,
      positionMs: 10_000,
      playing: true,
    });
    expect(mediaSession.metadata).not.toBeNull();
    expect(mediaSession.metadata!.title).toBe('Episode 1');
    expect(mediaSession.metadata!.artist).toBe('My Show');
    expect(mediaSession.metadata!.artwork).toHaveLength(1);
    expect(mediaSession.metadata!.artwork[0]!.src).toBe('file:///tmp/cover.jpg');
    expect(mediaSession.playbackState).toBe('playing');
    expect(setPositionState).toHaveBeenCalled();
  });

  it('does not call setPositionState when duration is unknown', () => {
    syncDesktopMediaSessionPlayback({
      title: 'T',
      artist: 'A',
      durationMs: null,
      positionMs: 0,
      playing: false,
    });
    expect(setPositionState).not.toHaveBeenCalled();
  });

  it('does not call setPositionState for non-finite or non-positive duration', () => {
    setDesktopMediaSessionPositionState(0, NaN);
    setDesktopMediaSessionPositionState(0, 0);
    setDesktopMediaSessionPositionState(0, -1);
    expect(setPositionState).not.toHaveBeenCalled();
  });

  it('clearDesktopMediaSession clears metadata and sets playback state to none', () => {
    syncDesktopMediaSessionPlayback({
      title: 'T',
      artist: 'A',
      durationMs: 30_000,
      positionMs: 5_000,
      playing: true,
    });
    expect(mediaSession.metadata).not.toBeNull();
    clearDesktopMediaSession();
    expect(mediaSession.metadata).toBeNull();
    expect(mediaSession.playbackState).toBe('none');
  });

  it('is a no-op when navigator.mediaSession is missing', () => {
    vi.stubGlobal('navigator', {...navigator, mediaSession: undefined});
    expect(() =>
      syncDesktopMediaSessionPlayback({
        title: 'T',
        artist: 'A',
        durationMs: 10_000,
        positionMs: 1,
        playing: true,
      }),
    ).not.toThrow();
    expect(() => clearDesktopMediaSession()).not.toThrow();
  });
});

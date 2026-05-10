import type {PlaylistEntry, PlayerState} from '@eskerra/core';
import {beforeEach, describe, expect, it, vi} from 'vitest';

import type {PodcastEpisode} from './podcastTypes';

const hoisted = vi.hoisted(() => ({
  getState: vi.fn(),
  primePausedAt: vi.fn(),
  stop: vi.fn(),
}));

vi.mock('../htmlAudioPlayer', () => ({
  getDesktopAudioPlayer: () => ({
    getState: hoisted.getState,
    primePausedAt: hoisted.primePausedAt,
    stop: hoisted.stop,
    getCurrentTrackEpisodeId: vi.fn().mockReturnValue(null),
    getLoadedTrack: vi.fn().mockReturnValue(null),
  }),
  notifyDesktopMprisArtworkReady: vi.fn(),
}));

import {runDesktopPrimedPlaylistNativeResume} from './desktopPlaybackPriming';

const pl: PlaylistEntry = {
  controlRevision: 1,
  durationMs: 120_000,
  episodeId: 'e1',
  mp3Url: 'https://example.com/e1.mp3',
  playbackOwnerId: 'dev',
  positionMs: 5000,
  updatedAt: 1,
};

const catalogEp: PodcastEpisode = {
  id: 'e1',
  title: 'Episode one',
  seriesName: 'Test show',
  mp3Url: 'https://example.com/e1.mp3',
  isListened: false,
  date: '2024-01-01',
  sectionTitle: 'A',
  sourceFile: 'x.md',
};

describe('runDesktopPrimedPlaylistNativeResume', () => {
  beforeEach(() => {
    hoisted.getState.mockReset();
    hoisted.primePausedAt.mockReset();
    hoisted.stop.mockReset();
  });

  it('does not call primePausedAt when user playback depth becomes active during initial getState', async () => {
    let resolveState!: (value: PlayerState) => void;
    const statePromise = new Promise<PlayerState>(resolve => {
      resolveState = resolve;
    });
    hoisted.getState.mockReturnValueOnce(statePromise);

    const userPlaybackDepthRef = {current: 0};
    const isCancelled = () => userPlaybackDepthRef.current > 0;

    const done = runDesktopPrimedPlaylistNativeResume({
      isCancelled,
      pl,
      catalogEp,
      key: 'e1:5000:url',
      lastPrimedKeyRef: {current: null},
      onError: vi.fn(),
    });

    userPlaybackDepthRef.current = 1;
    resolveState('paused');

    await done;

    expect(hoisted.primePausedAt).not.toHaveBeenCalled();
  });
});

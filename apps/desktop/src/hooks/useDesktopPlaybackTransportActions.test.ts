import {act, renderHook} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

import type {PodcastEpisode} from '../lib/podcasts/podcastTypes';
import type {DesktopPlaybackContext} from './desktopPlaybackContext';
import {useDesktopPlaybackTransportActions} from './useDesktopPlaybackTransportActions';

const hoisted = vi.hoisted(() => ({
  isPlaybackActive: vi.fn(),
  pause: vi.fn().mockResolvedValue(undefined),
  resume: vi.fn().mockResolvedValue(undefined),
  getProgress: vi.fn().mockResolvedValue({positionMs: 5000, durationMs: 120_000}),
  getState: vi.fn().mockResolvedValue('loading'),
}));

vi.mock('../lib/htmlAudioPlayer', () => ({
  getDesktopAudioPlayer: () => ({
    isPlaybackActive: hoisted.isPlaybackActive,
    pause: hoisted.pause,
    resume: hoisted.resume,
    getProgress: hoisted.getProgress,
    getState: hoisted.getState,
  }),
}));

const catalogEpisode: PodcastEpisode = {
  id: 'e1',
  title: 'Episode one',
  seriesName: 'Test show',
  mp3Url: 'https://example.com/e1.mp3',
  isListened: false,
  date: '2024-01-01',
  sectionTitle: 'A',
  sourceFile: 'x.md',
};

function makeCtx(send = vi.fn()): DesktopPlaybackContext {
  return {
    send,
    sendRef: {current: send},
    snapshotRef: {
      current: {
        context: {
          episode: {
            id: 'e1',
            title: 'Episode one',
            artist: 'Test show',
            mp3Url: 'https://example.com/e1.mp3',
          },
          playlistBaseline: null,
          durationMs: 120_000,
          positionMs: 5000,
        },
        value: {playback: 'playing'},
        matches: () => false,
        hasTag: () => false,
        output: undefined,
        status: 'active',
      },
    } as DesktopPlaybackContext['snapshotRef'],
    vaultRootRef: {current: '/vault'},
    fsRef: {current: {} as DesktopPlaybackContext['fsRef']['current']},
    episodesByIdRef: {current: new Map([['e1', catalogEpisode]])},
    consumeEpisodesRef: {current: [catalogEpisode]},
    deviceIdRef: {current: 'device-1'},
    onPlaylistDiskUpdatedRef: {current: vi.fn()},
    onCatalogRefreshRef: {current: undefined},
    lastPrimedPlaylistKeyRef: {current: null},
    userPlaybackDepthRef: {current: 0},
    onError: vi.fn(),
  };
}

describe('useDesktopPlaybackTransportActions pauseIfPlaying', () => {
  beforeEach(() => {
    hoisted.isPlaybackActive.mockReset();
    hoisted.pause.mockClear();
    hoisted.resume.mockClear();
    hoisted.getProgress.mockClear();
    hoisted.getState.mockReset();
    hoisted.getState.mockResolvedValue('loading');
    hoisted.getProgress.mockResolvedValue({positionMs: 5000, durationMs: 120_000});
  });

  it('pauses when isPlaybackActive is true even if getState is loading', async () => {
    hoisted.isPlaybackActive.mockReturnValue(true);
    const send = vi.fn();
    const ctx = makeCtx(send);

    const {result} = renderHook(() => useDesktopPlaybackTransportActions(ctx));

    await act(async () => {
      await result.current.pauseIfPlaying();
    });

    expect(hoisted.pause).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({
      type: 'PROGRESS',
      positionMs: 5000,
      durationMs: 120_000,
    });
    expect(send).toHaveBeenCalledWith({type: 'NATIVE', state: 'paused'});
  });

  it('does not pause when isPlaybackActive is false', async () => {
    hoisted.isPlaybackActive.mockReturnValue(false);
    const send = vi.fn();
    const ctx = makeCtx(send);

    const {result} = renderHook(() => useDesktopPlaybackTransportActions(ctx));

    await act(async () => {
      await result.current.pauseIfPlaying();
    });

    expect(hoisted.pause).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('togglePause pauses instead of resuming when isPlaybackActive is true and getState is loading', async () => {
    hoisted.isPlaybackActive.mockReturnValue(true);
    const send = vi.fn();
    const ctx = makeCtx(send);

    const {result} = renderHook(() => useDesktopPlaybackTransportActions(ctx));

    await act(async () => {
      await result.current.togglePause();
    });

    expect(hoisted.pause).toHaveBeenCalledTimes(1);
    expect(hoisted.resume).not.toHaveBeenCalled();
  });
});

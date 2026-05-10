import {MIN_PROGRESS_MS, type PlaylistEntry, type VaultFilesystem} from '@eskerra/core';
import {act, renderHook, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

import {markDesktopEpisodeAsPlayed} from '../lib/podcasts/markEpisodeAsPlayedDesktop';
import type {PodcastEpisode} from '../lib/podcasts/podcastTypes';

import {useDesktopPodcastPlayback} from './useDesktopPodcastPlayback';

const hoisted = vi.hoisted(() => ({
  audioStop: vi.fn().mockResolvedValue(undefined),
  clearPlaylistEntryMock: vi.fn().mockResolvedValue(undefined),
  readPlaylistEntryMock: vi.fn(),
  onPlaylistDiskUpdated: vi.fn(),
  playerGetProgress: vi.fn().mockResolvedValue({positionMs: 0, durationMs: 0}),
  playerSeekTo: vi.fn().mockResolvedValue(undefined),
  writePlaylistEntryMock: vi.fn().mockResolvedValue({kind: 'skipped'}),
}));

vi.mock('../lib/htmlAudioPlayer', () => ({
  getDesktopAudioPlayer: () => ({
    stop: hoisted.audioStop,
    addStateListener: vi.fn(() => () => {}),
    addProgressListener: vi.fn(() => () => {}),
    addBufferingListener: vi.fn(() => () => {}),
    getState: vi.fn().mockResolvedValue('idle'),
    getProgress: (...args: unknown[]) => hoisted.playerGetProgress(...args),
    getCurrentTrackEpisodeId: vi.fn().mockReturnValue(null),
    getLoadedTrack: vi.fn().mockReturnValue(null),
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn().mockResolvedValue(undefined),
    resume: vi.fn().mockResolvedValue(undefined),
    seekTo: (...args: unknown[]) => hoisted.playerSeekTo(...args),
    primePausedAt: vi.fn().mockResolvedValue(undefined),
  }),
  isAbortError: () => false,
  notifyDesktopMprisArtworkReady: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/vaultBootstrap', () => ({
  clearPlaylistEntry: (...args: unknown[]) => hoisted.clearPlaylistEntryMock(...args),
  readPlaylistEntry: (...args: unknown[]) => hoisted.readPlaylistEntryMock(...args),
  writePlaylistEntry: (...args: unknown[]) => hoisted.writePlaylistEntryMock(...args),
}));

vi.mock('../lib/podcasts/markEpisodeAsPlayedDesktop', () => ({
  markDesktopEpisodeAsPlayed: vi.fn(),
  markDesktopEpisodeAsPlayedAndRefreshCatalog: vi.fn(),
}));

const fs = {} as VaultFilesystem;

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

const playlistRow: PlaylistEntry = {
  controlRevision: 1,
  durationMs: 120_000,
  episodeId: 'e1',
  mp3Url: 'https://example.com/e1.mp3',
  playbackOwnerId: 'dev',
  positionMs: 5000,
  updatedAt: 1,
};

describe('useDesktopPodcastPlayback dismissNowPlaying', () => {
  beforeEach(() => {
    hoisted.audioStop.mockClear();
    hoisted.clearPlaylistEntryMock.mockClear();
    hoisted.readPlaylistEntryMock.mockReset();
    hoisted.onPlaylistDiskUpdated.mockReset();
    hoisted.playerGetProgress.mockReset();
    hoisted.playerGetProgress.mockResolvedValue({positionMs: 0, durationMs: 0});
    hoisted.playerSeekTo.mockClear();
    hoisted.writePlaylistEntryMock.mockClear();
    vi.mocked(markDesktopEpisodeAsPlayed).mockClear();
  });

  it('stops audio, clears playlist, resets state, and notifies without marking listened', async () => {
    hoisted.readPlaylistEntryMock.mockResolvedValue(playlistRow);

    const {result} = renderHook(() =>
      useDesktopPodcastPlayback({
        consumeCatalogReady: true,
        consumeEpisodes: [catalogEpisode],
        deviceInstanceId: 'device-1',
        fs,
        onCatalogRefresh: vi.fn(),
        onError: vi.fn(),
        onPlaylistDiskUpdated: hoisted.onPlaylistDiskUpdated,
        playlistRevision: 0,
        r2PlaylistConfigured: false,
        vaultRoot: '/vault',
      }),
    );

    await waitFor(() => {
      expect(result.current.activeEpisode?.id).toBe('e1');
    });

    await act(async () => {
      await result.current.dismissNowPlaying();
    });

    expect(hoisted.audioStop).toHaveBeenCalled();
    expect(hoisted.clearPlaylistEntryMock).toHaveBeenCalledWith('/vault', fs);
    expect(hoisted.onPlaylistDiskUpdated).toHaveBeenCalled();
    expect(result.current.activeEpisode).toBeNull();
    expect(markDesktopEpisodeAsPlayed).not.toHaveBeenCalled();
  });

  it('still resets playback when clearing the playlist fails', async () => {
    hoisted.clearPlaylistEntryMock.mockRejectedValueOnce(new Error('disk write'));
    hoisted.readPlaylistEntryMock.mockResolvedValue(playlistRow);

    const {result} = renderHook(() =>
      useDesktopPodcastPlayback({
        consumeCatalogReady: true,
        consumeEpisodes: [catalogEpisode],
        deviceInstanceId: 'device-1',
        fs,
        onCatalogRefresh: vi.fn(),
        onError: vi.fn(),
        onPlaylistDiskUpdated: hoisted.onPlaylistDiskUpdated,
        playlistRevision: 0,
        r2PlaylistConfigured: false,
        vaultRoot: '/vault',
      }),
    );

    await waitFor(() => {
      expect(result.current.activeEpisode?.id).toBe('e1');
    });

    let dismissError: unknown;
    await act(async () => {
      try {
        await result.current.dismissNowPlaying();
      } catch (e) {
        dismissError = e;
      }
    });

    expect(dismissError).toBeInstanceOf(Error);
    expect((dismissError as Error).message).toBe('disk write');

    expect(hoisted.audioStop).toHaveBeenCalled();
    expect(hoisted.clearPlaylistEntryMock).toHaveBeenCalledWith('/vault', fs);
    expect(hoisted.onPlaylistDiskUpdated).not.toHaveBeenCalled();
    expect(result.current.activeEpisode).toBeNull();
  });

  it('no-ops when vault root is missing', async () => {
    hoisted.readPlaylistEntryMock.mockResolvedValue(null);

    const {result} = renderHook(() =>
      useDesktopPodcastPlayback({
        consumeCatalogReady: true,
        consumeEpisodes: [],
        deviceInstanceId: 'device-1',
        fs,
        onCatalogRefresh: vi.fn(),
        onError: vi.fn(),
        onPlaylistDiskUpdated: hoisted.onPlaylistDiskUpdated,
        playlistRevision: 0,
        r2PlaylistConfigured: false,
        vaultRoot: null,
      }),
    );

    await waitFor(() => {
      expect(result.current.activeEpisode).toBeNull();
    });

    hoisted.audioStop.mockClear();
    hoisted.clearPlaylistEntryMock.mockClear();
    hoisted.onPlaylistDiskUpdated.mockClear();

    await act(async () => {
      await result.current.dismissNowPlaying();
    });

    expect(hoisted.audioStop).not.toHaveBeenCalled();
    expect(hoisted.clearPlaylistEntryMock).not.toHaveBeenCalled();
    expect(hoisted.onPlaylistDiskUpdated).not.toHaveBeenCalled();
  });
});

describe('useDesktopPodcastPlayback seekTo', () => {
  beforeEach(() => {
    hoisted.audioStop.mockClear();
    hoisted.clearPlaylistEntryMock.mockClear();
    hoisted.readPlaylistEntryMock.mockReset();
    hoisted.onPlaylistDiskUpdated.mockReset();
    hoisted.playerGetProgress.mockReset();
    hoisted.playerSeekTo.mockClear();
    hoisted.writePlaylistEntryMock.mockClear();
    vi.mocked(markDesktopEpisodeAsPlayed).mockClear();
  });

  function renderPrimedHook() {
    hoisted.readPlaylistEntryMock.mockResolvedValue(playlistRow);
    return renderHook(() =>
      useDesktopPodcastPlayback({
        consumeCatalogReady: true,
        consumeEpisodes: [catalogEpisode],
        deviceInstanceId: 'device-1',
        fs,
        onCatalogRefresh: vi.fn(),
        onError: vi.fn(),
        onPlaylistDiskUpdated: hoisted.onPlaylistDiskUpdated,
        playlistRevision: 0,
        r2PlaylistConfigured: false,
        vaultRoot: '/vault',
      }),
    );
  }

  it('seeks to the requested position when above MIN_PROGRESS_MS', async () => {
    hoisted.playerGetProgress
      .mockResolvedValueOnce({positionMs: 30_000, durationMs: 120_000})
      .mockResolvedValueOnce({positionMs: 60_000, durationMs: 120_000});

    const onError = vi.fn();
    hoisted.readPlaylistEntryMock.mockResolvedValue(playlistRow);
    const {result} = renderHook(() =>
      useDesktopPodcastPlayback({
        consumeCatalogReady: true,
        consumeEpisodes: [catalogEpisode],
        deviceInstanceId: 'device-1',
        fs,
        onCatalogRefresh: vi.fn(),
        onError,
        onPlaylistDiskUpdated: hoisted.onPlaylistDiskUpdated,
        playlistRevision: 0,
        r2PlaylistConfigured: false,
        vaultRoot: '/vault',
      }),
    );

    await waitFor(() => {
      expect(result.current.activeEpisode?.id).toBe('e1');
    });

    await act(async () => {
      await result.current.seekTo(60_000);
    });

    expect(hoisted.playerSeekTo).toHaveBeenCalledWith(60_000);
    expect(onError).not.toHaveBeenCalled();
    /* Without R2, `flushPersist` skips `deps.persist` — no `writePlaylistEntry` call. */
    expect(hoisted.writePlaylistEntryMock).not.toHaveBeenCalled();
  });

  it('clamps seek target to durationMs', async () => {
    hoisted.playerGetProgress
      .mockResolvedValueOnce({positionMs: 30_000, durationMs: 120_000})
      .mockResolvedValueOnce({positionMs: 120_000, durationMs: 120_000});

    const {result} = renderPrimedHook();

    await waitFor(() => {
      expect(result.current.activeEpisode?.id).toBe('e1');
    });

    await act(async () => {
      await result.current.seekTo(200_000);
    });

    expect(hoisted.playerSeekTo).toHaveBeenCalledWith(120_000);
  });

  it('clears playlist when seek lands below MIN_PROGRESS_MS', async () => {
    expect(MIN_PROGRESS_MS).toBeGreaterThan(5000);

    hoisted.playerGetProgress
      .mockResolvedValueOnce({positionMs: 30_000, durationMs: 120_000})
      .mockResolvedValueOnce({positionMs: 5000, durationMs: 120_000});

    const {result} = renderPrimedHook();

    await waitFor(() => {
      expect(result.current.activeEpisode?.id).toBe('e1');
    });

    await act(async () => {
      await result.current.seekTo(5000);
    });

    expect(hoisted.playerSeekTo).toHaveBeenCalledWith(5000);
    expect(hoisted.audioStop).toHaveBeenCalled();
    expect(hoisted.clearPlaylistEntryMock).toHaveBeenCalledWith('/vault', fs);
    expect(hoisted.onPlaylistDiskUpdated).toHaveBeenCalled();
    await waitFor(() => {
      expect(result.current.activeEpisode).toBeNull();
    });
  });

  it('returns before touching the player when vault root is missing', async () => {
    hoisted.readPlaylistEntryMock.mockResolvedValue(null);

    const {result} = renderHook(() =>
      useDesktopPodcastPlayback({
        consumeCatalogReady: true,
        consumeEpisodes: [],
        deviceInstanceId: 'device-1',
        fs,
        onCatalogRefresh: vi.fn(),
        onError: vi.fn(),
        onPlaylistDiskUpdated: hoisted.onPlaylistDiskUpdated,
        playlistRevision: 0,
        r2PlaylistConfigured: false,
        vaultRoot: null,
      }),
    );

    await waitFor(() => {
      expect(result.current.activeEpisode).toBeNull();
    });

    await act(async () => {
      await result.current.seekTo(60_000);
    });

    expect(hoisted.playerSeekTo).not.toHaveBeenCalled();
  });
});

describe('useDesktopPodcastPlayback playlist disk hydrate vs catalog loading', () => {
  beforeEach(() => {
    hoisted.audioStop.mockClear();
    hoisted.clearPlaylistEntryMock.mockClear();
    hoisted.readPlaylistEntryMock.mockReset();
    hoisted.onPlaylistDiskUpdated.mockReset();
    hoisted.playerGetProgress.mockReset();
    hoisted.playerGetProgress.mockResolvedValue({positionMs: 0, durationMs: 0});
    hoisted.playerSeekTo.mockClear();
    hoisted.writePlaylistEntryMock.mockClear();
    vi.mocked(markDesktopEpisodeAsPlayed).mockClear();
  });

  it('does not clear playlist while catalog is still loading', async () => {
    hoisted.readPlaylistEntryMock.mockResolvedValue(playlistRow);

    const {result, rerender} = renderHook(
      ({ready, episodes}: {ready: boolean; episodes: PodcastEpisode[]}) =>
        useDesktopPodcastPlayback({
          consumeCatalogReady: ready,
          consumeEpisodes: episodes,
          deviceInstanceId: 'device-1',
          fs,
          onCatalogRefresh: vi.fn(),
          onError: vi.fn(),
          onPlaylistDiskUpdated: hoisted.onPlaylistDiskUpdated,
          playlistRevision: 0,
          r2PlaylistConfigured: false,
          vaultRoot: '/vault',
        }),
      {initialProps: {ready: false, episodes: [] as PodcastEpisode[]}},
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(hoisted.clearPlaylistEntryMock).not.toHaveBeenCalled();

    rerender({ready: true, episodes: [catalogEpisode]});

    await waitFor(() => {
      expect(result.current.activeEpisode?.id).toBe('e1');
    });
    expect(hoisted.clearPlaylistEntryMock).not.toHaveBeenCalled();
  });

  it('clears stale playlist row after catalog is ready when episode is missing', async () => {
    const ghostPlaylist: PlaylistEntry = {...playlistRow, episodeId: 'missing-ep'};
    hoisted.readPlaylistEntryMock.mockResolvedValue(ghostPlaylist);

    const {rerender} = renderHook(
      ({ready, episodes}: {ready: boolean; episodes: PodcastEpisode[]}) =>
        useDesktopPodcastPlayback({
          consumeCatalogReady: ready,
          consumeEpisodes: episodes,
          deviceInstanceId: 'device-1',
          fs,
          onCatalogRefresh: vi.fn(),
          onError: vi.fn(),
          onPlaylistDiskUpdated: hoisted.onPlaylistDiskUpdated,
          playlistRevision: 0,
          r2PlaylistConfigured: false,
          vaultRoot: '/vault',
        }),
      {initialProps: {ready: false, episodes: [] as PodcastEpisode[]}},
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(hoisted.clearPlaylistEntryMock).not.toHaveBeenCalled();

    rerender({ready: true, episodes: [catalogEpisode]});

    await waitFor(() => {
      expect(hoisted.clearPlaylistEntryMock).toHaveBeenCalledWith('/vault', fs);
    });
  });
});

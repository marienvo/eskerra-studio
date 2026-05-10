import {type PlaylistEntry, type VaultFilesystem} from '@eskerra/core';
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

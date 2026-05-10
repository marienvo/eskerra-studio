import type {PlaylistEntry, VaultFilesystem} from '@eskerra/core';
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
}));

vi.mock('../lib/htmlAudioPlayer', () => ({
  getDesktopAudioPlayer: () => ({
    stop: hoisted.audioStop,
    addStateListener: vi.fn(() => () => {}),
    addProgressListener: vi.fn(() => () => {}),
    addBufferingListener: vi.fn(() => () => {}),
    getState: vi.fn().mockResolvedValue('idle'),
    getProgress: vi.fn().mockResolvedValue({positionMs: 0, durationMs: 0}),
    getCurrentTrackEpisodeId: vi.fn().mockReturnValue(null),
    getLoadedTrack: vi.fn().mockReturnValue(null),
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn().mockResolvedValue(undefined),
    resume: vi.fn().mockResolvedValue(undefined),
    seekTo: vi.fn().mockResolvedValue(undefined),
  }),
  isAbortError: () => false,
  notifyDesktopMprisArtworkReady: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/vaultBootstrap', () => ({
  clearPlaylistEntry: (...args: unknown[]) => hoisted.clearPlaylistEntryMock(...args),
  readPlaylistEntry: (...args: unknown[]) => hoisted.readPlaylistEntryMock(...args),
  writePlaylistEntry: vi.fn().mockResolvedValue({kind: 'skipped'}),
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

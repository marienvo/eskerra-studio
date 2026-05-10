import type {PlaybackTransportPlayControl, PodcastPlayerPlaybackState, VaultFilesystem} from '@eskerra/core';

import type {PodcastEpisode} from '../lib/podcasts/podcastTypes';

export type DesktopPlayerLabel = PodcastPlayerPlaybackState | 'nativeLoading';

export type UseDesktopPodcastPlaybackOptions = {
  vaultRoot: string | null;
  /** From `.eskerra/settings-local.json`; used as `playbackOwnerId` for control writes. */
  deviceInstanceId: string;
  fs: VaultFilesystem;
  onError: (msg: string | null) => void;
  onPlaylistDiskUpdated?: () => void;
  playlistRevision: number;
  /** Flat episode list from the podcasts catalog (Episodes tab). */
  consumeEpisodes: PodcastEpisode[];
  /**
   * True when the Episodes tab is mounted and its latest refresh has finished (`!loading`),
   * so `consumeEpisodes` can be trusted for playlist reconciliation.
   */
  consumeCatalogReady: boolean;
  /** When true, playlist reads/writes use R2 only (no local `playlist.json` persistence). */
  r2PlaylistConfigured: boolean;
  /** Optional catalog rescan after markdown mark-as-played. */
  onCatalogRefresh?: () => Promise<void>;
};

export type UseDesktopPodcastPlaybackResult = {
  activeEpisode: PodcastEpisode | null;
  /** Id of the episode loaded in the player (for list highlighting). */
  activeEpisodeId: string | null;
  /** Play button / list chrome for the active episode (from machine + native audio). */
  activeEpisodePlayControl: PlaybackTransportPlayControl;
  /** Playback phase + native loading for status UI. */
  playerLabel: DesktopPlayerLabel;
  positionMs: number;
  durationMs: number | null;
  playEpisode: (ep: PodcastEpisode) => Promise<void>;
  /** Mark an episode as listened in vault markdown and rescan the catalog (no audio stop). */
  markEpisodePlayed: (ep: PodcastEpisode) => Promise<void>;
  seekBy: (deltaMs: number) => Promise<void>;
  /** Seek to an absolute position in milliseconds (clamped to duration; same MIN_PROGRESS_MS reset as {@link seekBy}). */
  seekTo: (absoluteMs: number) => Promise<void>;
  togglePause: () => Promise<void>;
  /**
   * Pause native audio and queue playlist persist (same as user pause while playing).
   * No-op when not playing. For shutdown, call then `waitForPersistFlushed`.
   */
  pauseIfPlaying: () => Promise<void>;
  /** Resolves when persist is idle or after `timeoutMs` (never throws). */
  waitForPersistFlushed: (timeoutMs: number) => Promise<void>;
  /** True while the native element is `playing` (episode list locked). */
  episodeSelectLocked: boolean;
  /**
   * True while local playback transport is `playing`, `buffering`, or `loading` (e.g. pause R2 polling).
   */
  localPlaybackActive: boolean;
  playbackTransportPlayControl: PlaybackTransportPlayControl;
  seekDisabled: boolean;
  /**
   * Stop audio, clear the playlist entry, and reset playback state without marking the episode as listened.
   */
  dismissNowPlaying: () => Promise<void>;
};

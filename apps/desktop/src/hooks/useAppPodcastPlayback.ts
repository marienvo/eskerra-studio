import {useCallback, useMemo, useRef, useState} from 'react';

import {
  defaultEskerraSettings,
  isVaultR2PlaylistConfigured,
  type EskerraSettings,
} from '@eskerra/core';

import {APP_SHELL_TAGLINE} from '../components/AppStatusBar';
import type {PlaybackTransportProps} from '../components/PlaybackTransport';
import {formatPlaybackMs} from '../lib/formatPlaybackMs';
import {clearPodcastMarkdownFileContentCache} from '../lib/podcasts/podcastPhase1Desktop';
import {runDesktopPodcastRssSync} from '../lib/podcasts/podcastRssSyncDesktop';
import {resolveAppStatusBarCenter} from '../lib/resolveAppStatusBarCenter';
import {createTauriVaultFilesystem} from '../lib/tauriVault';
import {useDesktopPodcastCatalog} from './useDesktopPodcastCatalog';
import {useDesktopPodcastPlayback} from './useDesktopPodcastPlayback';

const PLAYBACK_SKIP_MS = 10_000;

export type UseAppPodcastPlaybackArgs = {
  vaultRoot: string | null;
  fs: ReturnType<typeof createTauriVaultFilesystem>;
  podcastFsNonce: number;
  setErr: (err: string | null) => void;
  deviceInstanceId: string | null;
  vaultSettings: EskerraSettings | null;
  err: string | null;
  diskConflict: unknown;
  diskConflictSoft: unknown;
  renameLinkProgress: {done: number; total: number} | null;
  wikiRenameNotice: string | null;
};

export function useAppPodcastPlayback({
  vaultRoot,
  fs,
  podcastFsNonce,
  setErr,
  deviceInstanceId,
  vaultSettings,
  err,
  diskConflict,
  diskConflictSoft,
  renameLinkProgress,
  wikiRenameNotice,
}: UseAppPodcastPlaybackArgs) {
  const [playlistDiskRevision, setPlaylistDiskRevision] = useState(0);
  const bumpPlaylistDiskRevision = useCallback(() => {
    setPlaylistDiskRevision(r => r + 1);
  }, []);

  const podcastCatalog = useDesktopPodcastCatalog({
    vaultRoot,
    fs,
    fsRefreshNonce: podcastFsNonce,
    onError: setErr,
  });

  const rssSyncingRef = useRef(false);
  const [rssSyncing, setRssSyncing] = useState(false);
  const [rssSyncPercent, setRssSyncPercent] = useState<number | null>(null);

  const handleEpisodesRssSync = useCallback(async () => {
    if (vaultRoot == null || rssSyncingRef.current) {
      return;
    }
    rssSyncingRef.current = true;
    setRssSyncing(true);
    setRssSyncPercent(null);
    try {
      await runDesktopPodcastRssSync(vaultRoot, fs, {
        onProgress: payload => {
          const n = payload.percent;
          if (Number.isFinite(n) && n >= 0 && n <= 100) {
            setRssSyncPercent(n);
          }
        },
      });
      clearPodcastMarkdownFileContentCache();
      await podcastCatalog.refreshPodcasts(true);
    } catch {
      // Errors per-file are already logged inside runDesktopPodcastRssSync.
    } finally {
      rssSyncingRef.current = false;
      setRssSyncing(false);
      setRssSyncPercent(null);
    }
  }, [vaultRoot, fs, podcastCatalog]);

  const consumeCatalogReady = Boolean(vaultRoot) && !podcastCatalog.catalogLoading;

  const desktopPlayback = useDesktopPodcastPlayback({
    consumeCatalogReady,
    consumeEpisodes: podcastCatalog.episodes,
    deviceInstanceId: deviceInstanceId ?? '',
    fs,
    onCatalogRefresh: () => podcastCatalog.refreshPodcasts(false),
    onError: setErr,
    onPlaylistDiskUpdated: bumpPlaylistDiskRevision,
    playlistRevision: playlistDiskRevision,
    r2PlaylistConfigured: isVaultR2PlaylistConfigured(
      vaultSettings ?? defaultEskerraSettings,
    ),
    vaultRoot,
  });

  const toolbarNowPlaying = useMemo(() => {
    if (desktopPlayback.activeEpisode == null) {
      return null;
    }
    return {
      episodeTitle: desktopPlayback.activeEpisode.title,
      seriesName: desktopPlayback.activeEpisode.seriesName,
      onClose: () => {
        desktopPlayback.dismissNowPlaying().catch(() => {});
      },
      progress: {
        positionMs: desktopPlayback.positionMs,
        durationMs: desktopPlayback.durationMs ?? 0,
        disabled: desktopPlayback.playbackTransportPlayControl === 'loading',
        onSeek: (ms: number) => {
          desktopPlayback.seekTo(ms).catch(() => {});
        },
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- granular playback fields; hook return object is unstable
  }, [
    desktopPlayback.activeEpisode,
    desktopPlayback.dismissNowPlaying,
    desktopPlayback.durationMs,
    desktopPlayback.playbackTransportPlayControl,
    desktopPlayback.positionMs,
    desktopPlayback.seekTo,
  ]);

  const playbackTransport = useMemo((): PlaybackTransportProps | undefined => {
    if (desktopPlayback.activeEpisode == null) {
      return undefined;
    }
    const seek = desktopPlayback.seekBy;
    return {
      positionLabel: formatPlaybackMs(desktopPlayback.positionMs),
      durationLabel: formatPlaybackMs(desktopPlayback.durationMs),
      seekDisabled: desktopPlayback.seekDisabled,
      playControl: desktopPlayback.playbackTransportPlayControl,
      onSeekBack: () => void seek(-PLAYBACK_SKIP_MS),
      onSeekForward: () => void seek(PLAYBACK_SKIP_MS),
      onTogglePlay: () => desktopPlayback.togglePause(),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- granular playback fields below; hook return object is unstable
  }, [
    desktopPlayback.activeEpisode,
    desktopPlayback.durationMs,
    desktopPlayback.playbackTransportPlayControl,
    desktopPlayback.positionMs,
    desktopPlayback.seekBy,
    desktopPlayback.seekDisabled,
    desktopPlayback.togglePause,
  ]);

  const statusBarCenter = useMemo(
    () =>
      resolveAppStatusBarCenter({
        err,
        diskConflict: diskConflict != null,
        diskConflictSoft: diskConflictSoft != null,
        renameLinkProgress,
        wikiRenameNotice,
        playerLabel: desktopPlayback.playerLabel,
        activeEpisode: desktopPlayback.activeEpisode,
        tagline: APP_SHELL_TAGLINE,
      }),
    [
      err,
      diskConflict,
      diskConflictSoft,
      renameLinkProgress,
      wikiRenameNotice,
      desktopPlayback.playerLabel,
      desktopPlayback.activeEpisode,
    ],
  );

  return {
    podcastCatalog,
    rssSyncing,
    rssSyncPercent,
    handleEpisodesRssSync,
    desktopPlayback,
    toolbarNowPlaying,
    playbackTransport,
    statusBarCenter,
    bumpPlaylistDiskRevision,
  };
}

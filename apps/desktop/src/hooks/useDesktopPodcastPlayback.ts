import {
  getPlaybackSubstate,
  getPlaybackTransportPlayControl,
  isPlaybackTransportBusy,
  podcastPlayerMachine,
  type PodcastPlayerDeps,
} from '@eskerra/core';
import {useMachine} from '@xstate/react';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react';

import {getDesktopAudioPlayer} from '../lib/htmlAudioPlayer';
import {
  markDesktopEpisodeAsPlayed,
} from '../lib/podcasts/markEpisodeAsPlayedDesktop';
import {clearPlaylistEntry, writePlaylistEntry} from '../lib/vaultBootstrap';
import type {DesktopPlaybackContext} from './desktopPlaybackContext';
import {useDesktopPlaybackCatalogProbe} from './useDesktopPlaybackCatalogProbe';
import {useDesktopPlaybackNativeIdleStop, useDesktopPlaybackNativeListeners} from './useDesktopPlaybackNativeListeners';
import {useDesktopPlaybackPlaylistSync} from './useDesktopPlaybackPlaylistSync';
import {useDesktopPlaybackSessionActions} from './useDesktopPlaybackSessionActions';
import {useDesktopPlaybackTransportActions} from './useDesktopPlaybackTransportActions';
import type {
  DesktopPlayerLabel,
  UseDesktopPodcastPlaybackOptions,
  UseDesktopPodcastPlaybackResult,
} from './useDesktopPodcastPlayback.types';

export type {
  DesktopPlayerLabel,
  UseDesktopPodcastPlaybackOptions,
  UseDesktopPodcastPlaybackResult,
} from './useDesktopPodcastPlayback.types';

export function useDesktopPodcastPlayback({
  vaultRoot,
  deviceInstanceId,
  fs,
  onError,
  onPlaylistDiskUpdated,
  playlistRevision,
  consumeEpisodes,
  consumeCatalogReady,
  r2PlaylistConfigured,
  onCatalogRefresh,
}: UseDesktopPodcastPlaybackOptions): UseDesktopPodcastPlaybackResult {
  const vaultRootRef = useRef(vaultRoot);
  const fsRef = useRef(fs);
  const onPlaylistDiskUpdatedRef = useRef(onPlaylistDiskUpdated);
  const onCatalogRefreshRef = useRef(onCatalogRefresh);
  const consumeEpisodesRef = useRef(consumeEpisodes);
  const r2ConfiguredRef = useRef(r2PlaylistConfigured);
  const deviceIdRef = useRef(deviceInstanceId.trim());
  const lastPrimedPlaylistKeyRef = useRef<string | null>(null);
  const userPlaybackDepthRef = useRef(0);

  useLayoutEffect(() => {
    vaultRootRef.current = vaultRoot;
  }, [vaultRoot]);
  useLayoutEffect(() => {
    fsRef.current = fs;
  }, [fs]);
  useLayoutEffect(() => {
    onPlaylistDiskUpdatedRef.current = onPlaylistDiskUpdated;
  }, [onPlaylistDiskUpdated]);
  useLayoutEffect(() => {
    onCatalogRefreshRef.current = onCatalogRefresh;
  }, [onCatalogRefresh]);
  useLayoutEffect(() => {
    consumeEpisodesRef.current = consumeEpisodes;
  }, [consumeEpisodes]);
  useLayoutEffect(() => {
    r2ConfiguredRef.current = r2PlaylistConfigured;
  }, [r2PlaylistConfigured]);
  useLayoutEffect(() => {
    deviceIdRef.current = deviceInstanceId.trim();
  }, [deviceInstanceId]);

  const episodesById = useMemo(
    () => new Map(consumeEpisodes.map(e => [e.id, e])),
    [consumeEpisodes],
  );
  const episodesByIdRef = useRef(episodesById);
  useLayoutEffect(() => {
    episodesByIdRef.current = episodesById;
  }, [episodesById]);

  const deps = useMemo<PodcastPlayerDeps>(
    () => ({
      hasR2: () => Boolean(vaultRootRef.current && r2ConfiguredRef.current),
      persist: async entry => {
        const root = vaultRootRef.current;
        if (!root) {
          return {kind: 'skipped'};
        }
        const out = await writePlaylistEntry(root, fsRef.current, entry);
        if (out.kind === 'saved' || out.kind === 'superseded') {
          onPlaylistDiskUpdatedRef.current?.();
        }
        return out;
      },
      clearRemotePlaylist: async () => {
        const root = vaultRootRef.current;
        if (!root) {
          return;
        }
        await clearPlaylistEntry(root, fsRef.current);
        onPlaylistDiskUpdatedRef.current?.();
      },
      markEpisodeListened: async (episodeId, dismissNowPlaying) => {
        const root = vaultRootRef.current;
        if (!root) {
          return;
        }
        const ep = episodesByIdRef.current.get(episodeId);
        if (!ep) {
          return;
        }
        await markDesktopEpisodeAsPlayed(root, fsRef.current, ep);
        await onCatalogRefreshRef.current?.();
        if (dismissNowPlaying) {
          try {
            await getDesktopAudioPlayer().stop();
          } catch {
            /* ignore */
          }
        }
      },
    }),
    [],
  );

  const [snapshot, send, actorRef] = useMachine(podcastPlayerMachine, {
    input: {deps},
  });

  const sendRef = useRef(send);
  useLayoutEffect(() => {
    sendRef.current = send;
  }, [send]);

  const snapshotRef = useRef(snapshot);
  useLayoutEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  const snapCtx = snapshot.context;
  const playbackSub = getPlaybackSubstate(snapshot);
  const activeEpisode =
    snapCtx.episode != null ? episodesById.get(snapCtx.episode.id) ?? null : null;

  useDesktopPlaybackCatalogProbe({
    consumeCatalogReady,
    episodesById,
    send,
    snapCtxEpisode: snapCtx.episode,
  });

  const playerLabel: DesktopPlayerLabel = useMemo(() => {
    if (snapCtx.native === 'loading' && !snapCtx.seeking) {
      return 'nativeLoading';
    }
    return playbackSub;
  }, [playbackSub, snapCtx.native, snapCtx.seeking]);

  const playbackTransportPlayControl = useMemo(
    () =>
      getPlaybackTransportPlayControl({
        context: snapCtx,
        value: snapshot.value,
      }),
    [snapCtx, snapshot.value],
  );

  const localPlaybackActive =
    playbackTransportPlayControl === 'playing' ||
    playbackTransportPlayControl === 'buffering' ||
    playbackTransportPlayControl === 'loading';

  const activeEpisodeId = snapCtx.episode?.id ?? null;

  const seekDisabled = isPlaybackTransportBusy(snapCtx);

  /**
   * Recreated every render. Sub-hooks must destructure fields from `ctx` and must not list `ctx`
   * itself in hook dependency arrays (only primitives / stable callbacks belong there).
   */
  const playbackCtx: DesktopPlaybackContext = {
    send,
    sendRef,
    snapshotRef,
    vaultRootRef,
    fsRef,
    episodesByIdRef,
    consumeEpisodesRef,
    deviceIdRef,
    onPlaylistDiskUpdatedRef,
    onCatalogRefreshRef,
    lastPrimedPlaylistKeyRef,
    userPlaybackDepthRef,
    onError,
  };

  const {markEpisodePlayed, playEpisode, waitForPersistFlushed, dismissNowPlaying} =
    useDesktopPlaybackSessionActions(playbackCtx, {actorRef, vaultRoot, fs});

  useEffect(() => {
    lastPrimedPlaylistKeyRef.current = null;
  }, [vaultRoot]);

  useDesktopPlaybackNativeListeners(send);

  useDesktopPlaybackPlaylistSync(playbackCtx, {
    vaultRoot,
    fs,
    playlistRevision,
    consumeCatalogReady,
    playbackSub,
    snapCtx,
    episodesById,
  });

  useDesktopPlaybackNativeIdleStop(playbackSub, snapCtx.episode);

  const {seekBy, seekTo, pauseIfPlaying, togglePause} =
    useDesktopPlaybackTransportActions(playbackCtx);

  return {
    activeEpisode,
    activeEpisodeId,
    activeEpisodePlayControl: playbackTransportPlayControl,
    durationMs: snapCtx.durationMs,
    episodeSelectLocked: snapCtx.native === 'playing',
    localPlaybackActive,
    markEpisodePlayed,
    playEpisode,
    playerLabel,
    positionMs: snapCtx.positionMs,
    playbackTransportPlayControl,
    seekBy,
    seekTo,
    seekDisabled,
    togglePause,
    pauseIfPlaying,
    waitForPersistFlushed,
    dismissNowPlaying,
  };
}

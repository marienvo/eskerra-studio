import {
  buildPlaylistEntryForWrite,
  getPlaybackSubstate,
  type PlaylistEntry,
  type PodcastPlayerPlaybackState,
  type VaultFilesystem,
} from '@eskerra/core';
import {useEffect, useLayoutEffect, useRef, type MutableRefObject} from 'react';

import {getDesktopAudioPlayer} from '../lib/htmlAudioPlayer';
import {runDesktopPrimedPlaylistNativeResume} from '../lib/podcasts/desktopPlaybackPriming';
import {episodeToSnapshot} from '../lib/podcasts/desktopPlaybackSeekHelpers';
import type {PodcastEpisode} from '../lib/podcasts/podcastTypes';
import {clearPlaylistEntry, readPlaylistEntry} from '../lib/vaultBootstrap';
import type {
  DesktopPlaybackContext,
  DesktopPlaybackMachineContext,
} from './desktopPlaybackContext';

const NEAR_END_SUBSTATES = new Set<PodcastPlayerPlaybackState>([
  'markingNearEnd',
  'nearEndPlaying',
  'nearEndPaused',
  'ended',
]);

/** Clears primed-resume key when the vault root changes (call before native listeners; see orchestrator order). */
export function useDesktopPlaybackLastPrimedResetOnVaultRoot(
  lastPrimedPlaylistKeyRef: MutableRefObject<string | null>,
  vaultRoot: string | null,
): void {
  useEffect(() => {
    lastPrimedPlaylistKeyRef.current = null;
  }, [lastPrimedPlaylistKeyRef, vaultRoot]);
}

export function useDesktopPlaybackPlaylistSync(
  ctx: DesktopPlaybackContext,
  args: {
    vaultRoot: string | null;
    fs: VaultFilesystem;
    playlistRevision: number;
    consumeCatalogReady: boolean;
    playbackSub: PodcastPlayerPlaybackState;
    snapCtx: DesktopPlaybackMachineContext;
    episodesById: Map<string, PodcastEpisode>;
  },
): void {
  const {
    send,
    snapshotRef,
    consumeEpisodesRef,
    episodesByIdRef,
    onPlaylistDiskUpdatedRef,
    deviceIdRef,
    lastPrimedPlaylistKeyRef,
    userPlaybackDepthRef,
    onError,
  } = ctx;
  const {vaultRoot, fs, playlistRevision, consumeCatalogReady, playbackSub, snapCtx, episodesById} =
    args;

  const nearEndNonceHandledRef = useRef(0);
  const consumeCatalogReadyRef = useRef(consumeCatalogReady);
  useLayoutEffect(() => {
    consumeCatalogReadyRef.current = consumeCatalogReady;
  }, [consumeCatalogReady]);

  useEffect(() => {
    let cancelled = false;
    if (!vaultRoot) {
      queueMicrotask(() => {
        if (!cancelled) {
          send({type: 'RESET'});
        }
      });
      return () => {
        cancelled = true;
      };
    }
    readPlaylistEntry(vaultRoot, fs)
      .then(async pl => {
        if (cancelled) {
          return;
        }
        const st = await getDesktopAudioPlayer().getState();
        if (st === 'playing' || userPlaybackDepthRef.current > 0) {
          return;
        }
        if (!pl) {
          const snap = snapshotRef.current;
          const isNearEnd =
            snap.context.inNearEndZone ||
            NEAR_END_SUBSTATES.has(getPlaybackSubstate(snap));
          if (isNearEnd) {
            return;
          }
          send({type: 'RESET'});
          return;
        }
        if (!consumeCatalogReadyRef.current) {
          return;
        }
        const catalogEp = consumeEpisodesRef.current.find(e => e.id === pl.episodeId);
        if (!catalogEp || catalogEp.isListened) {
          clearPlaylistEntry(vaultRoot, fs).finally(() => {
            onPlaylistDiskUpdatedRef.current?.();
          });
          send({type: 'RESET'});
          return;
        }
        send({
          type: 'HYDRATE',
          episode: episodeToSnapshot(catalogEp),
          entry: pl,
          baseline: pl,
        });
      })
      .catch(() => {
        if (!cancelled) {
          send({type: 'RESET'});
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    consumeCatalogReady,
    consumeEpisodesRef,
    fs,
    onPlaylistDiskUpdatedRef,
    playlistRevision,
    send,
    snapshotRef,
    userPlaybackDepthRef,
    vaultRoot,
  ]);

  useEffect(() => {
    if (snapCtx.nearEndResyncNonce === nearEndNonceHandledRef.current) {
      return;
    }
    if (snapCtx.inNearEndZone || !snapCtx.episode || !vaultRoot) {
      nearEndNonceHandledRef.current = snapCtx.nearEndResyncNonce;
      return;
    }
    const deviceId = deviceIdRef.current;
    if (!deviceId) {
      nearEndNonceHandledRef.current = snapCtx.nearEndResyncNonce;
      return;
    }
    const ep = episodesById.get(snapCtx.episode.id);
    if (!ep) {
      nearEndNonceHandledRef.current = snapCtx.nearEndResyncNonce;
      return;
    }
    nearEndNonceHandledRef.current = snapCtx.nearEndResyncNonce;
    const machineCtx = snapshotRef.current.context;
    const base: PlaylistEntry =
      machineCtx.playlistBaseline?.episodeId === ep.id
        ? machineCtx.playlistBaseline
        : {
            durationMs: machineCtx.durationMs,
            episodeId: ep.id,
            mp3Url: ep.mp3Url,
            positionMs: 0,
            updatedAt: 0,
            playbackOwnerId: '',
            controlRevision: 0,
          };
    const entry = buildPlaylistEntryForWrite(
      base,
      {
        durationMs: machineCtx.durationMs,
        episodeId: ep.id,
        mp3Url: ep.mp3Url,
        positionMs: machineCtx.positionMs,
      },
      deviceId,
      Date.now(),
    );
    send({type: 'QUEUE_PERSIST', entry});
  }, [
    deviceIdRef,
    episodesById,
    send,
    snapCtx.durationMs,
    snapCtx.episode,
    snapCtx.inNearEndZone,
    snapCtx.nearEndResyncNonce,
    snapCtx.positionMs,
    snapshotRef,
    vaultRoot,
  ]);

  useEffect(() => {
    if (!vaultRoot || !consumeCatalogReady) {
      return;
    }
    if (playbackSub !== 'primed') {
      return;
    }
    if (userPlaybackDepthRef.current > 0) {
      return;
    }
    const pl = snapCtx.playlistBaseline;
    const epSnap = snapCtx.episode;
    if (!pl || !epSnap) {
      return;
    }
    const catalogEp = episodesByIdRef.current.get(pl.episodeId);
    if (!catalogEp || catalogEp.isListened) {
      return;
    }
    const trackUrl = catalogEp.mp3Url;
    const key = `${catalogEp.id}:${pl.positionMs}:${trackUrl}`;
    if (key === lastPrimedPlaylistKeyRef.current) {
      return;
    }

    let cancelled = false;
    void runDesktopPrimedPlaylistNativeResume({
      isCancelled: () => cancelled || userPlaybackDepthRef.current > 0,
      pl,
      catalogEp,
      key,
      lastPrimedKeyRef: lastPrimedPlaylistKeyRef,
      onError: (message: string) => {
        onError(message);
      },
    });

    return () => {
      cancelled = true;
    };
  }, [
    consumeCatalogReady,
    episodesByIdRef,
    lastPrimedPlaylistKeyRef,
    onError,
    playbackSub,
    snapCtx.episode,
    snapCtx.playlistBaseline,
    userPlaybackDepthRef,
    vaultRoot,
  ]);
}

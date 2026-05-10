import {
  isPersistIdle,
  podcastPlayerMachine,
  type VaultFilesystem,
} from '@eskerra/core';
import {useCallback} from 'react';
import type {ActorRefFrom} from 'xstate';
import {waitFor} from 'xstate';

import {
  getDesktopAudioPlayer,
  isAbortError,
} from '../lib/htmlAudioPlayer';
import {markDesktopEpisodeAsPlayedAndRefreshCatalog} from '../lib/podcasts/markEpisodeAsPlayedDesktop';
import {
  runDesktopPlayEpisodeUserAction,
  type PlaylistMachineContext,
} from '../lib/podcasts/desktopPlaybackPlayAction';
import type {PodcastEpisode} from '../lib/podcasts/podcastTypes';
import {clearPlaylistEntry} from '../lib/vaultBootstrap';
import type {DesktopPlaybackContext} from './desktopPlaybackContext';

export function useDesktopPlaybackSessionActions(
  ctx: DesktopPlaybackContext,
  args: {
    actorRef: ActorRefFrom<typeof podcastPlayerMachine>;
    vaultRoot: string | null;
    fs: VaultFilesystem;
  },
) {
  const {
    vaultRootRef,
    fsRef,
    snapshotRef,
    deviceIdRef,
    lastPrimedPlaylistKeyRef,
    userPlaybackDepthRef,
    send,
    sendRef,
    onError,
    onPlaylistDiskUpdatedRef,
    onCatalogRefreshRef,
  } = ctx;
  const {actorRef, vaultRoot, fs} = args;

  const markEpisodePlayed = useCallback(
    async (ep: PodcastEpisode) => {
      await markDesktopEpisodeAsPlayedAndRefreshCatalog(
        vaultRootRef.current,
        fsRef.current,
        ep,
        onCatalogRefreshRef.current,
      );
    },
    [fsRef, onCatalogRefreshRef, vaultRootRef],
  );

  const playEpisode = useCallback(
    async (ep: PodcastEpisode) => {
      if (!vaultRoot) {
        return;
      }
      userPlaybackDepthRef.current += 1;
      try {
        await runDesktopPlayEpisodeUserAction(
          ep,
          vaultRoot,
          fs,
          onError,
          send,
          () => snapshotRef.current.context as PlaylistMachineContext,
          () => deviceIdRef.current,
          lastPrimedPlaylistKeyRef,
        );
      } catch (e) {
        if (isAbortError(e)) {
          return;
        }
        onError(e instanceof Error ? e.message : String(e));
        send({type: 'ERROR', message: e instanceof Error ? e.message : String(e)});
      } finally {
        userPlaybackDepthRef.current -= 1;
      }
    },
    [
      deviceIdRef,
      fs,
      lastPrimedPlaylistKeyRef,
      onError,
      send,
      snapshotRef,
      userPlaybackDepthRef,
      vaultRoot,
    ],
  );

  const waitForPersistFlushed = useCallback(async (timeoutMs: number) => {
    try {
      await waitFor(actorRef, snap => isPersistIdle(snap), {timeout: timeoutMs});
    } catch {
      /* timeout or actor stopped — continue shutdown */
    }
  }, [actorRef]);

  const dismissNowPlaying = useCallback(
    async () => {
      const root = vaultRootRef.current;
      if (!root) {
        return;
      }
      try {
        await getDesktopAudioPlayer().stop();
      } catch {
        /* ignore */
      }
      try {
        await clearPlaylistEntry(root, fsRef.current);
      } finally {
        lastPrimedPlaylistKeyRef.current = null;
        sendRef.current({type: 'RESET'});
        onPlaylistDiskUpdatedRef.current?.();
      }
    },
    [fsRef, lastPrimedPlaylistKeyRef, onPlaylistDiskUpdatedRef, sendRef, vaultRootRef],
  );

  return {
    markEpisodePlayed,
    playEpisode,
    waitForPersistFlushed,
    dismissNowPlaying,
  };
}

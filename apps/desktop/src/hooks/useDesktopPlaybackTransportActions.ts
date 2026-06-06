import {buildPlaylistEntryForWrite, MIN_PROGRESS_MS, type PlaylistEntry} from '@eskerra/core';
import {useCallback} from 'react';

import {getDesktopAudioPlayer} from '../lib/htmlAudioPlayer';
import {clampSeekMs, clampSeekToMs} from '../lib/podcasts/desktopPlaybackSeekHelpers';
import type {PodcastEpisode} from '../lib/podcasts/podcastTypes';
import {clearPlaylistEntry} from '../lib/vaultBootstrap';
import type {DesktopPlaybackContext} from './desktopPlaybackContext';

export function useDesktopPlaybackTransportActions(ctx: DesktopPlaybackContext) {
  const {
    send,
    snapshotRef,
    vaultRootRef,
    fsRef,
    episodesByIdRef,
    deviceIdRef,
    onPlaylistDiskUpdatedRef,
    lastPrimedPlaylistKeyRef,
    onError,
  } = ctx;

  const queuePersistFromProgress = useCallback(
    (episode: PodcastEpisode, positionMs: number, durationMs: number | null) => {
      const deviceId = deviceIdRef.current;
      if (!deviceId) {
        onError('Device id missing from local settings.');
        return;
      }
      const machineCtx = snapshotRef.current.context;
      const base: PlaylistEntry =
        machineCtx.playlistBaseline?.episodeId === episode.id
          ? machineCtx.playlistBaseline
          : {
              durationMs,
              episodeId: episode.id,
              mp3Url: episode.mp3Url,
              positionMs: 0,
              updatedAt: 0,
              playbackOwnerId: '',
              controlRevision: 0,
            };
      const entry = buildPlaylistEntryForWrite(
        base,
        {
          durationMs,
          episodeId: episode.id,
          mp3Url: episode.mp3Url,
          positionMs,
        },
        deviceId,
        Date.now(),
      );
      send({type: 'QUEUE_PERSIST', entry});
    },
    [deviceIdRef, onError, send, snapshotRef],
  );

  const seekBy = useCallback(
    async (deltaMs: number) => {
      const ep = snapshotRef.current.context.episode
        ? episodesByIdRef.current.get(snapshotRef.current.context.episode!.id) ?? null
        : null;
      if (!ep) {
        return;
      }
      send({type: 'SEEK_START'});
      let needsSeekEnd = true;
      try {
        const p = getDesktopAudioPlayer();
        const progress = await p.getProgress();
        const next = clampSeekMs(
          progress.positionMs,
          progress.durationMs,
          deltaMs,
        );
        await p.seekTo(next);
        const latest = await p.getProgress();

        const root = vaultRootRef.current;
        if (!root) {
          return;
        }

        if (latest.positionMs < MIN_PROGRESS_MS) {
          await p.stop();
          await clearPlaylistEntry(root, fsRef.current);
          lastPrimedPlaylistKeyRef.current = null;
          needsSeekEnd = false;
          send({type: 'RESET'});
          onPlaylistDiskUpdatedRef.current?.();
          return;
        }

        queuePersistFromProgress(ep, latest.positionMs, latest.durationMs);
      } catch (e) {
        onError(e instanceof Error ? e.message : 'Could not seek playback.');
      } finally {
        if (needsSeekEnd) {
          send({type: 'SEEK_END'});
        }
      }
    },
    [
      episodesByIdRef,
      fsRef,
      lastPrimedPlaylistKeyRef,
      onError,
      onPlaylistDiskUpdatedRef,
      queuePersistFromProgress,
      send,
      snapshotRef,
      vaultRootRef,
    ],
  );

  const seekTo = useCallback(
    async (absoluteMs: number) => {
      if (!vaultRootRef.current) {
        return;
      }
      const ep = snapshotRef.current.context.episode
        ? episodesByIdRef.current.get(snapshotRef.current.context.episode!.id) ?? null
        : null;
      if (!ep) {
        return;
      }
      send({type: 'SEEK_START'});
      let needsSeekEnd = true;
      try {
        const p = getDesktopAudioPlayer();
        const progress = await p.getProgress();
        const target = clampSeekToMs(absoluteMs, progress.durationMs);
        await p.seekTo(target);
        const latest = await p.getProgress();

        const root = vaultRootRef.current;
        if (!root) {
          return;
        }

        if (latest.positionMs < MIN_PROGRESS_MS) {
          await p.stop();
          await clearPlaylistEntry(root, fsRef.current);
          lastPrimedPlaylistKeyRef.current = null;
          needsSeekEnd = false;
          send({type: 'RESET'});
          onPlaylistDiskUpdatedRef.current?.();
          return;
        }

        queuePersistFromProgress(ep, latest.positionMs, latest.durationMs);
      } catch (e) {
        onError(e instanceof Error ? e.message : 'Could not seek playback.');
      } finally {
        if (needsSeekEnd) {
          send({type: 'SEEK_END'});
        }
      }
    },
    [
      episodesByIdRef,
      fsRef,
      lastPrimedPlaylistKeyRef,
      onError,
      onPlaylistDiskUpdatedRef,
      queuePersistFromProgress,
      send,
      snapshotRef,
      vaultRootRef,
    ],
  );

  const pauseIfPlaying = useCallback(async () => {
    const p = getDesktopAudioPlayer();
    if (!p.isPlaybackActive()) {
      return;
    }
    const ep = snapshotRef.current.context.episode
      ? episodesByIdRef.current.get(snapshotRef.current.context.episode!.id) ?? null
      : null;
    if (!ep) {
      return;
    }

    await p.pause();
    const latestProgress = await p.getProgress();
    send({
      type: 'PROGRESS',
      positionMs: latestProgress.positionMs,
      durationMs: latestProgress.durationMs,
    });
    send({type: 'NATIVE', state: 'paused'});

    const root = vaultRootRef.current;
    if (!root) {
      return;
    }
    const deviceId = deviceIdRef.current;
    if (!deviceId) {
      onError('Device id missing from local settings.');
      return;
    }

    try {
      if (latestProgress.positionMs < MIN_PROGRESS_MS) {
        await clearPlaylistEntry(root, fsRef.current);
        onPlaylistDiskUpdatedRef.current?.();
        return;
      }

      queuePersistFromProgress(
        ep,
        latestProgress.positionMs,
        latestProgress.durationMs,
      );
    } catch (e) {
      onError(
        e instanceof Error ? e.message : 'Could not save playback position.',
      );
    }
  },
  [
    deviceIdRef,
    episodesByIdRef,
    fsRef,
    onError,
    onPlaylistDiskUpdatedRef,
    queuePersistFromProgress,
    send,
    snapshotRef,
    vaultRootRef,
  ]);

  const togglePause = useCallback(async () => {
    const p = getDesktopAudioPlayer();
    const ep = snapshotRef.current.context.episode
      ? episodesByIdRef.current.get(snapshotRef.current.context.episode!.id) ?? null
      : null;
    if (!ep) {
      return;
    }

    if (p.isPlaybackActive()) {
      await pauseIfPlaying();
      return;
    }

    await p.resume();
    const resumeProgress = await p.getProgress();

    const resumeDeviceId = deviceIdRef.current;
    if (!resumeDeviceId) {
      onError('Device id missing from local settings.');
      return;
    }

    try {
      queuePersistFromProgress(
        ep,
        resumeProgress.positionMs,
        resumeProgress.durationMs,
      );
    } catch (e) {
      onError(
        e instanceof Error ? e.message : 'Could not save playback position.',
      );
    }
  },
  [
    deviceIdRef,
    episodesByIdRef,
    onError,
    pauseIfPlaying,
    queuePersistFromProgress,
    snapshotRef,
  ]);

  return {
    queuePersistFromProgress,
    seekBy,
    seekTo,
    pauseIfPlaying,
    togglePause,
  };
}

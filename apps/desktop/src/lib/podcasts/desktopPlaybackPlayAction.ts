import {
  buildPlaylistEntryForWrite,
  type PlayerEpisodeSnapshot,
  type PlaylistEntry,
  type VaultFilesystem,
} from '@eskerra/core';
import type {MutableRefObject} from 'react';

import {getDesktopAudioPlayer} from '../htmlAudioPlayer';
import {readPlaylistEntry} from '../vaultBootstrap';
import {channelArtworkUrlForMediaSession} from './desktopPlaybackPriming';
import {episodeToSnapshot} from './desktopPlaybackSeekHelpers';
import type {PodcastEpisode} from './podcastTypes';

export type DesktopPlaySend = (
  ev:
    | {type: 'EPISODE_PLAY'; episode: PlayerEpisodeSnapshot; baseline: PlaylistEntry | null}
    | {type: 'QUEUE_PERSIST'; entry: PlaylistEntry}
    | {type: 'ERROR'; message: string},
) => void;

export type PlaylistMachineContext = {
  playlistBaseline: PlaylistEntry | null;
  episode: PlayerEpisodeSnapshot | null;
};

export function computeStartPositionMsFromPrior(
  prior: PlaylistEntry | null,
  ep: PodcastEpisode,
  switchingFromAnother: boolean,
): number {
  if (switchingFromAnother) {
    return 0;
  }
  if (prior?.episodeId === ep.id) {
    return prior.positionMs;
  }
  return 0;
}

export function queuePlaylistPersistForPlay(
  ep: PodcastEpisode,
  startPositionMs: number,
  prior: PlaylistEntry | null,
  deviceId: string,
  send: DesktopPlaySend,
): void {
  const base: PlaylistEntry =
    prior?.episodeId === ep.id
      ? prior
      : {
          durationMs: null,
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
      durationMs: null,
      episodeId: ep.id,
      mp3Url: ep.mp3Url,
      positionMs: startPositionMs,
    },
    deviceId,
    Date.now(),
  );
  send({type: 'QUEUE_PERSIST', entry});
}

/** User-initiated play from Episodes list (separate from hook for cognitive complexity). */
export async function runDesktopPlayEpisodeUserAction(
  ep: PodcastEpisode,
  vaultRoot: string,
  fs: VaultFilesystem,
  onError: (msg: string | null) => void,
  send: DesktopPlaySend,
  getMachineContext: () => PlaylistMachineContext,
  getDeviceId: () => string | null,
  lastPrimedKeyRef: MutableRefObject<string | null>,
): Promise<void> {
  const ctx = getMachineContext();
  const switchingFromAnother =
    ctx.episode != null && ctx.episode.id !== ep.id;

  const player = getDesktopAudioPlayer();
  const st = await player.getState();
  const loadedId = player.getCurrentTrackEpisodeId();
  const loadedTrack = player.getLoadedTrack();
  const sameLoadedEp =
    loadedId === ep.id
    && loadedTrack != null
    && loadedTrack.url === ep.mp3Url;

  if (st === 'playing' && sameLoadedEp) {
    return;
  }

  if (!sameLoadedEp) {
    await player.stop();
  }

  lastPrimedKeyRef.current = null;
  onError(null);
  send({
    type: 'EPISODE_PLAY',
    episode: episodeToSnapshot(ep),
    baseline: ctx.playlistBaseline,
  });

  let prior: PlaylistEntry | null = null;
  try {
    prior = await readPlaylistEntry(vaultRoot, fs);
  } catch {
    prior = null;
  }
  const startPositionMs = computeStartPositionMsFromPrior(
    prior,
    ep,
    switchingFromAnother,
  );

  const deviceId = getDeviceId();
  if (deviceId) {
    queuePlaylistPersistForPlay(ep, startPositionMs, prior, deviceId, send);
  } else {
    onError('Device id missing from local settings.');
  }

  const artwork = await channelArtworkUrlForMediaSession(ep.id, ep.rssFeedUrl);
  await getDesktopAudioPlayer().play(
    {
      artist: ep.seriesName,
      id: ep.id,
      title: ep.title,
      url: ep.mp3Url,
      ...(artwork ? {artwork} : {}),
    },
    startPositionMs,
  );
}

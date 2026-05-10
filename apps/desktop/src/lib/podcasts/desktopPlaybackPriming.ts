import type {PlaylistEntry, PlayerState} from '@eskerra/core';
import type {MutableRefObject} from 'react';

import {
  getDesktopAudioPlayer,
  notifyDesktopMprisArtworkReady,
} from '../htmlAudioPlayer';
import {peekCachedArtworkUri, resolveArtworkUri} from './artworkCacheDesktop';
import type {PodcastEpisode} from './podcastTypes';

/** When RSS channel artwork URL is not yet in memory cache, resolve it in the background for MediaSession. */
function scheduleMediaSessionChannelArtwork(episodeId: string, rssFeedUrl: string): void {
  void (async () => {
    let remote: string | null;
    try {
      remote = await resolveArtworkUri(rssFeedUrl);
    } catch {
      remote = null;
    }
    if (!remote) {
      return;
    }
    await notifyDesktopMprisArtworkReady(episodeId, remote);
  })();
}

/**
 * Returns a remote cover URL when the feed artwork is already known (peek hit);
 * otherwise schedules background resolve + cache and returns `undefined`.
 */
export async function channelArtworkUrlForMediaSession(
  episodeId: string,
  rssFeedUrl: string | undefined,
): Promise<string | undefined> {
  if (!rssFeedUrl) {
    return undefined;
  }
  const peek = peekCachedArtworkUri(rssFeedUrl);
  if (peek === null) {
    return undefined;
  }
  if (peek === undefined) {
    scheduleMediaSessionChannelArtwork(episodeId, rssFeedUrl);
    return undefined;
  }
  return peek.trim() || undefined;
}

type PrimedPlayingOrLoadingDone =
  | {done: true}
  | {done: false; st: PlayerState};

async function primedResolvePlayingOrLoadingState(
  player: ReturnType<typeof getDesktopAudioPlayer>,
  st: PlayerState,
  pl: PlaylistEntry,
  key: string,
  lastPrimedKeyRef: MutableRefObject<string | null>,
): Promise<PrimedPlayingOrLoadingDone> {
  if (st === 'playing') {
    const currentId = player.getCurrentTrackEpisodeId();
    if (currentId === pl.episodeId) {
      lastPrimedKeyRef.current = key;
      return {done: true};
    }
    await player.stop();
    return {done: false, st: await player.getState()};
  }
  if (st === 'loading') {
    const loadingEpisodeId = player.getCurrentTrackEpisodeId();
    if (loadingEpisodeId === pl.episodeId) {
      lastPrimedKeyRef.current = key;
      return {done: true};
    }
    if (loadingEpisodeId != null && loadingEpisodeId !== pl.episodeId) {
      await player.stop();
      return {done: false, st: await player.getState()};
    }
  }
  return {done: false, st};
}

async function tryPrimedSeekIfPausedOnLoadedSameTrack(
  st: PlayerState,
  player: ReturnType<typeof getDesktopAudioPlayer>,
  pl: PlaylistEntry,
  catalogEp: PodcastEpisode,
  key: string,
  lastPrimedKeyRef: MutableRefObject<string | null>,
  isCancelled: () => boolean,
): Promise<boolean> {
  if (st !== 'paused' && st !== 'ended') {
    return false;
  }
  const currentId = player.getCurrentTrackEpisodeId();
  const loaded = player.getLoadedTrack();
  if (
    currentId === pl.episodeId
    && loaded != null
    && loaded.url === catalogEp.mp3Url
  ) {
    await player.seekTo(pl.positionMs);
    if (isCancelled()) {
      return true;
    }
    lastPrimedKeyRef.current = key;
    return true;
  }
  return false;
}

async function runPrimedPrimePausedWithArtwork(
  pl: PlaylistEntry,
  catalogEp: PodcastEpisode,
  key: string,
  isCancelled: () => boolean,
  lastPrimedKeyRef: MutableRefObject<string | null>,
  onError: (message: string) => void,
): Promise<void> {
  const player = getDesktopAudioPlayer();
  const trackUrl = catalogEp.mp3Url;
  try {
    const artwork = await channelArtworkUrlForMediaSession(catalogEp.id, catalogEp.rssFeedUrl);
    await player.primePausedAt(
      {
        artist: catalogEp.seriesName,
        id: catalogEp.id,
        title: catalogEp.title,
        url: trackUrl,
        ...(artwork ? {artwork} : {}),
      },
      pl.positionMs,
    );
    if (isCancelled()) {
      return;
    }
    lastPrimedKeyRef.current = key;
  } catch (e) {
    try {
      await getDesktopAudioPlayer().stop();
    } catch {
      /* ignore */
    }
    if (!isCancelled()) {
      onError(
        e instanceof Error
          ? e.message
          : 'Could not load episode audio for resume preview.',
      );
    }
  }
}

/** Resume primed native player to playlist position (separate from hook for cognitive complexity). */
export async function runDesktopPrimedPlaylistNativeResume(options: {
  isCancelled: () => boolean;
  pl: PlaylistEntry;
  catalogEp: PodcastEpisode;
  key: string;
  lastPrimedKeyRef: MutableRefObject<string | null>;
  onError: (message: string) => void;
}): Promise<void> {
  const {isCancelled, pl, catalogEp, key, lastPrimedKeyRef, onError} = options;
  const player = getDesktopAudioPlayer();
  let st = await player.getState();
  if (isCancelled()) {
    return;
  }
  const playingOr = await primedResolvePlayingOrLoadingState(
    player,
    st,
    pl,
    key,
    lastPrimedKeyRef,
  );
  if (playingOr.done) {
    return;
  }
  st = playingOr.st;

  if (isCancelled()) {
    return;
  }

  const didSeek = await tryPrimedSeekIfPausedOnLoadedSameTrack(
    st,
    player,
    pl,
    catalogEp,
    key,
    lastPrimedKeyRef,
    isCancelled,
  );
  if (didSeek) {
    return;
  }

  if (isCancelled()) {
    return;
  }

  await runPrimedPrimePausedWithArtwork(
    pl,
    catalogEp,
    key,
    isCancelled,
    lastPrimedKeyRef,
    onError,
  );
}

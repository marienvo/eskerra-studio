import type {PlayerEpisodeSnapshot} from '@eskerra/core';

import type {PodcastEpisode} from './podcastTypes';

export function clampSeekMs(
  positionMs: number,
  durationMs: number | null,
  deltaMs: number,
): number {
  const next = positionMs + deltaMs;
  if (next < 0) {
    return 0;
  }
  if (durationMs != null && durationMs > 0) {
    return Math.min(durationMs, next);
  }
  return next;
}

export function clampSeekToMs(targetMs: number, durationMs: number | null): number {
  const t = Math.max(0, targetMs);
  if (durationMs != null && durationMs > 0) {
    return Math.min(durationMs, t);
  }
  return t;
}

export function episodeToSnapshot(ep: PodcastEpisode): PlayerEpisodeSnapshot {
  return {
    id: ep.id,
    mp3Url: ep.mp3Url,
    title: ep.title,
    artist: ep.seriesName,
  };
}

import type {PlayerEpisodeSnapshot, PodcastPlayerMachineEvent} from '@eskerra/core';
import {useEffect} from 'react';

import type {PodcastEpisode} from '../lib/podcasts/podcastTypes';

export function useDesktopPlaybackCatalogProbe(args: {
  consumeCatalogReady: boolean;
  episodesById: Map<string, PodcastEpisode>;
  send: (event: PodcastPlayerMachineEvent) => void;
  snapCtxEpisode: PlayerEpisodeSnapshot | null | undefined;
}): void {
  const {consumeCatalogReady, episodesById, send, snapCtxEpisode} = args;
  useEffect(() => {
    if (!consumeCatalogReady) {
      return;
    }
    const id = snapCtxEpisode?.id;
    if (!id) {
      return;
    }
    if (!episodesById.has(id)) {
      send({type: 'RESET'});
    }
  }, [consumeCatalogReady, episodesById, send, snapCtxEpisode]);
}

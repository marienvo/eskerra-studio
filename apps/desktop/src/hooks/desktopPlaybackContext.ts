import {
  podcastPlayerMachine,
  type PodcastPlayerMachineEvent,
  type VaultFilesystem,
} from '@eskerra/core';
import type {MutableRefObject} from 'react';
import type {SnapshotFrom} from 'xstate';

import type {PodcastEpisode} from '../lib/podcasts/podcastTypes';

export type DesktopPlaybackMachineSnapshot = SnapshotFrom<typeof podcastPlayerMachine>;

export type DesktopPlaybackMachineContext = DesktopPlaybackMachineSnapshot['context'];

export type DesktopPlaybackContext = {
  send: (event: PodcastPlayerMachineEvent) => void;
  snapshotRef: MutableRefObject<DesktopPlaybackMachineSnapshot>;
  vaultRootRef: MutableRefObject<string | null>;
  fsRef: MutableRefObject<VaultFilesystem>;
  episodesByIdRef: MutableRefObject<Map<string, PodcastEpisode>>;
  consumeEpisodesRef: MutableRefObject<readonly PodcastEpisode[]>;
  deviceIdRef: MutableRefObject<string>;
  onPlaylistDiskUpdatedRef: MutableRefObject<(() => void) | undefined>;
  lastPrimedPlaylistKeyRef: MutableRefObject<string | null>;
  userPlaybackDepthRef: MutableRefObject<number>;
  onError: (msg: string | null) => void;
};

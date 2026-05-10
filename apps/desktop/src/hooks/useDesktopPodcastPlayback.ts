import {
  buildPlaylistEntryForWrite,
  getPlaybackSubstate,
  getPlaybackTransportPlayControl,
  isPersistIdle,
  isPlaybackTransportBusy,
  MIN_PROGRESS_MS,
  type PlaybackTransportPlayControl,
  type PlayerEpisodeSnapshot,
  type PlaylistEntry,
  type PlayerState,
  podcastPlayerMachine,
  type PodcastPlayerDeps,
  type PodcastPlayerPlaybackState,
  type VaultFilesystem,
} from '@eskerra/core';
import {invoke} from '@tauri-apps/api/core';
import {useMachine} from '@xstate/react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type MutableRefObject,
} from 'react';
import {waitFor} from 'xstate';

import {
  getDesktopAudioPlayer,
  isAbortError,
  notifyDesktopMprisArtworkReady,
} from '../lib/htmlAudioPlayer';
import {peekCachedArtworkUri, resolveArtworkUri} from '../lib/podcasts/artworkCacheDesktop';
import {
  markDesktopEpisodeAsPlayed,
  markDesktopEpisodeAsPlayedAndRefreshCatalog,
} from '../lib/podcasts/markEpisodeAsPlayedDesktop';
import type {PodcastEpisode} from '../lib/podcasts/podcastTypes';
import {
  clearPlaylistEntry,
  readPlaylistEntry,
  writePlaylistEntry,
} from '../lib/vaultBootstrap';

const NEAR_END_SUBSTATES = new Set<PodcastPlayerPlaybackState>([
  'markingNearEnd',
  'nearEndPlaying',
  'nearEndPaused',
  'ended',
]);

async function cacheRemoteArtworkToFileUri(remoteUrl: string): Promise<string | null> {
  try {
    return await invoke<string>('media_cache_artwork', {url: remoteUrl});
  } catch {
    return null;
  }
}

/** When RSS channel artwork URL is not yet in memory cache, resolve + download in the background for MPRIS. */
function scheduleMprisChannelArtwork(episodeId: string, rssFeedUrl: string): void {
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
    const file = await cacheRemoteArtworkToFileUri(remote);
    if (file) {
      await notifyDesktopMprisArtworkReady(episodeId, file);
    }
  })();
}

/**
 * Returns a `file://` cover URI when the feed artwork is already known (peek hit);
 * otherwise schedules background resolve + cache and returns `undefined`.
 */
async function channelArtworkFileUriForMpris(
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
    scheduleMprisChannelArtwork(episodeId, rssFeedUrl);
    return undefined;
  }
  const file = await cacheRemoteArtworkToFileUri(peek);
  return file ?? undefined;
}

function clampSeekMs(
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

export type DesktopPlayerLabel = PodcastPlayerPlaybackState | 'nativeLoading';

function episodeToSnapshot(ep: PodcastEpisode): PlayerEpisodeSnapshot {
  return {
    id: ep.id,
    mp3Url: ep.mp3Url,
    title: ep.title,
    artist: ep.seriesName,
  };
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
    const artwork = await channelArtworkFileUriForMpris(catalogEp.id, catalogEp.rssFeedUrl);
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
async function runDesktopPrimedPlaylistNativeResume(options: {
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

type DesktopPlaySend = (
  ev:
    | {type: 'EPISODE_PLAY'; episode: PlayerEpisodeSnapshot; baseline: PlaylistEntry | null}
    | {type: 'QUEUE_PERSIST'; entry: PlaylistEntry}
    | {type: 'ERROR'; message: string},
) => void;

type PlaylistMachineContext = {
  playlistBaseline: PlaylistEntry | null;
  episode: PlayerEpisodeSnapshot | null;
};

function computeStartPositionMsFromPrior(
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

function queuePlaylistPersistForPlay(
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
async function runDesktopPlayEpisodeUserAction(
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

  const artwork = await channelArtworkFileUriForMpris(ep.id, ep.rssFeedUrl);
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

export type UseDesktopPodcastPlaybackOptions = {
  vaultRoot: string | null;
  /** From `.eskerra/settings-local.json`; used as `playbackOwnerId` for control writes. */
  deviceInstanceId: string;
  fs: VaultFilesystem;
  onError: (msg: string | null) => void;
  onPlaylistDiskUpdated?: () => void;
  playlistRevision: number;
  /** Flat episode list from the podcasts catalog (Episodes tab). */
  consumeEpisodes: PodcastEpisode[];
  /**
   * True when the Episodes tab is mounted and its latest refresh has finished (`!loading`),
   * so `consumeEpisodes` can be trusted for playlist reconciliation.
   */
  consumeCatalogReady: boolean;
  /** When true, playlist reads/writes use R2 only (no local `playlist.json` persistence). */
  r2PlaylistConfigured: boolean;
  /** Optional catalog rescan after markdown mark-as-played. */
  onCatalogRefresh?: () => Promise<void>;
};

export type UseDesktopPodcastPlaybackResult = {
  activeEpisode: PodcastEpisode | null;
  /** Id of the episode loaded in the player (for list highlighting). */
  activeEpisodeId: string | null;
  /** Play button / list chrome for the active episode (from machine + native audio). */
  activeEpisodePlayControl: PlaybackTransportPlayControl;
  /** Playback phase + native loading for status UI. */
  playerLabel: DesktopPlayerLabel;
  positionMs: number;
  durationMs: number | null;
  playEpisode: (ep: PodcastEpisode) => Promise<void>;
  /** Mark an episode as listened in vault markdown and rescan the catalog (no audio stop). */
  markEpisodePlayed: (ep: PodcastEpisode) => Promise<void>;
  seekBy: (deltaMs: number) => Promise<void>;
  togglePause: () => Promise<void>;
  /**
   * Pause native audio and queue playlist persist (same as user pause while playing).
   * No-op when not playing. For shutdown, call then `waitForPersistFlushed`.
   */
  pauseIfPlaying: () => Promise<void>;
  /** Resolves when persist is idle or after `timeoutMs` (never throws). */
  waitForPersistFlushed: (timeoutMs: number) => Promise<void>;
  /** True while the native element is `playing` (episode list locked). */
  episodeSelectLocked: boolean;
  /**
   * True while local playback transport is `playing`, `buffering`, or `loading` (e.g. pause R2 polling).
   */
  localPlaybackActive: boolean;
  playbackTransportPlayControl: PlaybackTransportPlayControl;
  seekDisabled: boolean;
  /**
   * Stop audio, clear the playlist entry, and reset playback state without marking the episode as listened.
   */
  dismissNowPlaying: () => Promise<void>;
};

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
  const nearEndNonceHandledRef = useRef(0);

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

  useEffect(() => {
    if (!consumeCatalogReady) {
      return;
    }
    const id = snapCtx.episode?.id;
    if (!id) {
      return;
    }
    if (!episodesById.has(id)) {
      send({type: 'RESET'});
    }
  }, [consumeCatalogReady, episodesById, send, snapCtx.episode]);

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

  const markEpisodePlayed = useCallback(async (ep: PodcastEpisode) => {
    await markDesktopEpisodeAsPlayedAndRefreshCatalog(
      vaultRootRef.current,
      fsRef.current,
      ep,
      onCatalogRefreshRef.current,
    );
  }, []);

  const seekDisabled = isPlaybackTransportBusy(snapCtx);

  useEffect(() => {
    lastPrimedPlaylistKeyRef.current = null;
  }, [vaultRoot]);

  useEffect(() => {
    const player = getDesktopAudioPlayer();
    const unsub = player.addStateListener(s => {
      send({type: 'NATIVE', state: s});
    });
    return () => {
      unsub();
    };
  }, [send]);

  useEffect(() => {
    const player = getDesktopAudioPlayer();
    const unsubProg = player.addProgressListener(p => {
      send({type: 'PROGRESS', positionMs: p.positionMs, durationMs: p.durationMs});
    });
    return () => {
      unsubProg();
    };
  }, [send]);

  useEffect(() => {
    const player = getDesktopAudioPlayer();
    const unsub = player.addBufferingListener(buffering => {
      send({type: 'BUFFERING', buffering});
    });
    return () => {
      unsub();
    };
  }, [send]);

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
  }, [vaultRoot, fs, playlistRevision, send]);

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
    const ctx = snapshotRef.current.context;
    const base: PlaylistEntry =
      ctx.playlistBaseline?.episodeId === ep.id
        ? ctx.playlistBaseline
        : {
            durationMs: ctx.durationMs,
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
        durationMs: ctx.durationMs,
        episodeId: ep.id,
        mp3Url: ep.mp3Url,
        positionMs: ctx.positionMs,
      },
      deviceId,
      Date.now(),
    );
    send({type: 'QUEUE_PERSIST', entry});
  }, [
    snapCtx.nearEndResyncNonce,
    snapCtx.inNearEndZone,
    snapCtx.episode,
    snapCtx.durationMs,
    snapCtx.positionMs,
    vaultRoot,
    episodesById,
    send,
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
      isCancelled: () => cancelled,
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
    vaultRoot,
    consumeCatalogReady,
    playbackSub,
    snapCtx.playlistBaseline,
    snapCtx.episode,
    onError,
  ]);

  useEffect(() => {
    if (playbackSub !== 'idle' || snapCtx.episode != null) {
      return;
    }
    getDesktopAudioPlayer()
      .stop()
      .catch(() => undefined);
  }, [playbackSub, snapCtx.episode]);

  const queuePersistFromProgress = useCallback(
    (episode: PodcastEpisode, positionMs: number, durationMs: number | null) => {
      const deviceId = deviceIdRef.current;
      if (!deviceId) {
        onError('Device id missing from local settings.');
        return;
      }
      const ctx = snapshotRef.current.context;
      const base: PlaylistEntry =
        ctx.playlistBaseline?.episodeId === episode.id
          ? ctx.playlistBaseline
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
    [onError, send],
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
    [vaultRoot, fs, onError, send],
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
          send({type: 'RESET'});
          onPlaylistDiskUpdatedRef.current?.();
          return;
        }

        queuePersistFromProgress(ep, latest.positionMs, latest.durationMs);
      } catch (e) {
        onError(e instanceof Error ? e.message : 'Could not seek playback.');
      } finally {
        send({type: 'SEEK_END'});
      }
    },
    [onError, queuePersistFromProgress, send],
  );

  const pauseIfPlaying = useCallback(async () => {
    const p = getDesktopAudioPlayer();
    const st = await p.getState();
    if (st !== 'playing') {
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
  }, [onError, queuePersistFromProgress]);

  const waitForPersistFlushed = useCallback(async (timeoutMs: number) => {
    try {
      await waitFor(actorRef, snap => isPersistIdle(snap), {timeout: timeoutMs});
    } catch {
      /* timeout or actor stopped — continue shutdown */
    }
  }, [actorRef]);

  const togglePause = useCallback(async () => {
    const p = getDesktopAudioPlayer();
    const st = await p.getState();
    const ep = snapshotRef.current.context.episode
      ? episodesByIdRef.current.get(snapshotRef.current.context.episode!.id) ?? null
      : null;
    if (!ep) {
      return;
    }

    if (st === 'playing') {
      await pauseIfPlaying();
    } else if (
      st === 'paused' ||
      st === 'ended' ||
      st === 'loading' ||
      st === 'error'
    ) {
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
    }
  }, [onError, queuePersistFromProgress, pauseIfPlaying]);

  const dismissNowPlaying = useCallback(async () => {
    const root = vaultRootRef.current;
    if (!root) {
      return;
    }
    try {
      await getDesktopAudioPlayer().stop();
    } catch {
      /* ignore */
    }
    await clearPlaylistEntry(root, fsRef.current);
    lastPrimedPlaylistKeyRef.current = null;
    sendRef.current({type: 'RESET'});
    onPlaylistDiskUpdatedRef.current?.();
  }, []);

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
    seekDisabled,
    togglePause,
    pauseIfPlaying,
    waitForPersistFlushed,
    dismissNowPlaying,
  };
}

import type {
  PlayerEpisodeSnapshot,
  PodcastPlayerMachineEvent,
  PodcastPlayerPlaybackState,
} from '@eskerra/core';
import {useEffect} from 'react';

import {getDesktopAudioPlayer} from '../lib/htmlAudioPlayer';

export function useDesktopPlaybackNativeListeners(
  send: (event: PodcastPlayerMachineEvent) => void,
): void {
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
}

/** Idle native cleanup — registered after playlist sync to match prior effect order. */
export function useDesktopPlaybackNativeIdleStop(
  playbackSub: PodcastPlayerPlaybackState,
  snapCtxEpisode: PlayerEpisodeSnapshot | null,
): void {
  useEffect(() => {
    if (playbackSub !== 'idle' || snapCtxEpisode != null) {
      return;
    }
    getDesktopAudioPlayer()
      .stop()
      .catch(() => undefined);
  }, [playbackSub, snapCtxEpisode]);
}

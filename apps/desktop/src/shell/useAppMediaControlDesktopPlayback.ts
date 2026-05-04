import {listen} from '@tauri-apps/api/event';
import {useEffect, type MutableRefObject} from 'react';

import type {useDesktopPodcastPlayback} from '../hooks/useDesktopPodcastPlayback';
import {getDesktopAudioPlayer} from '../lib/htmlAudioPlayer';

export function useAppMediaControlDesktopPlayback(
  desktopPlaybackRef: MutableRefObject<
    ReturnType<typeof useDesktopPodcastPlayback>
  >,
) {
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    listen<string>('media-control', event => {
      const action = event.payload;
      const p = getDesktopAudioPlayer();
      (async () => {
        if (action === 'pause' || action === 'stop') {
          if ((await p.getState()) === 'playing') {
            await desktopPlaybackRef.current.togglePause();
          } else if (action === 'stop') {
            await p.pause();
          }
          return;
        }
        if (action === 'play' || action === 'toggle') {
          await desktopPlaybackRef.current.togglePause();
        }
      })().catch(() => undefined);
    })
      .then(fn => {
        if (cancelled) {
          fn();
        } else {
          unlisten = fn;
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [desktopPlaybackRef]);
}

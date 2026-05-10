import {useEffect, type MutableRefObject} from 'react';

import type {useDesktopPodcastPlayback} from '../hooks/useDesktopPodcastPlayback';
import {getDesktopAudioPlayer} from '../lib/htmlAudioPlayer';

export function useAppMediaControlDesktopPlayback(
  desktopPlaybackRef: MutableRefObject<
    ReturnType<typeof useDesktopPodcastPlayback>
  >,
) {
  useEffect(() => {
    const ms =
      typeof navigator !== 'undefined' ? navigator.mediaSession : undefined;
    if (!ms?.setActionHandler) {
      return;
    }

    const onPlay = () => {
      const run = async () => {
        const st = await getDesktopAudioPlayer().getState();
        if (st === 'playing') {
          return;
        }
        await desktopPlaybackRef.current.togglePause();
      };
      run().catch(() => undefined);
    };

    const onPause = () => {
      desktopPlaybackRef.current.pauseIfPlaying().catch(() => undefined);
    };

    try {
      ms.setActionHandler('play', onPlay);
      ms.setActionHandler('pause', onPause);
    } catch {
      return;
    }

    return () => {
      try {
        ms.setActionHandler('play', null);
        ms.setActionHandler('pause', null);
      } catch {
        /* ignore */
      }
    };
  }, [desktopPlaybackRef]);
}

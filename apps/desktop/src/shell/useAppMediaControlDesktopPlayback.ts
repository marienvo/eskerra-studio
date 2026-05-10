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

    const onStop = () => {
      desktopPlaybackRef.current.dismissNowPlaying().catch(() => undefined);
    };

    const trySetHandler = (
      action: 'play' | 'pause' | 'stop',
      handler: (() => void) | null,
    ) => {
      try {
        ms.setActionHandler(action, handler);
      } catch {
        /* Action may be unsupported on this WebView / browser build. */
      }
    };

    trySetHandler('play', onPlay);
    trySetHandler('pause', onPause);
    trySetHandler('stop', onStop);

    return () => {
      trySetHandler('play', null);
      trySetHandler('pause', null);
      trySetHandler('stop', null);
    };
  }, [desktopPlaybackRef]);
}

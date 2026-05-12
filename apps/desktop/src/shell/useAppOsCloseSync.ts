import {isTauri} from '@tauri-apps/api/core';
import {getCurrentWindow} from '@tauri-apps/api/window';
import {
  saveWindowState,
  StateFlags,
} from '@tauri-apps/plugin-window-state';
import {useCallback, useEffect, useRef, type MutableRefObject} from 'react';

import type {useDesktopPodcastPlayback} from '../hooks/useDesktopPodcastPlayback';
import {PLAYBACK_PERSIST_DRAIN_TIMEOUT_MS} from '../lib/podcasts/playbackPersistTimeout';
import type {SessionNotificationTone} from '../lib/sessionNotifications';
import {handleOsCloseRequest} from '../lib/manualSyncClose';

type UseAppOsCloseSyncArgs = {
  desktopPlaybackRef: MutableRefObject<ReturnType<typeof useDesktopPodcastPlayback>>;
  flushInboxSave: () => void | Promise<void>;
  manualSyncDisabledReason: string | null;
  manualSyncRunning: boolean;
  runManualSync: () => Promise<boolean>;
  notify: (tone: SessionNotificationTone, text: string) => void;
};

type UseAppOsCloseSyncResult = {
  /**
   * Call this instead of closeDesktopMainWindow() when the close is intentional
   * (e.g. after successful sync-before-close). Sets the allow-close flag so the
   * OS-close interceptor skips the sync step and proceeds directly to shutdown.
   */
  programmaticClose: () => void;
};

/**
 * Intercepts Tauri onCloseRequested (OS/window-manager close), runs sync-before-close
 * with an overall timeout, and only destroys the window on success. Returns
 * programmaticClose() for callers that need to close after their own sync flow.
 */
export function useAppOsCloseSync({
  desktopPlaybackRef,
  flushInboxSave,
  manualSyncDisabledReason,
  manualSyncRunning,
  runManualSync,
  notify,
}: UseAppOsCloseSyncArgs): UseAppOsCloseSyncResult {
  const allowCloseRef = useRef(false);
  const closeSyncInProgressRef = useRef(false);

  // Stable refs so the effect (registered once) always reads current values.
  const manualSyncDisabledReasonRef = useRef(manualSyncDisabledReason);
  const manualSyncRunningRef = useRef(manualSyncRunning);
  const runManualSyncRef = useRef(runManualSync);
  const notifyRef = useRef(notify);
  const flushInboxSaveRef = useRef(flushInboxSave);

  manualSyncDisabledReasonRef.current = manualSyncDisabledReason;
  manualSyncRunningRef.current = manualSyncRunning;
  runManualSyncRef.current = runManualSync;
  notifyRef.current = notify;
  flushInboxSaveRef.current = flushInboxSave;

  const programmaticClose = useCallback((): void => {
    allowCloseRef.current = true;
    if (!isTauri()) {
      return;
    }
    void getCurrentWindow().close();
  }, []);

  useEffect(() => {
    if (!isTauri()) {
      return;
    }
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    const win = getCurrentWindow();

    const performShutdown = async (): Promise<void> => {
      try {
        try {
          await desktopPlaybackRef.current.pauseIfPlaying();
          await desktopPlaybackRef.current.waitForPersistFlushed(
            PLAYBACK_PERSIST_DRAIN_TIMEOUT_MS,
          );
        } catch (e) {
          if (import.meta.env.DEV) {
            console.error('[eskerra] shutdown pause/flush failed', e);
          }
        }
        await flushInboxSaveRef.current();
        try {
          await saveWindowState(StateFlags.ALL);
        } catch (e) {
          if (import.meta.env.DEV) {
            console.error('[eskerra] saveWindowState failed', e);
          }
        }
      } finally {
        /* Avoid awaiting destroy inside onCloseRequested (Tauri can deadlock). */
        win.destroy();
      }
    };

    win
      .onCloseRequested(async event => {
        if (allowCloseRef.current) {
          // Programmatic close after successful sync — skip sync, run shutdown.
          await performShutdown();
          return;
        }

        event.preventDefault();

        await handleOsCloseRequest({
          manualSyncDisabledReason: manualSyncDisabledReasonRef.current,
          manualSyncRunning: manualSyncRunningRef.current,
          runManualSync: runManualSyncRef.current,
          notify: notifyRef.current,
          close: programmaticClose,
          closeSyncInProgressRef,
        });
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
  }, [desktopPlaybackRef, programmaticClose]);

  return {programmaticClose};
}

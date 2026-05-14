import {isTauri} from '@tauri-apps/api/core';
import {getCurrentWindow} from '@tauri-apps/api/window';
import {
  saveWindowState,
  StateFlags,
} from '@tauri-apps/plugin-window-state';
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type MutableRefObject,
} from 'react';

import type {useDesktopPodcastPlayback} from '../hooks/useDesktopPodcastPlayback';
import {PLAYBACK_PERSIST_DRAIN_TIMEOUT_MS} from '../lib/podcasts/playbackPersistTimeout';
import type {SessionNotificationTone} from '../lib/sessionNotifications';
import {handleOsCloseRequest} from '../lib/manualSyncClose';
import type {GitStatusResult} from '../lib/tauriVaultGitSync';

type UseAppOsCloseSyncArgs = {
  desktopPlaybackRef: MutableRefObject<ReturnType<typeof useDesktopPodcastPlayback>>;
  flushInboxSave: () => void | Promise<void>;
  manualSyncRequired?: boolean;
  manualSyncDisabledReason: string | null;
  manualSyncRunning: boolean;
  runManualSync: () => Promise<boolean>;
  notify: (tone: SessionNotificationTone, text: string) => void;
  gitStatus?: GitStatusResult | null;
  fetchFreshGitStatusForClose?: () => Promise<GitStatusResult | null>;
  closeSyncTimeoutMs?: number;
};

type UseAppOsCloseSyncResult = {
  /**
   * Call this instead of closeDesktopMainWindow() when the close is intentional
   * (e.g. after successful sync-before-close). Sets the allow-close flag so the
   * OS-close interceptor skips the sync step and proceeds directly to shutdown.
   */
  programmaticClose: () => void;
  /** True while an OS-close-triggered sync is in flight. */
  closeSyncInProgress: boolean;
};

/**
 * Intercepts Tauri onCloseRequested (OS/window-manager close), runs sync-before-close
 * with an overall timeout, and only destroys the window on success. Returns
 * programmaticClose() for callers that need to close after their own sync flow.
 */
export function useAppOsCloseSync({
  desktopPlaybackRef,
  flushInboxSave,
  manualSyncRequired = true,
  manualSyncDisabledReason,
  manualSyncRunning,
  runManualSync,
  notify,
  gitStatus = null,
  fetchFreshGitStatusForClose,
  closeSyncTimeoutMs,
}: UseAppOsCloseSyncArgs): UseAppOsCloseSyncResult {
  const allowCloseRef = useRef(false);
  const closeSyncInProgressRef = useRef(false);
  const [closeSyncInProgress, setCloseSyncInProgress] = useState(false);

  const programmaticClose = useCallback((): void => {
    allowCloseRef.current = true;
    if (!isTauri()) {
      return;
    }
    getCurrentWindow().close().catch(() => undefined);
  }, []);

  const flushBeforeShutdown = useEffectEvent(async () => {
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
    await flushInboxSave();
    try {
      await saveWindowState(StateFlags.ALL);
    } catch (e) {
      if (import.meta.env.DEV) {
        console.error('[eskerra] saveWindowState failed', e);
      }
    }
  });

  const onOsCloseRequested = useEffectEvent(async () => {
    await Promise.resolve(flushInboxSave()).catch(() => undefined);
    let gitStatusForClose = gitStatus;
    if (fetchFreshGitStatusForClose) {
      try {
        gitStatusForClose = await fetchFreshGitStatusForClose();
      } catch {
        gitStatusForClose = gitStatus;
      }
    }

    // Track reactive state alongside the ref so the overlay can render.
    const wrappedRunManualSync = async (): Promise<boolean> => {
      setCloseSyncInProgress(true);
      try {
        return await runManualSync();
      } finally {
        setCloseSyncInProgress(false);
      }
    };
    try {
      await handleOsCloseRequest({
        manualSyncRequired,
        manualSyncDisabledReason,
        manualSyncRunning,
        runManualSync: wrappedRunManualSync,
        notify,
        close: programmaticClose,
        closeSyncInProgressRef,
        timeoutMs: closeSyncTimeoutMs,
        gitStatus: gitStatusForClose,
      });
    } finally {
      setCloseSyncInProgress(false);
    }
  });

  useEffect(() => {
    if (!isTauri()) {
      return;
    }
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    const win = getCurrentWindow();

    const performShutdown = async (): Promise<void> => {
      try {
        await flushBeforeShutdown();
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

        await onOsCloseRequested();
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
  }, []);

  return {programmaticClose, closeSyncInProgress};
}

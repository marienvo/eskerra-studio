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
import {flushEmojiUsageToStore} from '../lib/emojiUsageStore';
import {flushQuickOpenUsageToStore} from '../lib/quickOpenUsageStore';
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
  /** How long to wait before showing the progress overlay (ms). Default 200. Pass 0 in tests. */
  closeSyncIndicatorDelayMs?: number;
  /** Returns the in-flight sync promise if one is running, or null if idle. */
  waitForCurrentRun?: () => Promise<boolean> | null;
};

type UseAppOsCloseSyncResult = {
  /**
   * Call this instead of closeDesktopMainWindow() when the close is intentional
   * (e.g. after successful sync-before-close). Sets the allow-close flag so the
   * OS-close interceptor skips the sync step and proceeds directly to shutdown.
   */
  programmaticClose: () => void;
  /** True while a close-triggered sync (or its preflight) is in flight and has exceeded the indicator delay. */
  closeSyncInProgress: boolean;
  /**
   * Wraps an async close flow: shows the progress overlay after the indicator delay if the
   * work takes longer than that, then hides it when done. Use this in both the OS-close path
   * and the title-bar close path so both show the overlay consistently.
   */
  markCloseSyncActive: <T>(fn: () => Promise<T>) => Promise<T>;
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
  gitStatus,
  fetchFreshGitStatusForClose,
  closeSyncTimeoutMs,
  closeSyncIndicatorDelayMs = 200,
  waitForCurrentRun,
}: UseAppOsCloseSyncArgs): UseAppOsCloseSyncResult {
  const allowCloseRef = useRef(false);
  const closeSyncInProgressRef = useRef(false);
  const [closeSyncInProgress, setCloseSyncInProgress] = useState(false);

  const markCloseSyncActive = useCallback(async <T>(fn: () => Promise<T>): Promise<T> => {
    const timerId = setTimeout(() => setCloseSyncInProgress(true), closeSyncIndicatorDelayMs);
    try {
      return await fn();
    } finally {
      clearTimeout(timerId);
      setCloseSyncInProgress(false);
    }
  }, [closeSyncIndicatorDelayMs]);

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
    await flushEmojiUsageToStore().catch(() => undefined);
    await flushQuickOpenUsageToStore().catch(() => undefined);
    try {
      await saveWindowState(StateFlags.ALL);
    } catch (e) {
      if (import.meta.env.DEV) {
        console.error('[eskerra] saveWindowState failed', e);
      }
    }
  });

  const onOsCloseRequested = useEffectEvent(async () => {
    await markCloseSyncActive(async () => {
      await Promise.resolve(flushInboxSave()).catch(() => undefined);
      let gitStatusForClose = gitStatus;
      if (fetchFreshGitStatusForClose) {
        try {
          gitStatusForClose = await fetchFreshGitStatusForClose();
        } catch {
          gitStatusForClose = gitStatus;
        }
      }
      await handleOsCloseRequest({
        manualSyncRequired,
        manualSyncDisabledReason,
        manualSyncRunning,
        runManualSync,
        notify,
        close: programmaticClose,
        closeSyncInProgressRef,
        timeoutMs: closeSyncTimeoutMs,
        gitStatus: gitStatusForClose,
        waitForCurrentRun,
      });
    });
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

  return {programmaticClose, closeSyncInProgress, markCloseSyncActive};
}

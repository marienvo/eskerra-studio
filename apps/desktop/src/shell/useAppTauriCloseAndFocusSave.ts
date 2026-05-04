import {isTauri} from '@tauri-apps/api/core';
import {getCurrentWindow} from '@tauri-apps/api/window';
import {
  saveWindowState,
  StateFlags,
} from '@tauri-apps/plugin-window-state';
import {useEffect, type MutableRefObject} from 'react';

import type {useDesktopPodcastPlayback} from '../hooks/useDesktopPodcastPlayback';

/** Max time to wait for R2 playlist persist after pausing on window close (debounce + network). */
const SHUTDOWN_PERSIST_TIMEOUT_MS = 3000;

export function useAppTauriCloseAndFocusSave(
  desktopPlaybackRef: MutableRefObject<
    ReturnType<typeof useDesktopPodcastPlayback>
  >,
  flushInboxSave: () => void | Promise<void>,
) {
  useEffect(() => {
    if (!isTauri()) {
      return;
    }
    let cancelled = false;
    let unlistenClose: (() => void) | undefined;
    let unlistenFocus: (() => void) | undefined;
    const win = getCurrentWindow();
    win
      .onCloseRequested(async event => {
        event.preventDefault();
        try {
          try {
            await desktopPlaybackRef.current.pauseIfPlaying();
            await desktopPlaybackRef.current.waitForPersistFlushed(
              SHUTDOWN_PERSIST_TIMEOUT_MS,
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
        } finally {
          /* Avoid awaiting destroy inside onCloseRequested (Tauri can deadlock waiting on this handler). */
          win.destroy();
        }
      })
      .then(fn => {
        if (cancelled) {
          fn();
        } else {
          unlistenClose = fn;
        }
      })
      .catch(() => undefined);
    win
      .onFocusChanged(({payload: focused}) => {
        if (!focused) {
          void flushInboxSave();
        }
      })
      .then(fn => {
        if (cancelled) {
          fn();
        } else {
          unlistenFocus = fn;
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      unlistenClose?.();
      unlistenFocus?.();
    };
  }, [desktopPlaybackRef, flushInboxSave]);
}

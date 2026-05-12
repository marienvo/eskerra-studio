import {isTauri} from '@tauri-apps/api/core';
import {getCurrentWindow} from '@tauri-apps/api/window';
import {useEffect} from 'react';

/** Flushes in-flight inbox saves when the window loses focus. */
export function useAppTauriCloseAndFocusSave(
  flushInboxSave: () => void | Promise<void>,
) {
  useEffect(() => {
    if (!isTauri()) {
      return;
    }
    let cancelled = false;
    let unlistenFocus: (() => void) | undefined;
    const win = getCurrentWindow();
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
      unlistenFocus?.();
    };
  }, [flushInboxSave]);
}

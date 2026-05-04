import {isTauri} from '@tauri-apps/api/core';
import {getCurrentWindow} from '@tauri-apps/api/window';
import {useLayoutEffect} from 'react';

export function useAppTauriDocumentChrome(
  maximized: boolean,
  tiling: 'none' | 'left' | 'right',
) {
  useLayoutEffect(() => {
    if (!isTauri()) {
      return;
    }
    void (async () => {
      try {
        await getCurrentWindow().setDecorations(false);
      } catch {
        /* best-effort */
      }
    })();
  }, []);

  useLayoutEffect(() => {
    const root = document.documentElement;
    if (!isTauri()) {
      root.classList.remove('tauri-main-chrome');
      return () => {
        root.classList.remove('tauri-main-chrome');
      };
    }
    root.classList.add('tauri-main-chrome');
    return () => {
      root.classList.remove('tauri-main-chrome');
    };
  }, []);

  useLayoutEffect(() => {
    if (!isTauri()) {
      document.documentElement.style.removeProperty('--shell-overlay-radius');
      return () => {
        document.documentElement.style.removeProperty('--shell-overlay-radius');
      };
    }
    const rounded = !maximized && tiling !== 'left' && tiling !== 'right';
    document.documentElement.style.setProperty(
      '--shell-overlay-radius',
      rounded ? 'var(--window-radius)' : '0px',
    );
    return () => {
      document.documentElement.style.removeProperty('--shell-overlay-radius');
    };
  }, [maximized, tiling]);
}

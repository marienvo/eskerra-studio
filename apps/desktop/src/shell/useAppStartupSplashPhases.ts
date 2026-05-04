import {invoke, isTauri} from '@tauri-apps/api/core';
import {getCurrentWindow, PhysicalSize} from '@tauri-apps/api/window';
import {
  restoreState,
  StateFlags,
} from '@tauri-apps/plugin-window-state';
import {
  useEffect,
  type Dispatch,
  type SetStateAction,
} from 'react';

import type {DesktopStartupSplashPhase} from '../components/DesktopStartupSplash';

export type StartupSplashPhase = DesktopStartupSplashPhase | 'done';

const MAIN_WINDOW_LABEL = 'main';

/**
 * Wayland often fails `set_position` inside window-state; plugin aborts before `set_size` if POSITION runs first.
 * Omit DECORATIONS so persisted window-state does not override decoration mode (always frameless).
 */
const WINDOW_RESTORE_FLAGS_NO_POSITION =
  StateFlags.ALL & ~StateFlags.POSITION & ~StateFlags.DECORATIONS;

function logDevWindowRestoreError(message: string, e: unknown): void {
  if (import.meta.env.DEV) {
    console.error(message, e);
  }
}

async function peekMainWindowSizeFromStateFile(): Promise<{
  diskMainW?: number;
  diskMainH?: number;
}> {
  try {
    const v = await invoke<{
      pathExists: boolean;
      mainWidth?: number;
      mainHeight?: number;
    }>('eskerra_peek_window_state_file');
    if (!v.pathExists) {
      return {};
    }
    return {diskMainW: v.mainWidth, diskMainH: v.mainHeight};
  } catch {
    return {};
  }
}

async function applyPersistedFileSizeIfDiffers(
  win: ReturnType<typeof getCurrentWindow>,
  diskMainW: number,
  diskMainH: number,
  sizeAfterRestore: {width: number; height: number} | null,
): Promise<void> {
  if (sizeAfterRestore == null) {
    return;
  }
  if (
    diskMainW <= 0
    || diskMainH <= 0
    || (sizeAfterRestore.width === diskMainW
      && sizeAfterRestore.height === diskMainH)
  ) {
    return;
  }
  try {
    await win.setSize(new PhysicalSize(diskMainW, diskMainH));
  } catch (e) {
    logDevWindowRestoreError(
      '[eskerra] window restore: setSize from persisted file failed',
      e,
    );
  }
}

async function runMainWindowRestoreAfterScrim(
  cancelledRef: {current: boolean},
  setStartupSplashPhase: Dispatch<SetStateAction<StartupSplashPhase>>,
): Promise<void> {
  const win = getCurrentWindow();
  const {diskMainW, diskMainH} = await peekMainWindowSizeFromStateFile();

  try {
    await restoreState(MAIN_WINDOW_LABEL, WINDOW_RESTORE_FLAGS_NO_POSITION);
  } catch (e) {
    logDevWindowRestoreError(
      '[eskerra] window-state restore (size, maximized, visible, …) failed',
      e,
    );
  }

  try {
    await restoreState(MAIN_WINDOW_LABEL, StateFlags.POSITION);
  } catch (e) {
    logDevWindowRestoreError(
      '[eskerra] window-state restore (position) failed; size already applied',
      e,
    );
  }

  let sizeAfterRestore: {width: number; height: number} | null = null;
  try {
    const s = await win.innerSize();
    sizeAfterRestore = {width: s.width, height: s.height};
  } catch {
    sizeAfterRestore = null;
  }

  const dw = diskMainW;
  const dh = diskMainH;
  if (dw != null && dh != null) {
    await applyPersistedFileSizeIfDiffers(win, dw, dh, sizeAfterRestore);
  }

  if (!cancelledRef.current) {
    setStartupSplashPhase('done');
  }
}

export type UseAppStartupSplashPhasesArgs = {
  appStartupReady: boolean;
  startupSplashPhase: StartupSplashPhase;
  setStartupSplashPhase: Dispatch<SetStateAction<StartupSplashPhase>>;
};

export function useAppStartupSplashPhases({
  appStartupReady,
  startupSplashPhase,
  setStartupSplashPhase,
}: UseAppStartupSplashPhasesArgs) {
  useEffect(() => {
    if (!isTauri()) {
      document.getElementById('splash-html')?.remove();
    }
  }, []);

  useEffect(() => {
    if (!isTauri() || startupSplashPhase !== 'artwork' || !appStartupReady) {
      return;
    }
    document.getElementById('splash-html')?.remove();
    queueMicrotask(() => {
      setStartupSplashPhase('scrim');
    });
  }, [appStartupReady, startupSplashPhase, setStartupSplashPhase]);

  useEffect(() => {
    if (!isTauri() || startupSplashPhase !== 'scrim' || !appStartupReady) {
      return;
    }
    const cancelledRef = {current: false};
    let raf1 = 0;
    let raf2 = 0;
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        if (cancelledRef.current) {
          return;
        }
        void runMainWindowRestoreAfterScrim(
          cancelledRef,
          setStartupSplashPhase,
        );
      });
    });
    return () => {
      cancelledRef.current = true;
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [appStartupReady, startupSplashPhase, setStartupSplashPhase]);
}

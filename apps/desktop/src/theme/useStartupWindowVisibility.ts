import {isTauri} from '@tauri-apps/api/core';
import {getCurrentWindow} from '@tauri-apps/api/window';
import {useLayoutEffect, useRef} from 'react';

import {releaseStartupThemeLock} from './startupThemeBootstrap';

/**
 * After first layout, clears the startup theme DOM lock and shows the Tauri main window.
 * Keeps this out of `App.tsx` for module-budget reasons.
 */
export function useStartupWindowVisibility(): void {
  const startupWindowShownRef = useRef(false);

  useLayoutEffect(() => {
    if (startupWindowShownRef.current) {
      return;
    }
    startupWindowShownRef.current = true;
    releaseStartupThemeLock();
    if (!isTauri()) {
      return;
    }
    getCurrentWindow().show().catch(() => undefined);
  }, []);
}

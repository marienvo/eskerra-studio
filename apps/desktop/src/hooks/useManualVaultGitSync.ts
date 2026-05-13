import {appLocalDataDir, join} from '@tauri-apps/api/path';
import {useCallback, useRef, useState} from 'react';

import {
  formatVaultGitSyncError,
} from '../lib/gitSyncManualView';
import {
  runVaultGitSync,
  type SyncConfig,
  type SyncRunResult,
} from '../lib/tauriVaultGitSync';
import type {SessionNotificationTone} from '../lib/sessionNotifications';

type UseManualVaultGitSyncArgs = {
  vaultPath: string | null;
  config: SyncConfig | null;
  notify: (tone: SessionNotificationTone, text: string) => void;
  onStart?: () => void;
  onSuccess?: (result: SyncRunResult) => void;
  onSettled: () => void;
};

export function useManualVaultGitSync({
  vaultPath,
  config,
  notify,
  onStart,
  onSuccess,
  onSettled,
}: UseManualVaultGitSyncArgs) {
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);

  const run = useCallback(async (opts?: {readonly silent?: boolean}): Promise<boolean> => {
    if (vaultPath == null || config == null || runningRef.current) {
      return false;
    }

    runningRef.current = true;
    setRunning(true);
    onStart?.();
    try {
      const locksDir = await join(await appLocalDataDir(), 'locks');
      const result = await runVaultGitSync({vaultPath, locksDir, config});
      if (!opts?.silent) {
        onSuccess?.(result);
      }
      return true;
    } catch (error) {
      notify('error', formatVaultGitSyncError(error));
      return false;
    } finally {
      onSettled();
      runningRef.current = false;
      setRunning(false);
    }
  }, [config, notify, onSettled, onStart, onSuccess, vaultPath]);

  return {running, run};
}

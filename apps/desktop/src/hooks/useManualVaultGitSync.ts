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
  const runningPromiseRef = useRef<Promise<boolean> | null>(null);

  const run = useCallback((opts?: {readonly silent?: boolean}): Promise<boolean> => {
    if (vaultPath == null || config == null || runningRef.current) {
      return Promise.resolve(false);
    }

    runningRef.current = true;
    setRunning(true);
    onStart?.();
    const runPromise = (async () => {
      try {
        const locksDir = await join(await appLocalDataDir(), 'locks');
        const result = await runVaultGitSync({vaultPath, locksDir, config});
        if (!opts?.silent) {
          onSuccess?.(result);
        }
        return true;
      } catch (error) {
        if (opts?.silent !== true) {
          notify('error', formatVaultGitSyncError(error));
        }
        return false;
      } finally {
        onSettled();
        runningRef.current = false;
        runningPromiseRef.current = null;
        setRunning(false);
      }
    })();
    runningPromiseRef.current = runPromise;
    return runPromise;
  }, [config, notify, onSettled, onStart, onSuccess, vaultPath]);

  const waitForCurrentRun = useCallback((): Promise<boolean> | null => {
    return runningPromiseRef.current;
  }, []);

  return {running, run, waitForCurrentRun};
}

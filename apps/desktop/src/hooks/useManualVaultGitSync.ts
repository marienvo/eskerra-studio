import {appLocalDataDir, join} from '@tauri-apps/api/path';
import {useCallback, useRef, useState} from 'react';

import {
  formatVaultGitSyncError,
  formatVaultGitSyncSuccess,
} from '../lib/gitSyncManualView';
import {
  runVaultGitSync,
  type SyncConfig,
} from '../lib/tauriVaultGitSync';
import type {SessionNotificationTone} from '../lib/sessionNotifications';

type UseManualVaultGitSyncArgs = {
  vaultPath: string | null;
  config: SyncConfig;
  notify: (tone: SessionNotificationTone, text: string) => void;
  onSettled: () => void;
};

export function useManualVaultGitSync({
  vaultPath,
  config,
  notify,
  onSettled,
}: UseManualVaultGitSyncArgs) {
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);

  const run = useCallback(async () => {
    if (vaultPath == null || runningRef.current) {
      return;
    }

    runningRef.current = true;
    setRunning(true);
    try {
      const locksDir = await join(await appLocalDataDir(), 'locks');
      const result = await runVaultGitSync({vaultPath, locksDir, config});
      notify('info', formatVaultGitSyncSuccess(result));
    } catch (error) {
      notify('error', formatVaultGitSyncError(error));
    } finally {
      onSettled();
      runningRef.current = false;
      setRunning(false);
    }
  }, [config, notify, onSettled, vaultPath]);

  return {running, run};
}

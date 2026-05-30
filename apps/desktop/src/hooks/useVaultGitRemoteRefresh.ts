import {useCallback, useRef, useState, type MutableRefObject} from 'react';

import type {GitStatusResult, SyncError} from '../lib/tauriVaultGitSync';
import {refreshVaultGitRemoteStatus} from '../lib/tauriVaultGitSync';

type UseVaultGitRemoteRefreshInput = {
  vaultPath: string | null;
  remote: string;
  branch: string | null;
  fetchTimeoutSecs: number;
  manualSyncRunning: boolean;
  onRefreshed?: (result: GitStatusResult) => void;
  /** Called when a started refresh finishes (success or failure), with the vault path for that request. */
  onSettled?: (vaultPath: string) => void;
  gitOperationBusyRef?: MutableRefObject<boolean>;
};

type UseVaultGitRemoteRefreshResult = {
  /** Returns true when a remote status request was started. */
  refresh: () => boolean;
  loading: boolean;
  error: SyncError | null;
};

export function useVaultGitRemoteRefresh({
  vaultPath,
  remote,
  branch,
  fetchTimeoutSecs,
  manualSyncRunning,
  onRefreshed,
  onSettled,
  gitOperationBusyRef,
}: UseVaultGitRemoteRefreshInput): UseVaultGitRemoteRefreshResult {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<SyncError | null>(null);
  const requestIdRef = useRef(0);

  const refresh = useCallback((): boolean => {
    if (manualSyncRunning || vaultPath == null || branch == null || gitOperationBusyRef?.current) {
      return false;
    }

    const requestId = ++requestIdRef.current;
    const requestVaultPath = vaultPath;
    if (gitOperationBusyRef) {
      gitOperationBusyRef.current = true;
    }
    setLoading(true);
    setError(null);

    refreshVaultGitRemoteStatus({vaultPath, remote, branch, fetchTimeoutSecs})
      .then((result) => {
        if (requestId !== requestIdRef.current) return;
        setLoading(false);
        onRefreshed?.(result);
      })
      .catch((err: unknown) => {
        if (requestId !== requestIdRef.current) return;
        setLoading(false);
        setError(err as SyncError);
      })
      .finally(() => {
        if (requestId !== requestIdRef.current) return;
        if (gitOperationBusyRef) {
          gitOperationBusyRef.current = false;
        }
        onSettled?.(requestVaultPath);
      });
    return true;
  }, [vaultPath, remote, branch, fetchTimeoutSecs, manualSyncRunning, onRefreshed, onSettled, gitOperationBusyRef]);

  return {refresh, loading, error};
}

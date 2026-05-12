import {useCallback, useRef, useState} from 'react';

import type {GitStatusResult, SyncError} from '../lib/tauriVaultGitSync';
import {refreshVaultGitRemoteStatus} from '../lib/tauriVaultGitSync';

type UseVaultGitRemoteRefreshInput = {
  vaultPath: string | null;
  remote: string;
  branch: string | null;
  fetchTimeoutSecs: number;
  manualSyncRunning: boolean;
  onRefreshed?: (result: GitStatusResult) => void;
};

type UseVaultGitRemoteRefreshResult = {
  refresh: () => void;
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
}: UseVaultGitRemoteRefreshInput): UseVaultGitRemoteRefreshResult {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<SyncError | null>(null);
  const requestIdRef = useRef(0);
  const onRefreshedRef = useRef(onRefreshed);
  onRefreshedRef.current = onRefreshed;

  const refresh = useCallback(() => {
    if (manualSyncRunning || vaultPath == null || branch == null) {
      return;
    }

    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);

    refreshVaultGitRemoteStatus({vaultPath, remote, branch, fetchTimeoutSecs})
      .then((result) => {
        if (requestId !== requestIdRef.current) return;
        setLoading(false);
        onRefreshedRef.current?.(result);
      })
      .catch((err: unknown) => {
        if (requestId !== requestIdRef.current) return;
        setLoading(false);
        setError(err as SyncError);
      });
  }, [vaultPath, remote, branch, fetchTimeoutSecs, manualSyncRunning]);

  return {refresh, loading, error};
}

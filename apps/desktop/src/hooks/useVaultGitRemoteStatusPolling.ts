import {useEffect, useEffectEvent, type MutableRefObject} from 'react';

import type {GitStatusResult} from '../lib/tauriVaultGitSync';
import {useVaultGitRemoteRefresh} from './useVaultGitRemoteRefresh';

export const REMOTE_POLL_INTERVAL_MS = 5 * 60 * 1000;

type UseVaultGitRemoteStatusPollingInput = {
  vaultPath: string | null;
  remote: string;
  branch: string | null;
  fetchTimeoutSecs: number;
  manualSyncRunning: boolean;
  onRefreshed?: (result: GitStatusResult) => void;
  gitOperationBusyRef?: MutableRefObject<boolean>;
};

/**
 * Polls the remote Git status at a fixed interval so GitStatusChip can show
 * "Remote changes" when another device has pushed commits.
 *
 * Delegates guarding (null vaultPath/branch, manualSyncRunning) to
 * useVaultGitRemoteRefresh. No polling fires on mount — the first fire is after
 * one full interval, or when the window returns to the foreground.
 */
export function useVaultGitRemoteStatusPolling({
  vaultPath,
  remote,
  branch,
  fetchTimeoutSecs,
  manualSyncRunning,
  onRefreshed,
  gitOperationBusyRef,
}: UseVaultGitRemoteStatusPollingInput): {remoteRefreshLoading: boolean} {
  const {refresh, loading: remoteRefreshLoading} = useVaultGitRemoteRefresh({
    vaultPath,
    remote,
    branch,
    fetchTimeoutSecs,
    manualSyncRunning,
    onRefreshed,
    gitOperationBusyRef,
  });

  const triggerRefresh = useEffectEvent(() => refresh());

  useEffect(() => {
    const id = window.setInterval(triggerRefresh, REMOTE_POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (!document.hidden) {
        triggerRefresh();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  return {remoteRefreshLoading};
}

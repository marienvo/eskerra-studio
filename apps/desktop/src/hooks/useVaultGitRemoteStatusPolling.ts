import {useEffect, useEffectEvent, useRef, useState, type MutableRefObject} from 'react';

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

type UseVaultGitRemoteStatusPollingResult = {
  remoteRefreshLoading: boolean;
  /** False until the first remote status fetch for the current vault path has finished (success or failure). */
  initialRemoteStatusSettled: boolean;
};

/**
 * Polls the remote Git status at a fixed interval so GitStatusChip can show
 * "Remote changes" when another device has pushed commits.
 *
 * Also runs one immediate fetch when vault + branch become ready so startup
 * sync can see an up-to-date `behind` count.
 */
export function useVaultGitRemoteStatusPolling({
  vaultPath,
  remote,
  branch,
  fetchTimeoutSecs,
  manualSyncRunning,
  onRefreshed,
  gitOperationBusyRef,
}: UseVaultGitRemoteStatusPollingInput): UseVaultGitRemoteStatusPollingResult {
  const initialRefreshVaultRef = useRef<string | null>(null);
  const initialRefreshCompletedRef = useRef(false);
  const [initialRemoteStatusSettled, setInitialRemoteStatusSettled] = useState(true);

  const markInitialRemoteSettled = useEffectEvent((settledVaultPath: string) => {
    if (
      initialRefreshVaultRef.current === settledVaultPath &&
      !initialRefreshCompletedRef.current
    ) {
      initialRefreshCompletedRef.current = true;
      setInitialRemoteStatusSettled(true);
    }
  });

  const {refresh, loading: remoteRefreshLoading} = useVaultGitRemoteRefresh({
    vaultPath,
    remote,
    branch,
    fetchTimeoutSecs,
    manualSyncRunning,
    onRefreshed,
    onSettled: markInitialRemoteSettled,
    gitOperationBusyRef,
  });

  const triggerRefresh = useEffectEvent(() => refresh());

  useEffect(() => {
    if (vaultPath == null || branch == null) {
      initialRefreshVaultRef.current = null;
      initialRefreshCompletedRef.current = false;
      setInitialRemoteStatusSettled(true);
      return;
    }
    if (initialRefreshVaultRef.current !== vaultPath) {
      initialRefreshVaultRef.current = vaultPath;
      initialRefreshCompletedRef.current = false;
      setInitialRemoteStatusSettled(false);
    }
  }, [vaultPath, branch]);

  useEffect(() => {
    if (vaultPath == null || branch == null) return;
    if (initialRefreshCompletedRef.current) return;
    triggerRefresh();
  }, [vaultPath, branch, manualSyncRunning]);

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

  return {remoteRefreshLoading, initialRemoteStatusSettled};
}

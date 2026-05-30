import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type MutableRefObject,
} from 'react';

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
  const noRemoteTarget = vaultPath == null || branch == null;
  const [trackedVault, setTrackedVault] = useState<string | null>(
    noRemoteTarget ? null : vaultPath,
  );
  const [initialRemoteStatusSettled, setInitialRemoteStatusSettled] =
    useState(noRemoteTarget);

  if (noRemoteTarget) {
    if (trackedVault !== null) {
      setTrackedVault(null);
      setInitialRemoteStatusSettled(true);
    }
  } else if (trackedVault !== vaultPath) {
    setTrackedVault(vaultPath);
    setInitialRemoteStatusSettled(false);
  }

  const trackedVaultRef = useRef(trackedVault);
  useEffect(() => {
    trackedVaultRef.current = trackedVault;
  }, [trackedVault]);

  const markInitialRemoteSettled = useCallback((settledVaultPath: string) => {
    if (trackedVaultRef.current === settledVaultPath) {
      setInitialRemoteStatusSettled(true);
    }
  }, []);

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
    if (vaultPath == null || branch == null) return;
    if (initialRemoteStatusSettled) return;
    triggerRefresh();
  }, [vaultPath, branch, manualSyncRunning, initialRemoteStatusSettled]);

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

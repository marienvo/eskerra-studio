import {useEffect, useRef} from 'react';

import type {GitStatusResult} from '../lib/tauriVaultGitSync';
import {useVaultGitRemoteRefresh} from './useVaultGitRemoteRefresh';

// TODO: make configurable via vault settings UI
export const REMOTE_POLL_INTERVAL_MS = 5 * 60 * 1000;

type UseVaultGitRemoteStatusPollingInput = {
  vaultPath: string | null;
  remote: string;
  branch: string | null;
  fetchTimeoutSecs: number;
  manualSyncRunning: boolean;
  onRefreshed?: (result: GitStatusResult) => void;
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
}: UseVaultGitRemoteStatusPollingInput): void {
  const {refresh} = useVaultGitRemoteRefresh({
    vaultPath,
    remote,
    branch,
    fetchTimeoutSecs,
    manualSyncRunning,
    onRefreshed,
  });

  // Keep a stable ref so interval/visibility effects never need to re-register.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    const id = window.setInterval(() => {
      refreshRef.current();
    }, REMOTE_POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (!document.hidden) {
        refreshRef.current();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);
}

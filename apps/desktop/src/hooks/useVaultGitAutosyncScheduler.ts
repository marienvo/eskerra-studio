import {useEffect, useEffectEvent, useRef, type MutableRefObject} from 'react';

import {shouldRunVaultGitSync} from '../lib/gitSyncPreflight';
import type {GitStatusResult} from '../lib/tauriVaultGitSync';

type AutosyncPreflightResult = 'run' | 'skip-keep-pending' | 'skip-clear-pending';

/**
 * Checks whether an autosync should run given the current git status.
 * Returns 'run' to proceed, 'skip-clear-pending' when repo is clean (discard pending),
 * or 'skip-keep-pending' when status is unknown/error (retry next interval).
 * Returns 'run' when gitStatus is undefined (no preflight wired up yet).
 */
function autosyncPreflight(gitStatus: GitStatusResult | null | undefined): AutosyncPreflightResult {
  if (gitStatus === undefined) return 'run';
  if (shouldRunVaultGitSync(gitStatus, 'autosync')) return 'run';
  // Preflight says skip. Decide whether to clear or keep pending.
  const isCleanSynced =
    gitStatus != null &&
    gitStatus.unsafeState == null &&
    !gitStatus.isWrongBranch &&
    !gitStatus.hasUncommittedChanges &&
    !gitStatus.hasStagedChanges &&
    !gitStatus.hasUntrackedFiles &&
    gitStatus.ahead === 0 &&
    gitStatus.behind === 0;
  return isCleanSynced ? 'skip-clear-pending' : 'skip-keep-pending';
}

export const AUTOSYNC_INTERVAL_MS = 5 * 60 * 1000;

type UseVaultGitAutosyncSchedulerArgs = {
  saveSettledNonce: number;
  vaultPath: string | null;
  gitStatusLoading: boolean;
  gitStatusError: string | null;
  gitStatus?: GitStatusResult | null;
  manualSyncDisabledReason: string | null;
  manualSyncRunning: boolean;
  runManualSync: (opts?: {readonly silent?: boolean}) => Promise<boolean>;
  intervalMs?: number;
  gitOperationBusyRef?: MutableRefObject<boolean>;
};

/**
 * Coalesces local vault writes into a single pending autosync flag.
 * The interval is the only automatic trigger; saves never run Git sync directly.
 */
export function useVaultGitAutosyncScheduler({
  saveSettledNonce,
  vaultPath,
  gitStatusLoading,
  gitStatusError,
  gitStatus,
  manualSyncDisabledReason,
  manualSyncRunning,
  runManualSync,
  intervalMs = AUTOSYNC_INTERVAL_MS,
  gitOperationBusyRef,
}: UseVaultGitAutosyncSchedulerArgs): void {
  const pendingGenerationRef = useRef(0);
  const syncedGenerationRef = useRef(0);
  const inFlightRef = useRef(false);

  useEffect(() => {
    pendingGenerationRef.current = 0;
    syncedGenerationRef.current = 0;
  }, [vaultPath]);

  useEffect(() => {
    if (saveSettledNonce === 0) return;
    pendingGenerationRef.current += 1;
  }, [saveSettledNonce]);

  const runPendingSync = useEffectEvent(async () => {
    const pendingGeneration = pendingGenerationRef.current;
    if (pendingGeneration === syncedGenerationRef.current) return;
    if (inFlightRef.current) return;
    if (vaultPath == null) return;
    if (gitStatusLoading) return;
    if (gitStatusError != null) return;
    if (manualSyncDisabledReason != null) return;
    if (manualSyncRunning) return;
    if (gitOperationBusyRef?.current) return;

    const preflight = autosyncPreflight(gitStatus);
    if (preflight === 'skip-clear-pending') {
      syncedGenerationRef.current = pendingGenerationRef.current;
      return;
    }
    if (preflight === 'skip-keep-pending') {
      return;
    }

    inFlightRef.current = true;
    if (gitOperationBusyRef) {
      gitOperationBusyRef.current = true;
    }
    try {
      const success = await runManualSync({silent: true});
      if (success && pendingGenerationRef.current === pendingGeneration) {
        syncedGenerationRef.current = pendingGeneration;
      }
    } finally {
      if (gitOperationBusyRef) {
        gitOperationBusyRef.current = false;
      }
      inFlightRef.current = false;
    }
  });

  useEffect(() => {
    if (intervalMs <= 0) return;
    const id = window.setInterval(runPendingSync, intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
}

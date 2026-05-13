import {useEffect, useEffectEvent, useRef, type MutableRefObject} from 'react';

export const AUTOSYNC_INTERVAL_MS = 5 * 60 * 1000;

type UseVaultGitAutosyncSchedulerArgs = {
  saveSettledNonce: number;
  vaultPath: string | null;
  gitStatusLoading: boolean;
  gitStatusError: string | null;
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

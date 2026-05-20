import {useEffect, useEffectEvent, useRef, useState, type MutableRefObject} from 'react';

import {getAutosyncPreflight} from '../lib/gitAutosyncCountdown';
import type {GitStatusResult} from '../lib/tauriVaultGitSync';

export const AUTOSYNC_INTERVAL_MS = 5 * 60 * 1000;

export type VaultGitAutosyncSchedulerState = {
  autosyncPending: boolean;
  nextAutosyncAtMs: number;
};

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
}: UseVaultGitAutosyncSchedulerArgs): VaultGitAutosyncSchedulerState {
  const pendingGenerationRef = useRef(0);
  const syncedGenerationRef = useRef(0);
  const inFlightRef = useRef(false);
  const nextAutosyncAtMsRef = useRef(0);
  const [schedulerState, setSchedulerState] = useState<VaultGitAutosyncSchedulerState>({
    autosyncPending: false,
    nextAutosyncAtMs: 0,
  });

  const publishSchedulerState = useEffectEvent(() => {
    setSchedulerState({
      autosyncPending: pendingGenerationRef.current !== syncedGenerationRef.current,
      nextAutosyncAtMs: nextAutosyncAtMsRef.current,
    });
  });

  const scheduleNextAutosyncAt = useEffectEvent((atMs: number) => {
    nextAutosyncAtMsRef.current = atMs;
    publishSchedulerState();
  });

  useEffect(() => {
    pendingGenerationRef.current = 0;
    syncedGenerationRef.current = 0;
    nextAutosyncAtMsRef.current = Date.now() + intervalMs;
    setSchedulerState({
      autosyncPending: false,
      nextAutosyncAtMs: nextAutosyncAtMsRef.current,
    });
  }, [vaultPath, intervalMs]);

  useEffect(() => {
    if (saveSettledNonce === 0) return;
    pendingGenerationRef.current += 1;
    publishSchedulerState();
  }, [saveSettledNonce]);

  const runPendingSync = useEffectEvent(async () => {
    scheduleNextAutosyncAt(Date.now() + intervalMs);

    const pendingGeneration = pendingGenerationRef.current;
    if (pendingGeneration === syncedGenerationRef.current) return;
    if (inFlightRef.current) return;
    if (vaultPath == null) return;
    if (gitStatusLoading) return;
    if (gitStatusError != null) return;
    if (manualSyncDisabledReason != null) return;
    if (manualSyncRunning) return;
    if (gitOperationBusyRef?.current) return;

    const preflight = getAutosyncPreflight(gitStatus);
    if (preflight === 'skip-clear-pending') {
      syncedGenerationRef.current = pendingGenerationRef.current;
      publishSchedulerState();
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
        publishSchedulerState();
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
    scheduleNextAutosyncAt(Date.now() + intervalMs);
    const id = window.setInterval(() => {
      void runPendingSync();
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);

  return schedulerState;
}

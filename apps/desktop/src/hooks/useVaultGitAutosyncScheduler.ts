import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type MutableRefObject,
} from 'react';

import {getAutosyncPreflight} from '../lib/gitAutosyncCountdown';
import type {GitStatusResult} from '../lib/tauriVaultGitSync';

export const AUTOSYNC_INTERVAL_MS = 5 * 60 * 1000;
export const AUTOSYNC_RETRY_DELAY_MS = 30 * 1000;
export const AUTOSYNC_MIN_CHANGE_AGE_MS = 60 * 1000;

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
  /** Revision of the current git status snapshot; must advance after a pending save to clear on clean status. */
  gitStatusRevision?: number;
  manualSyncDisabledReason: string | null;
  manualSyncRunning: boolean;
  runManualSync: (opts?: {readonly silent?: boolean}) => Promise<boolean>;
  intervalMs?: number;
  retryDelayMs?: number;
  minChangeAgeMs?: number;
  gitOperationBusyRef?: MutableRefObject<boolean>;
};

/**
 * Coalesces local vault writes into a single pending autosync flag.
 * Autosync only runs after the interval and after the newest pending write is old enough.
 * Saves never run Git sync directly.
 */
export function useVaultGitAutosyncScheduler({
  saveSettledNonce,
  vaultPath,
  gitStatusLoading,
  gitStatusError,
  gitStatus,
  gitStatusRevision = 0,
  manualSyncDisabledReason,
  manualSyncRunning,
  runManualSync,
  intervalMs = AUTOSYNC_INTERVAL_MS,
  retryDelayMs = AUTOSYNC_RETRY_DELAY_MS,
  minChangeAgeMs = AUTOSYNC_MIN_CHANGE_AGE_MS,
  gitOperationBusyRef,
}: UseVaultGitAutosyncSchedulerArgs): VaultGitAutosyncSchedulerState {
  const pendingGenerationRef = useRef(0);
  const syncedGenerationRef = useRef(0);
  const pendingStatusRevisionRef = useRef(0);
  const latestPendingChangeAtMsRef = useRef(0);
  const gitStatusRevisionRef = useRef(gitStatusRevision);
  useLayoutEffect(() => {
    gitStatusRevisionRef.current = gitStatusRevision;
  }, [gitStatusRevision]);
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

  const scheduleRegularAutosync = useEffectEvent(() => {
    scheduleNextAutosyncAt(Date.now() + intervalMs);
  });

  const scheduleAutosyncRetry = useEffectEvent(() => {
    scheduleNextAutosyncAt(Date.now() + Math.max(0, retryDelayMs));
  });

  const scheduleAutosyncWhenLatestChangeIsOldEnough = useEffectEvent(() => {
    const earliestRunAtMs =
      latestPendingChangeAtMsRef.current + Math.max(0, minChangeAgeMs);
    if (nextAutosyncAtMsRef.current < earliestRunAtMs) {
      scheduleNextAutosyncAt(earliestRunAtMs);
    }
  });

  useEffect(() => {
    pendingGenerationRef.current = 0;
    syncedGenerationRef.current = 0;
    pendingStatusRevisionRef.current = 0;
    latestPendingChangeAtMsRef.current = 0;
    nextAutosyncAtMsRef.current = Date.now() + intervalMs;
    setSchedulerState({
      autosyncPending: false,
      nextAutosyncAtMs: nextAutosyncAtMsRef.current,
    });
  }, [vaultPath, intervalMs]);

  useEffect(() => {
    if (saveSettledNonce === 0) return;
    pendingGenerationRef.current += 1;
    pendingStatusRevisionRef.current = gitStatusRevisionRef.current;
    latestPendingChangeAtMsRef.current = Date.now();
    publishSchedulerState();
    scheduleAutosyncWhenLatestChangeIsOldEnough();
  }, [saveSettledNonce]);

  const clearPendingIfCleanStatusIsFresh = useEffectEvent(() => {
    if (gitStatusRevision <= pendingStatusRevisionRef.current) {
      return;
    }
    syncedGenerationRef.current = pendingGenerationRef.current;
    publishSchedulerState();
  });

  const runPendingSync = useEffectEvent(async () => {
    const pendingGeneration = pendingGenerationRef.current;
    if (pendingGeneration === syncedGenerationRef.current) {
      scheduleRegularAutosync();
      return;
    }
    if (inFlightRef.current) {
      scheduleAutosyncRetry();
      return;
    }
    if (vaultPath == null) {
      scheduleRegularAutosync();
      return;
    }
    if (gitStatusLoading) {
      scheduleAutosyncRetry();
      return;
    }
    if (gitStatusError != null) {
      scheduleAutosyncRetry();
      return;
    }
    if (manualSyncDisabledReason != null) {
      scheduleAutosyncRetry();
      return;
    }
    if (manualSyncRunning) {
      scheduleAutosyncRetry();
      return;
    }
    if (gitOperationBusyRef?.current) {
      scheduleAutosyncRetry();
      return;
    }

    const earliestRunAtMs =
      latestPendingChangeAtMsRef.current + Math.max(0, minChangeAgeMs);
    if (Date.now() < earliestRunAtMs) {
      scheduleNextAutosyncAt(earliestRunAtMs);
      return;
    }

    const preflight = getAutosyncPreflight(gitStatus);
    if (preflight === 'skip-clear-pending') {
      clearPendingIfCleanStatusIsFresh();
      scheduleRegularAutosync();
      return;
    }
    if (preflight === 'skip-keep-pending') {
      scheduleAutosyncRetry();
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
      scheduleRegularAutosync();
    }
  });

  useEffect(() => {
    if (intervalMs <= 0 || schedulerState.nextAutosyncAtMs <= 0) return;
    const id = window.setTimeout(() => {
      runPendingSync().catch(() => undefined);
    }, Math.max(0, schedulerState.nextAutosyncAtMs - Date.now()));
    return () => window.clearTimeout(id);
  }, [intervalMs, schedulerState.nextAutosyncAtMs]);

  return schedulerState;
}

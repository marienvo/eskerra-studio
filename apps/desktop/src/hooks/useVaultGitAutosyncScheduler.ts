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
  gitStatusRevision = 0,
  manualSyncDisabledReason,
  manualSyncRunning,
  runManualSync,
  intervalMs = AUTOSYNC_INTERVAL_MS,
  retryDelayMs = AUTOSYNC_RETRY_DELAY_MS,
  gitOperationBusyRef,
}: UseVaultGitAutosyncSchedulerArgs): VaultGitAutosyncSchedulerState {
  const pendingGenerationRef = useRef(0);
  const syncedGenerationRef = useRef(0);
  const pendingStatusRevisionRef = useRef(0);
  const gitStatusRevisionRef = useRef(gitStatusRevision);
  useLayoutEffect(() => {
    gitStatusRevisionRef.current = gitStatusRevision;
  }, [gitStatusRevision]);
  const inFlightRef = useRef(false);
  const nextAutosyncAtMsRef = useRef(0);
  const autosyncTimeoutRef = useRef<number | null>(null);
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
    if (autosyncTimeoutRef.current != null) {
      window.clearTimeout(autosyncTimeoutRef.current);
    }
    nextAutosyncAtMsRef.current = atMs;
    publishSchedulerState();
    autosyncTimeoutRef.current = window.setTimeout(() => {
      autosyncTimeoutRef.current = null;
      void runPendingSync();
    }, Math.max(0, atMs - Date.now()));
  });

  const scheduleRegularAutosync = useEffectEvent(() => {
    scheduleNextAutosyncAt(Date.now() + intervalMs);
  });

  const scheduleAutosyncRetry = useEffectEvent(() => {
    scheduleNextAutosyncAt(Date.now() + Math.max(0, retryDelayMs));
  });

  useEffect(() => {
    pendingGenerationRef.current = 0;
    syncedGenerationRef.current = 0;
    pendingStatusRevisionRef.current = 0;
    nextAutosyncAtMsRef.current = Date.now() + intervalMs;
    setSchedulerState({
      autosyncPending: false,
      nextAutosyncAtMs: nextAutosyncAtMsRef.current,
    });
    autosyncTimeoutRef.current = window.setTimeout(() => {
      autosyncTimeoutRef.current = null;
      void runPendingSync();
    }, intervalMs);
    return () => {
      if (autosyncTimeoutRef.current != null) {
        window.clearTimeout(autosyncTimeoutRef.current);
        autosyncTimeoutRef.current = null;
      }
    };
  }, [vaultPath, intervalMs]);

  useEffect(() => {
    if (saveSettledNonce === 0) return;
    pendingGenerationRef.current += 1;
    pendingStatusRevisionRef.current = gitStatusRevisionRef.current;
    publishSchedulerState();
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

  return schedulerState;
}

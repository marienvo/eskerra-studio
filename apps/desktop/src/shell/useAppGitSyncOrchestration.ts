import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from 'react';

import {useGitSyncTransientStatus} from '../hooks/useGitSyncTransientStatus';
import {useManualVaultGitSync} from '../hooks/useManualVaultGitSync';
import {useVaultGitAutosyncCountdown} from '../hooks/useVaultGitAutosyncCountdown';
import {useVaultGitAutosyncScheduler} from '../hooks/useVaultGitAutosyncScheduler';
import {useVaultGitCurrentBranch} from '../hooks/useVaultGitCurrentBranch';
import {useVaultGitLocalWriteStatusRefresh} from '../hooks/useVaultGitLocalWriteStatusRefresh';
import {useVaultGitRemoteStatusPolling} from '../hooks/useVaultGitRemoteStatusPolling';
import {useVaultGitStartupSync} from '../hooks/useVaultGitStartupSync';
import {useVaultGitStatus} from '../hooks/useVaultGitStatus';
import {buildManualGitSyncConfig, GIT_SYNC_REMOTE} from '../lib/gitSyncConfig';
import {
  formatVaultGitSyncSuccessChip,
  getManualSyncDisabledReason,
} from '../lib/gitSyncManualView';
import {buildCloseSyncRunner, handleManualSyncCloseRequest} from '../lib/manualSyncClose';
import {getVaultGitStatus, type GitStatusResult, type SyncRunResult} from '../lib/tauriVaultGitSync';
import type {SessionNotificationTone} from '../lib/sessionNotifications';
import type {useDesktopPodcastPlayback} from '../hooks/useDesktopPodcastPlayback';
import {useAppOsCloseSync} from './useAppOsCloseSync';

export type UseAppGitSyncOrchestrationArgs = {
  vaultPath: string | null;
  saveSettledNonce: number;
  notify: (tone: SessionNotificationTone, text: string) => void;
  desktopPlaybackRef: MutableRefObject<ReturnType<typeof useDesktopPodcastPlayback>>;
  flushInboxSave: () => void | Promise<void>;
};

export type UseAppGitSyncOrchestrationResult = {
  manualGitSync: {
    running: boolean;
    run: (opts?: {readonly silent?: boolean}) => Promise<boolean>;
    waitForCurrentRun?: () => Promise<boolean> | null;
  };
  manualSyncDisabledReason: string | null;
  manualSyncUnavailable: boolean;
  manualSyncLabel: string;
  gitStatusForDisplay: GitStatusResult | null;
  transientGitStatus: ReturnType<typeof useGitSyncTransientStatus>['transient'];
  currentGitBranchLoading: boolean;
  gitStatusLoading: boolean;
  currentGitDetachedHead: boolean;
  currentGitBranchError: string | null;
  gitStatusError: string | null;
  /** Live "Syncs in M:SS" when autosync is pending and chip would show Local changes; otherwise null. */
  gitAutosyncCountdownLabel: string | null;
  handleWindowCloseRequest: (input: {instant: boolean}) => void;
  /** True while an OS-close-triggered sync is in flight. Used for the close progress overlay. */
  closeSyncInProgress: boolean;
};

/**
 * Orchestrates all vault git-sync hooks for the main app window.
 * Accepts notify/playback/flush via args so it can be called after
 * useAppNotificationSession without breaking React hook call order.
 */
export function useAppGitSyncOrchestration({
  vaultPath,
  saveSettledNonce,
  notify,
  desktopPlaybackRef,
  flushInboxSave,
}: UseAppGitSyncOrchestrationArgs): UseAppGitSyncOrchestrationResult {
  const {
    branch: currentGitBranch,
    detachedHead: currentGitDetachedHead,
    loading: currentGitBranchLoading,
    error: currentGitBranchError,
    isNotGitRepository: vaultIsNotGitRepository,
  } = useVaultGitCurrentBranch({vaultPath});
  const {
    status: gitStatus,
    loading: gitStatusLoading,
    error: gitStatusError,
    statusRevision: gitStatusRevision,
    refresh: refreshGitStatus,
  } = useVaultGitStatus({vaultPath, remote: GIT_SYNC_REMOTE, branch: currentGitBranch});
  useVaultGitLocalWriteStatusRefresh({
    saveSettledNonce,
    refreshGitStatus,
  });

  const {
    transient: transientGitStatus,
    show: showTransientGitStatus,
    clear: clearTransientGitStatus,
  } = useGitSyncTransientStatus();

  const manualGitSyncConfig = useMemo(
    () => (currentGitBranch == null ? null : buildManualGitSyncConfig(currentGitBranch)),
    [currentGitBranch],
  );
  const gitStatusForDisplay = useMemo<GitStatusResult | null>(() => {
    if (currentGitDetachedHead) {
      return {
        branch: null,
        expectedBranch: '',
        hasUncommittedChanges: false,
        hasStagedChanges: false,
        hasUntrackedFiles: false,
        ahead: 0,
        behind: 0,
        remoteRefAvailable: false,
        unsafeState: 'detachedHead',
        isWrongBranch: false,
      };
    }
    return gitStatus;
  }, [currentGitDetachedHead, gitStatus]);

  const showManualGitSyncSuccess = useCallback(
    (result: SyncRunResult) => {
      showTransientGitStatus(formatVaultGitSyncSuccessChip(result));
    },
    [showTransientGitStatus],
  );
  const manualGitSync = useManualVaultGitSync({
    vaultPath,
    config: manualGitSyncConfig,
    notify,
    onStart: clearTransientGitStatus,
    onSuccess: showManualGitSyncSuccess,
    onSettled: refreshGitStatus,
  });
  const runManualGitSync = manualGitSync.run;
  const flushBeforeManualSyncBusyRef = useRef(false);
  const flushBeforeManualSyncPromiseRef = useRef<Promise<boolean> | null>(null);
  const [flushBeforeManualSyncRunning, setFlushBeforeManualSyncRunning] = useState(false);
  const manualSyncRunning =
    manualGitSync.running || flushBeforeManualSyncRunning;
  const refreshGitStatusSilently = useCallback(() => {
    refreshGitStatus({silent: true});
  }, [refreshGitStatus]);
  const backgroundGitOperationBusyRef = useRef(false);
  const {remoteRefreshLoading} = useVaultGitRemoteStatusPolling({
    vaultPath,
    remote: GIT_SYNC_REMOTE,
    branch: currentGitBranch,
    fetchTimeoutSecs: 30,
    manualSyncRunning,
    onRefreshed: refreshGitStatusSilently,
    gitOperationBusyRef: backgroundGitOperationBusyRef,
  });

  const manualSyncDisabledReason = getManualSyncDisabledReason({
    vaultPath,
    gitStatus: gitStatusForDisplay,
    gitStatusLoading: currentGitBranchLoading || gitStatusLoading,
    gitStatusError,
    branchLoading: currentGitBranchLoading,
    branchUnavailable: !currentGitDetachedHead && (currentGitBranch == null || currentGitBranchError != null),
    running: manualSyncRunning,
  });
  const manualSyncUnavailable = vaultPath == null || manualSyncDisabledReason != null;
  const manualSyncLabel = manualSyncDisabledReason ?? 'Sync vault';
  const vaultGitSyncApplies = vaultPath != null && !vaultIsNotGitRepository;
  const runManualSyncForClose = useMemo(
    () => buildCloseSyncRunner(runManualGitSync),
    [runManualGitSync],
  );
  const flushThenRunManualSync = useCallback(
    async (opts?: {readonly silent?: boolean}) => {
      if (flushBeforeManualSyncBusyRef.current || manualGitSync.running) {
        return false;
      }

      flushBeforeManualSyncBusyRef.current = true;
      setFlushBeforeManualSyncRunning(true);
      const runPromise = (async () => {
        try {
          await flushInboxSave();
        } catch {
          // Keep Git sync available even if an autosave flush reports a stale error.
        }
        return runManualGitSync(opts);
      })();
      flushBeforeManualSyncPromiseRef.current = runPromise;
      try {
        return await runPromise;
      } finally {
        flushBeforeManualSyncBusyRef.current = false;
        flushBeforeManualSyncPromiseRef.current = null;
        setFlushBeforeManualSyncRunning(false);
      }
    },
    [flushInboxSave, manualGitSync.running, runManualGitSync],
  );
  const waitForFlushThenManualSync = useCallback((): Promise<boolean> | null => {
    return (
      flushBeforeManualSyncPromiseRef.current ??
      manualGitSync.waitForCurrentRun?.() ??
      null
    );
  }, [manualGitSync.waitForCurrentRun]);
  const fetchFreshGitStatusForClose = useCallback(async (): Promise<GitStatusResult | null> => {
    if (vaultPath == null || currentGitBranch == null) {
      return gitStatusForDisplay;
    }
    try {
      return await getVaultGitStatus({vaultPath, remote: GIT_SYNC_REMOTE, branch: currentGitBranch});
    } catch {
      return gitStatusForDisplay;
    }
  }, [currentGitBranch, gitStatusForDisplay, vaultPath]);
  const {programmaticClose, closeSyncInProgress, markCloseSyncActive} = useAppOsCloseSync({
    desktopPlaybackRef,
    flushInboxSave,
    manualSyncRequired: vaultGitSyncApplies,
    manualSyncDisabledReason,
    manualSyncRunning,
    runManualSync: runManualSyncForClose,
    notify,
    gitStatus: gitStatusForDisplay,
    fetchFreshGitStatusForClose,
    waitForCurrentRun: waitForFlushThenManualSync,
  });
  const closeSyncDisabledNoticeRef = useRef<string | null>(null);
  useEffect(() => {
    if (manualSyncDisabledReason == null) {
      closeSyncDisabledNoticeRef.current = null;
    }
  }, [manualSyncDisabledReason]);
  const handleWindowCloseRequest = useCallback(
    (input: {instant: boolean}) => {
      void (async () => {
        const notifyDisabled =
          manualSyncDisabledReason != null &&
          closeSyncDisabledNoticeRef.current !== manualSyncDisabledReason;
        if (notifyDisabled) {
          closeSyncDisabledNoticeRef.current = manualSyncDisabledReason;
        }

        if (input.instant) {
          await handleManualSyncCloseRequest({
            instant: true,
            manualSyncRequired: vaultGitSyncApplies,
            manualSyncDisabledReason,
            manualSyncRunning,
            runManualSync: runManualSyncForClose,
            close: programmaticClose,
            notify,
            notifyDisabled,
            showCloseSyncFeedback: true,
            gitStatus: gitStatusForDisplay,
          });
          return;
        }

        await markCloseSyncActive(async () => {
          try { await flushInboxSave(); } catch { /* ignore flush errors on close */ }
          const gitStatusForClose = await fetchFreshGitStatusForClose();
          await handleManualSyncCloseRequest({
            instant: false,
            manualSyncRequired: vaultGitSyncApplies,
            manualSyncDisabledReason,
            manualSyncRunning,
            runManualSync: runManualSyncForClose,
            close: programmaticClose,
            notify,
            notifyDisabled,
            showCloseSyncFeedback: true,
            gitStatus: gitStatusForClose,
            waitForCurrentRun: waitForFlushThenManualSync,
          });
        });
      })();
    },
    [
      fetchFreshGitStatusForClose,
      flushInboxSave,
      gitStatusForDisplay,
      manualSyncRunning,
      waitForFlushThenManualSync,
      manualSyncDisabledReason,
      markCloseSyncActive,
      notify,
      programmaticClose,
      runManualSyncForClose,
      vaultGitSyncApplies,
    ],
  );

  useVaultGitStartupSync({
    vaultPath,
    gitStatusLoading: currentGitBranchLoading || gitStatusLoading,
    gitStatusError,
    gitStatus: gitStatusForDisplay,
    manualSyncDisabledReason,
    manualSyncRunning,
    runManualSync: flushThenRunManualSync,
    notify,
  });

  const autosyncSchedulerState = useVaultGitAutosyncScheduler({
    saveSettledNonce,
    vaultPath,
    gitStatusLoading: currentGitBranchLoading || gitStatusLoading,
    gitStatusError,
    gitStatus: gitStatusForDisplay,
    gitStatusRevision,
    manualSyncDisabledReason,
    manualSyncRunning,
    runManualSync: flushThenRunManualSync,
    gitOperationBusyRef: backgroundGitOperationBusyRef,
  });
  const gitAutosyncCountdownLabel = useVaultGitAutosyncCountdown({
    ...autosyncSchedulerState,
    gitStatus: gitStatusForDisplay,
    gitStatusLoading: currentGitBranchLoading || gitStatusLoading,
    gitStatusError,
    manualSyncDisabledReason,
    manualSyncRunning,
    gitOperationBusy: remoteRefreshLoading,
  });

  return {
    manualGitSync: {
      running: manualSyncRunning,
      run: flushThenRunManualSync,
      waitForCurrentRun: waitForFlushThenManualSync,
    },
    manualSyncDisabledReason,
    manualSyncUnavailable,
    manualSyncLabel,
    gitStatusForDisplay,
    transientGitStatus,
    currentGitBranchLoading,
    gitStatusLoading,
    currentGitDetachedHead,
    currentGitBranchError,
    gitStatusError,
    gitAutosyncCountdownLabel,
    handleWindowCloseRequest,
    closeSyncInProgress,
  };
}

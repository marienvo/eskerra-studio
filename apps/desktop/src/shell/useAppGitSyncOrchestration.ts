import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type MutableRefObject,
} from 'react';

import {useGitSyncTransientStatus} from '../hooks/useGitSyncTransientStatus';
import {useManualVaultGitSync} from '../hooks/useManualVaultGitSync';
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
import type {GitStatusResult, SyncRunResult} from '../lib/tauriVaultGitSync';
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
  manualGitSync: {running: boolean; run: () => Promise<boolean>};
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
  } = useVaultGitCurrentBranch({vaultPath});
  const {
    status: gitStatus,
    loading: gitStatusLoading,
    error: gitStatusError,
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
  const backgroundGitOperationBusyRef = useRef(false);
  useVaultGitRemoteStatusPolling({
    vaultPath,
    remote: GIT_SYNC_REMOTE,
    branch: currentGitBranch,
    fetchTimeoutSecs: 30,
    manualSyncRunning: manualGitSync.running,
    onRefreshed: refreshGitStatus,
    gitOperationBusyRef: backgroundGitOperationBusyRef,
  });

  const manualSyncDisabledReason = getManualSyncDisabledReason({
    vaultPath,
    gitStatus: gitStatusForDisplay,
    gitStatusLoading: currentGitBranchLoading || gitStatusLoading,
    gitStatusError,
    branchLoading: currentGitBranchLoading,
    branchUnavailable: !currentGitDetachedHead && (currentGitBranch == null || currentGitBranchError != null),
    running: manualGitSync.running,
  });
  const manualSyncUnavailable = vaultPath == null || manualSyncDisabledReason != null;
  const manualSyncLabel = manualSyncDisabledReason ?? 'Sync vault';
  const runManualSyncForClose = useMemo(
    () => buildCloseSyncRunner(manualGitSync.run),
    [manualGitSync.run],
  );
  const {programmaticClose, closeSyncInProgress} = useAppOsCloseSync({
    desktopPlaybackRef,
    flushInboxSave,
    manualSyncRequired: vaultPath != null,
    manualSyncDisabledReason,
    manualSyncRunning: manualGitSync.running,
    runManualSync: runManualSyncForClose,
    notify,
    gitStatus: gitStatusForDisplay,
  });
  const closeSyncDisabledNoticeRef = useRef<string | null>(null);
  useEffect(() => {
    if (manualSyncDisabledReason == null) {
      closeSyncDisabledNoticeRef.current = null;
    }
  }, [manualSyncDisabledReason]);
  const handleWindowCloseRequest = useCallback(
    (input: {instant: boolean}) => {
      const notifyDisabled =
        manualSyncDisabledReason != null &&
        closeSyncDisabledNoticeRef.current !== manualSyncDisabledReason;
      if (notifyDisabled) {
        closeSyncDisabledNoticeRef.current = manualSyncDisabledReason;
      }
      void handleManualSyncCloseRequest({
        instant: input.instant,
        manualSyncDisabledReason,
        manualSyncRunning: manualGitSync.running,
        runManualSync: runManualSyncForClose,
        close: programmaticClose,
        notify,
        notifyDisabled,
        showCloseSyncFeedback: true,
        gitStatus: gitStatusForDisplay,
      });
    },
    [gitStatusForDisplay, manualGitSync.running, manualSyncDisabledReason, notify, programmaticClose, runManualSyncForClose],
  );

  useVaultGitStartupSync({
    vaultPath,
    gitStatusLoading: currentGitBranchLoading || gitStatusLoading,
    gitStatusError,
    gitStatus: gitStatusForDisplay,
    manualSyncDisabledReason,
    manualSyncRunning: manualGitSync.running,
    runManualSync: manualGitSync.run,
    notify,
  });

  useVaultGitAutosyncScheduler({
    saveSettledNonce,
    vaultPath,
    gitStatusLoading: currentGitBranchLoading || gitStatusLoading,
    gitStatusError,
    gitStatus: gitStatusForDisplay,
    manualSyncDisabledReason,
    manualSyncRunning: manualGitSync.running,
    runManualSync: manualGitSync.run,
    gitOperationBusyRef: backgroundGitOperationBusyRef,
  });

  return {
    manualGitSync,
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
    handleWindowCloseRequest,
    closeSyncInProgress,
  };
}

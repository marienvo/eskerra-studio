import {AppStatusBar} from '../../components/AppStatusBar';
import {GitStatusChip} from '../../components/GitStatusChip';
import type {TransientGitStatus} from '../../hooks/useGitSyncTransientStatus';
import type {GitStatusResult} from '../../lib/tauriVaultGitSync';

export type AppStatusBarSectionProps = {
  onOpenSettings: () => void;
  onManualSync: () => void;
  manualSyncBusy: boolean;
  manualSyncDisabled: boolean;
  manualSyncLabel: string;
  gitStatus: GitStatusResult | null;
  gitStatusLoading: boolean;
  currentGitBranchLoading: boolean;
  currentGitDetachedHead: boolean;
  gitStatusError: string | null;
  currentGitBranchError: string | null;
  transientGitStatus: TransientGitStatus | null;
  gitAutosyncCountdownTime: string | null;
};

export function AppStatusBarSection({
  onOpenSettings,
  onManualSync,
  manualSyncBusy,
  manualSyncDisabled,
  manualSyncLabel,
  gitStatus,
  gitStatusLoading,
  currentGitBranchLoading,
  currentGitDetachedHead,
  gitStatusError,
  currentGitBranchError,
  transientGitStatus,
  gitAutosyncCountdownTime,
}: AppStatusBarSectionProps) {
  return (
    <AppStatusBar
      onOpenSettings={onOpenSettings}
      onManualSync={onManualSync}
      manualSyncBusy={manualSyncBusy}
      manualSyncDisabled={manualSyncDisabled}
      manualSyncLabel={manualSyncLabel}
      statusIndicator={
        <GitStatusChip
          status={gitStatus}
          loading={currentGitBranchLoading || gitStatusLoading}
          error={currentGitDetachedHead ? gitStatusError : currentGitBranchError ?? gitStatusError}
          syncing={manualSyncBusy}
          transient={transientGitStatus}
          autosyncCountdownTime={gitAutosyncCountdownTime}
        />
      }
    />
  );
}

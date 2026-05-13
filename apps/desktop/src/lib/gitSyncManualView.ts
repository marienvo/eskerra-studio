import type {GitStatusResult, SyncError, SyncRunResult} from './tauriVaultGitSync';
import type {TransientGitStatus} from '../hooks/useGitSyncTransientStatus';

type ManualSyncDisabledReasonInput = {
  vaultPath: string | null;
  gitStatus: GitStatusResult | null;
  gitStatusLoading: boolean;
  gitStatusError: string | null;
  branchUnavailable?: boolean;
  branchLoading?: boolean;
  running: boolean;
};

export function getManualSyncDisabledReason({
  vaultPath,
  gitStatus,
  gitStatusLoading,
  gitStatusError,
  branchUnavailable = false,
  branchLoading = false,
  running,
}: ManualSyncDisabledReasonInput): string | null {
  if (running) {
    return 'Syncing vault';
  }
  if (vaultPath == null) {
    return 'Sync vault';
  }
  if (branchLoading) {
    return 'Checking Git branch';
  }
  if (branchUnavailable) {
    return 'Git branch unavailable';
  }
  if (gitStatusLoading) {
    return 'Checking Git status';
  }
  if (gitStatusError != null) {
    return 'Git status unavailable';
  }
  if (gitStatus?.unsafeState != null) {
    return 'Git needs attention';
  }
  if (gitStatus?.isWrongBranch === true) {
    return 'Wrong Git branch';
  }
  return null;
}

export function formatVaultGitSyncSuccess(result: SyncRunResult): string {
  const sha = result.localCommit.commit?.sha;
  if (sha == null || sha.trim() === '') {
    return 'Vault sync complete.';
  }
  return `Vault sync complete. Committed ${sha.slice(0, 7)}.`;
}

export function formatVaultGitSyncSuccessChip(result: SyncRunResult): TransientGitStatus {
  const sha = result.localCommit.commit?.sha;
  if (sha != null && sha.trim() !== '') {
    const shortSha = sha.slice(0, 7);
    return {
      tone: 'success',
      label: `Synced • ${shortSha}`,
      icon: 'check_circle',
      description: `Committed ${shortSha}`,
    };
  }
  return {tone: 'success', label: 'Synced', icon: 'check_circle'};
}

function hasType(value: unknown): value is {type: string} {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    typeof (value as {type?: unknown}).type === 'string'
  );
}

function asSyncError(value: unknown): SyncError | null {
  return hasType(value) ? (value as SyncError) : null;
}

function appendDetail(parts: string[], label: string, value: string | null | undefined): void {
  if (value == null || value.trim() === '') {
    return;
  }
  parts.push(`${label}: ${value}`);
}

export function formatVaultGitSyncError(error: unknown): string {
  const syncError = asSyncError(error);
  if (syncError == null) {
    if (error instanceof Error && error.message.trim() !== '') {
      return error.message;
    }
    return 'Sync failed.';
  }

  switch (syncError.type) {
    case 'mergeFailed': {
      const parts = ['Merge conflict. Manual intervention required.'];
      appendDetail(parts, 'Snapshot branch', syncError.snapshotBranch);
      appendDetail(parts, 'Pre-merge SHA', syncError.preMergeSha);
      return parts.join(' ');
    }
    case 'lockAlreadyHeld':
      return 'Sync already running.';
    case 'pushRejected':
      return 'Push rejected. Local changes remain committed.';
    case 'gitCommandFailed': {
      const command = syncError.command.trim();
      const stderr = syncError.stderr.trim();
      if (command !== '' && stderr !== '') {
        return `Git command failed: ${command}. ${stderr}`;
      }
      if (command !== '') {
        return `Git command failed: ${command}.`;
      }
      return stderr === '' ? 'Git command failed.' : `Git command failed. ${stderr}`;
    }
    case 'remoteBranchMissing':
      return `Remote branch missing: ${syncError.remote}/${syncError.branch}.`;
    case 'wrongBranch':
      return `Wrong Git branch. Expected ${syncError.expected}, found ${syncError.actual}.`;
    case 'invalidConfig':
      return `Invalid sync config. ${syncError.reason}`;
    case 'timeout':
      return `Sync timed out during ${syncError.step} after ${syncError.secs}s.`;
    default:
      return 'Sync failed.';
  }
}

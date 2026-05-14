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
  if (gitStatus?.hasStagedChanges === true) {
    return 'Staged changes need committing';
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

function formatUnknownSyncError(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== '') {
    return error.message;
  }
  return 'Sync failed.';
}

function formatMergeFailedError(error: Extract<SyncError, {type: 'mergeFailed'}>): string {
  const parts = ['Merge conflict. Manual intervention required.'];
  appendDetail(parts, 'Snapshot branch', error.snapshotBranch);
  appendDetail(parts, 'Pre-merge SHA', error.preMergeSha);
  return parts.join(' ');
}

function formatGitCommandFailedError(error: Extract<SyncError, {type: 'gitCommandFailed'}>): string {
  const command = error.command.trim();
  const stderr = error.stderr.trim();
  if (command !== '' && stderr !== '') {
    return `Git command failed: ${command}. ${stderr}`;
  }
  if (command !== '') {
    return `Git command failed: ${command}.`;
  }
  return stderr === '' ? 'Git command failed.' : `Git command failed. ${stderr}`;
}

function formatStderrBackedError(label: string, stderr: string): string {
  const trimmed = stderr.trim();
  return trimmed === '' ? `${label}.` : `${label}. ${trimmed}`;
}

function formatUnsupportedStagePlanError(error: Extract<SyncError, {type: 'unsupportedStagePlan'}>): string {
  const paths = error.paths.join(', ');
  return paths === ''
    ? 'Sync blocked: unsupported change type detected.'
    : `Sync blocked: renamed file detected (${paths}). Commit or revert the rename to continue.`;
}

function formatConflictResolutionFailedError(
  error: Extract<SyncError, {type: 'conflictResolutionFailed'}>,
): string {
  const parts = ['Conflict resolution failed.'];
  if (error.unresolved.length > 0) {
    parts.push(`Unresolved: ${error.unresolved.join(', ')}.`);
  }
  if (error.manual.length > 0) {
    parts.push(`Requires manual resolution: ${error.manual.join(', ')}.`);
  }
  return parts.join(' ');
}

function formatKnownSyncError(error: SyncError): string {
  switch (error.type) {
    case 'mergeFailed':
      return formatMergeFailedError(error);
    case 'lockAlreadyHeld':
      return 'Sync already running.';
    case 'pushRejected':
      return 'Push rejected. Local changes remain committed.';
    case 'gitCommandFailed':
      return formatGitCommandFailedError(error);
    case 'remoteBranchMissing':
      return `Remote branch missing: ${error.remote}/${error.branch}.`;
    case 'wrongBranch':
      return `Wrong Git branch. Expected ${error.expected}, found ${error.actual}.`;
    case 'invalidConfig':
      return `Invalid sync config. ${error.reason}`;
    case 'timeout':
      return `Sync timed out during ${error.step} after ${error.secs}s.`;
    case 'fetchFailed':
      return formatStderrBackedError('Fetch failed', error.stderr);
    case 'authenticationFailed':
      return formatStderrBackedError('Authentication failed', error.stderr);
    case 'unsupportedStagePlan':
      return formatUnsupportedStagePlanError(error);
    case 'conflictResolutionFailed':
      return formatConflictResolutionFailedError(error);
    case 'notGitRepository':
    case 'detachedHead':
    case 'remoteMissing':
    case 'unsafeGitState':
      return 'Sync failed.';
    default:
      return 'Sync failed.';
  }
}

export function formatVaultGitSyncError(error: unknown): string {
  const syncError = asSyncError(error);
  return syncError == null ? formatUnknownSyncError(error) : formatKnownSyncError(syncError);
}

import type {SyncError} from './tauriVaultGitSync';

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
      const parts = ['Merge conflict.'];
      appendDetail(parts, 'Snapshot branch', syncError.snapshotBranch);
      appendDetail(parts, 'Pre-merge SHA', syncError.preMergeSha);
      parts.push('Manual intervention is required.');
      return parts.join(' ');
    }
    case 'lockAlreadyHeld':
      return 'Sync already running.';
    case 'pushRejected':
      return syncError.stderr.trim() === ''
        ? 'Push rejected.'
        : `Push rejected. ${syncError.stderr.trim()}`;
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

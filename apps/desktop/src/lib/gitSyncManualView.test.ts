import {describe, expect, it} from 'vitest';

import {formatVaultGitSyncError} from './gitSyncManualView';

describe('formatVaultGitSyncError', () => {
  it('formats mergeFailed with snapshot branch and pre-merge SHA', () => {
    expect(
      formatVaultGitSyncError({
        type: 'mergeFailed',
        stderr: 'conflict',
        snapshotBranch: 'eskerra/sync-snapshot-20260511',
        preMergeSha: 'abc123',
      }),
    ).toBe(
      'Merge conflict. Snapshot branch: eskerra/sync-snapshot-20260511 Pre-merge SHA: abc123 Manual intervention is required.',
    );
  });

  it('formats mergeFailed without snapshot branch', () => {
    expect(
      formatVaultGitSyncError({
        type: 'mergeFailed',
        stderr: 'conflict',
        snapshotBranch: null,
        preMergeSha: 'abc123',
      }),
    ).toBe('Merge conflict. Pre-merge SHA: abc123 Manual intervention is required.');
  });

  it('formats lockAlreadyHeld', () => {
    expect(formatVaultGitSyncError({type: 'lockAlreadyHeld'})).toBe('Sync already running.');
  });

  it('formats pushRejected', () => {
    expect(formatVaultGitSyncError({type: 'pushRejected', stderr: 'non-fast-forward'})).toBe(
      'Push rejected. non-fast-forward',
    );
  });

  it('formats generic gitCommandFailed', () => {
    expect(
      formatVaultGitSyncError({
        type: 'gitCommandFailed',
        command: 'git fetch origin',
        exitCode: 128,
        stderr: 'remote unavailable',
      }),
    ).toBe('Git command failed: git fetch origin. remote unavailable');
  });
});

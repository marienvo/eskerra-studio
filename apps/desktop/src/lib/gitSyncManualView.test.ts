import {describe, expect, it} from 'vitest';

import {
  formatVaultGitSyncError,
  formatVaultGitSyncSuccess,
  getManualSyncDisabledReason,
} from './gitSyncManualView';
import type {GitStatusResult, SyncRunResult} from './tauriVaultGitSync';

const safeGitStatus: GitStatusResult = {
  branch: 'main',
  expectedBranch: 'main',
  hasUncommittedChanges: false,
  hasStagedChanges: false,
  hasUntrackedFiles: false,
  ahead: 0,
  behind: 0,
  remoteRefAvailable: true,
  unsafeState: null,
  isWrongBranch: false,
};

const syncRunResult: SyncRunResult = {
  localCommit: {
    stageResult: {
      stagedPaths: [],
      excludedPaths: [],
      unsupportedPaths: [],
      mutated: false,
    },
    commit: null,
    mutated: false,
  },
  preMergeSha: null,
  pushed: true,
  snapshotBranch: null,
  finalHeadSha: 'abc123',
};

describe('getManualSyncDisabledReason', () => {
  it('returns loading reason', () => {
    expect(
      getManualSyncDisabledReason({
        vaultPath: '/vault',
        gitStatus: safeGitStatus,
        gitStatusLoading: true,
        gitStatusError: null,
        running: false,
      }),
    ).toBe('Checking Git status');
  });

  it('returns git status error reason', () => {
    expect(
      getManualSyncDisabledReason({
        vaultPath: '/vault',
        gitStatus: safeGitStatus,
        gitStatusLoading: false,
        gitStatusError: 'Git status failed',
        running: false,
      }),
    ).toBe('Git status unavailable');
  });

  it('returns branch loading reason before status checks', () => {
    expect(
      getManualSyncDisabledReason({
        vaultPath: '/vault',
        gitStatus: safeGitStatus,
        gitStatusLoading: false,
        gitStatusError: null,
        branchLoading: true,
        running: false,
      }),
    ).toBe('Checking Git branch');
  });

  it('returns branch unavailable reason before status checks', () => {
    expect(
      getManualSyncDisabledReason({
        vaultPath: '/vault',
        gitStatus: safeGitStatus,
        gitStatusLoading: false,
        gitStatusError: null,
        branchUnavailable: true,
        running: false,
      }),
    ).toBe('Git branch unavailable');
  });

  it('returns unsafe state reason', () => {
    expect(
      getManualSyncDisabledReason({
        vaultPath: '/vault',
        gitStatus: {...safeGitStatus, unsafeState: 'merge'},
        gitStatusLoading: false,
        gitStatusError: null,
        running: false,
      }),
    ).toBe('Git needs attention');
  });

  it('returns unsafe state reason for detached HEAD', () => {
    expect(
      getManualSyncDisabledReason({
        vaultPath: '/vault',
        gitStatus: {...safeGitStatus, branch: null, unsafeState: 'detachedHead'},
        gitStatusLoading: false,
        gitStatusError: null,
        running: false,
      }),
    ).toBe('Git needs attention');
  });

  it('returns wrong branch reason', () => {
    expect(
      getManualSyncDisabledReason({
        vaultPath: '/vault',
        gitStatus: {...safeGitStatus, isWrongBranch: true},
        gitStatusLoading: false,
        gitStatusError: null,
        running: false,
      }),
    ).toBe('Wrong Git branch');
  });

  it('returns running reason', () => {
    expect(
      getManualSyncDisabledReason({
        vaultPath: '/vault',
        gitStatus: safeGitStatus,
        gitStatusLoading: false,
        gitStatusError: null,
        running: true,
      }),
    ).toBe('Syncing vault');
  });

  it('returns null when Git status is clean and safe', () => {
    expect(
      getManualSyncDisabledReason({
        vaultPath: '/vault',
        gitStatus: safeGitStatus,
        gitStatusLoading: false,
        gitStatusError: null,
        running: false,
      }),
    ).toBeNull();
  });
});

describe('formatVaultGitSyncSuccess', () => {
  it('formats success with commit short SHA', () => {
    expect(
      formatVaultGitSyncSuccess({
        ...syncRunResult,
        localCommit: {
          ...syncRunResult.localCommit,
          commit: {sha: 'abcdef1234567890', message: 'chore: sync'},
          mutated: true,
        },
      }),
    ).toBe('Vault sync complete. Committed abcdef1.');
  });

  it('formats success without commit', () => {
    expect(formatVaultGitSyncSuccess(syncRunResult)).toBe('Vault sync complete.');
  });
});

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
      'Merge conflict. Manual intervention required. Snapshot branch: eskerra/sync-snapshot-20260511 Pre-merge SHA: abc123',
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
    ).toBe('Merge conflict. Manual intervention required. Pre-merge SHA: abc123');
  });

  it('formats mergeFailed without snapshot branch or pre-merge SHA', () => {
    expect(
      formatVaultGitSyncError({
        type: 'mergeFailed',
        stderr: 'conflict',
        snapshotBranch: null,
        preMergeSha: null,
      }),
    ).toBe('Merge conflict. Manual intervention required.');
  });

  it('formats lockAlreadyHeld', () => {
    expect(formatVaultGitSyncError({type: 'lockAlreadyHeld'})).toBe('Sync already running.');
  });

  it('formats pushRejected', () => {
    expect(formatVaultGitSyncError({type: 'pushRejected', stderr: 'non-fast-forward'})).toBe(
      'Push rejected. Local changes remain committed.',
    );
  });

  it('formats remoteBranchMissing', () => {
    expect(
      formatVaultGitSyncError({
        type: 'remoteBranchMissing',
        remote: 'origin',
        branch: 'main',
      }),
    ).toBe('Remote branch missing: origin/main.');
  });

  it('formats timeout', () => {
    expect(formatVaultGitSyncError({type: 'timeout', step: 'fetch', secs: 30})).toBe(
      'Sync timed out during fetch after 30s.',
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

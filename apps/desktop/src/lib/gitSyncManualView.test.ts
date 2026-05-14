import {describe, expect, it} from 'vitest';

import {
  formatVaultGitSyncSuccessChip,
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

  it('returns staged changes reason', () => {
    expect(
      getManualSyncDisabledReason({
        vaultPath: '/vault',
        gitStatus: {...safeGitStatus, hasStagedChanges: true},
        gitStatusLoading: false,
        gitStatusError: null,
        running: false,
      }),
    ).toBe('Staged changes need committing');
  });

  it('returns staged changes reason before wrong branch reason', () => {
    expect(
      getManualSyncDisabledReason({
        vaultPath: '/vault',
        gitStatus: {...safeGitStatus, hasStagedChanges: true, isWrongBranch: true},
        gitStatusLoading: false,
        gitStatusError: null,
        running: false,
      }),
    ).toBe('Staged changes need committing');
  });

  it('returns unsafe state reason before staged changes reason', () => {
    expect(
      getManualSyncDisabledReason({
        vaultPath: '/vault',
        gitStatus: {...safeGitStatus, unsafeState: 'merge', hasStagedChanges: true},
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

  it('returns null when no vault path', () => {
    expect(
      getManualSyncDisabledReason({
        vaultPath: null,
        gitStatus: null,
        gitStatusLoading: false,
        gitStatusError: null,
        running: false,
      }),
    ).toBeNull();
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

describe('formatVaultGitSyncSuccessChip', () => {
  it('formats transient success with commit short SHA', () => {
    expect(
      formatVaultGitSyncSuccessChip({
        ...syncRunResult,
        localCommit: {
          ...syncRunResult.localCommit,
          commit: {sha: 'abcdef1234567890', message: 'chore: sync'},
          mutated: true,
        },
      }),
    ).toEqual({
      tone: 'success',
      label: 'Synced • abcdef1',
      icon: 'check_circle',
      description: 'Committed abcdef1',
    });
  });

  it('formats transient success without commit', () => {
    expect(formatVaultGitSyncSuccessChip(syncRunResult)).toEqual({
      tone: 'success',
      label: 'Synced',
      icon: 'check_circle',
    });
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

  it('formats gitCommandFailed with no details', () => {
    expect(
      formatVaultGitSyncError({
        type: 'gitCommandFailed',
        command: '  ',
        exitCode: null,
        stderr: '',
      }),
    ).toBe('Git command failed.');
  });

  it('formats fetchFailed with stderr', () => {
    expect(
      formatVaultGitSyncError({type: 'fetchFailed', stderr: 'Could not read from remote repository'}),
    ).toBe('Fetch failed. Could not read from remote repository');
  });

  it('formats fetchFailed with empty stderr', () => {
    expect(formatVaultGitSyncError({type: 'fetchFailed', stderr: ''})).toBe('Fetch failed.');
  });

  it('formats authenticationFailed with stderr', () => {
    expect(
      formatVaultGitSyncError({
        type: 'authenticationFailed',
        stderr: 'Permission denied (publickey).',
      }),
    ).toBe('Authentication failed. Permission denied (publickey).');
  });

  it('formats authenticationFailed with empty stderr', () => {
    expect(formatVaultGitSyncError({type: 'authenticationFailed', stderr: ''})).toBe(
      'Authentication failed.',
    );
  });

  it('formats unsupportedStagePlan with paths', () => {
    expect(
      formatVaultGitSyncError({type: 'unsupportedStagePlan', paths: ['Inbox/old.md', 'Inbox/new.md']}),
    ).toBe(
      'Sync blocked: renamed file detected (Inbox/old.md, Inbox/new.md). Commit or revert the rename to continue.',
    );
  });

  it('formats unsupportedStagePlan with empty paths', () => {
    expect(formatVaultGitSyncError({type: 'unsupportedStagePlan', paths: []})).toBe(
      'Sync blocked: unsupported change type detected.',
    );
  });

  it('formats conflictResolutionFailed with unresolved and manual paths', () => {
    expect(
      formatVaultGitSyncError({
        type: 'conflictResolutionFailed',
        unresolved: ['Inbox/a.md'],
        manual: ['Inbox/b.md'],
      }),
    ).toBe('Conflict resolution failed. Unresolved: Inbox/a.md. Requires manual resolution: Inbox/b.md.');
  });

  it('formats conflictResolutionFailed with only unresolved paths', () => {
    expect(
      formatVaultGitSyncError({
        type: 'conflictResolutionFailed',
        unresolved: ['Inbox/a.md', 'Inbox/b.md'],
        manual: [],
      }),
    ).toBe('Conflict resolution failed. Unresolved: Inbox/a.md, Inbox/b.md.');
  });

  it('formats conflictResolutionFailed with only manual paths', () => {
    expect(
      formatVaultGitSyncError({
        type: 'conflictResolutionFailed',
        unresolved: [],
        manual: ['Inbox/c.md'],
      }),
    ).toBe('Conflict resolution failed. Requires manual resolution: Inbox/c.md.');
  });

  it('formats conflictResolutionFailed with no paths', () => {
    expect(
      formatVaultGitSyncError({type: 'conflictResolutionFailed', unresolved: [], manual: []}),
    ).toBe('Conflict resolution failed.');
  });

  it('formats non-sync Error values with their message', () => {
    expect(formatVaultGitSyncError(new Error('network unavailable'))).toBe('network unavailable');
  });

  it('formats unknown sync error types with the generic fallback', () => {
    expect(formatVaultGitSyncError({type: 'futureSyncError'})).toBe('Sync failed.');
  });
});

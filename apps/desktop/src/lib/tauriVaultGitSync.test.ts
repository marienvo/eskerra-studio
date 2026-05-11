import {beforeEach, describe, expect, it, vi} from 'vitest';

const {mockInvoke} = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

import {
  getVaultGitStagePlan,
  getVaultGitStatus,
  runVaultGitSync,
  type GitStatusResult,
  type StagePlan,
  type SyncRunResult,
  type SyncConfig,
} from './tauriVaultGitSync';

const VAULT = '/home/user/vault';
const LOCKS_DIR = '/home/user/.local/share/eskerra/locks';

const cleanResult: GitStatusResult = {
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

const syncConfig: SyncConfig = {
  remote: 'origin',
  branch: 'main',
  include: ['**/*.md'],
  exclude: ['Scripts/**'],
  backupDirectory: '_sync-backups',
  conflictPolicies: [{glob: '**/*.md', strategy: 'manual'}],
  markdownConflictCallout: {
    enabled: true,
    calloutKind: 'warning',
    template: 'Conflict backup: [[{backup_path}]]',
  },
  commitMessageTemplate: 'chore: sync {timestamp} {host}',
  hostLabel: 'laptop',
  backupLocalSubdir: 'local',
  backupRemoteSubdir: 'remote',
  timeouts: {
    fetchSecs: 30,
    pushSecs: 30,
    mergeSecs: 30,
  },
  allowCreateBackupDirectory: false,
  skipCommitHooks: true,
};

const stagePlan: StagePlan = {
  includedPaths: [{path: 'note.md', change: 'modifiedTracked', reason: 'included'}],
  excludedPaths: [{path: 'Scripts/build.md', change: 'modifiedTracked', reason: 'excludedByConfig'}],
  unsupportedPaths: [],
};

const syncRunResult: SyncRunResult = {
  localCommit: {
    stageResult: {
      stagedPaths: [{path: 'note.md', change: 'modifiedTracked', reason: 'included'}],
      excludedPaths: [],
      unsupportedPaths: [],
      mutated: true,
    },
    commit: {sha: 'abc123', message: 'chore: sync now laptop'},
    mutated: true,
  },
  preMergeSha: 'abc123',
  pushed: true,
  snapshotBranch: null,
  finalHeadSha: 'def456',
};

describe('getVaultGitStatus', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it('invokes vault_git_status with correct argument shape', async () => {
    mockInvoke.mockResolvedValue(cleanResult);
    await getVaultGitStatus({vaultPath: VAULT, remote: 'origin', branch: 'main'});
    expect(mockInvoke).toHaveBeenCalledWith('vault_git_status', {
      vaultPath: VAULT,
      remote: 'origin',
      branch: 'main',
    });
  });

  it('returns the invoke result', async () => {
    mockInvoke.mockResolvedValue(cleanResult);
    const result = await getVaultGitStatus({vaultPath: VAULT, remote: 'origin', branch: 'main'});
    expect(result).toEqual(cleanResult);
  });

  it('propagates invoke rejection as-is', async () => {
    const error: {type: string} = {type: 'notGitRepository'};
    mockInvoke.mockRejectedValue(error);
    await expect(
      getVaultGitStatus({vaultPath: VAULT, remote: 'origin', branch: 'main'}),
    ).rejects.toEqual(error);
  });

  it('passes through a result with unsafe state set', async () => {
    const result: GitStatusResult = {...cleanResult, unsafeState: 'merge', isWrongBranch: false};
    mockInvoke.mockResolvedValue(result);
    const got = await getVaultGitStatus({vaultPath: VAULT, remote: 'origin', branch: 'main'});
    expect(got.unsafeState).toBe('merge');
  });

  it('passes through a result with wrong branch and null unsafe state', async () => {
    const result: GitStatusResult = {
      ...cleanResult,
      branch: 'feature',
      isWrongBranch: true,
      unsafeState: null,
    };
    mockInvoke.mockResolvedValue(result);
    const got = await getVaultGitStatus({vaultPath: VAULT, remote: 'origin', branch: 'main'});
    expect(got.isWrongBranch).toBe(true);
    expect(got.branch).toBe('feature');
    expect(got.unsafeState).toBeNull();
  });
});

describe('getVaultGitStagePlan', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it('invokes vault_git_stage_plan with correct argument shape', async () => {
    mockInvoke.mockResolvedValue(stagePlan);
    await getVaultGitStagePlan({vaultPath: VAULT, config: syncConfig});
    expect(mockInvoke).toHaveBeenCalledWith('vault_git_stage_plan', {
      vaultPath: VAULT,
      config: syncConfig,
    });
  });

  it('returns the invoke result', async () => {
    mockInvoke.mockResolvedValue(stagePlan);
    const result = await getVaultGitStagePlan({vaultPath: VAULT, config: syncConfig});
    expect(result).toEqual(stagePlan);
  });

  it('propagates invoke rejection as-is', async () => {
    const error = {type: 'invalidConfig', reason: 'include must contain at least one glob'};
    mockInvoke.mockRejectedValue(error);
    await expect(getVaultGitStagePlan({vaultPath: VAULT, config: syncConfig})).rejects.toEqual(
      error,
    );
  });
});

describe('runVaultGitSync', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it('invokes vault_git_sync_run with correct argument shape', async () => {
    mockInvoke.mockResolvedValue(syncRunResult);
    await runVaultGitSync({vaultPath: VAULT, locksDir: LOCKS_DIR, config: syncConfig});
    expect(mockInvoke).toHaveBeenCalledWith('vault_git_sync_run', {
      vaultPath: VAULT,
      locksDir: LOCKS_DIR,
      config: syncConfig,
    });
  });

  it('returns the invoke result', async () => {
    mockInvoke.mockResolvedValue(syncRunResult);
    const result = await runVaultGitSync({vaultPath: VAULT, locksDir: LOCKS_DIR, config: syncConfig});
    expect(result).toEqual(syncRunResult);
  });

  it('propagates MergeFailed errors as-is', async () => {
    const error = {
      type: 'mergeFailed',
      stderr: 'conflict',
      snapshotBranch: 'eskerra/sync-snapshot-1',
      preMergeSha: 'abc123',
    };
    mockInvoke.mockRejectedValue(error);
    await expect(
      runVaultGitSync({vaultPath: VAULT, locksDir: LOCKS_DIR, config: syncConfig}),
    ).rejects.toEqual(error);
  });

  it('propagates LockAlreadyHeld errors as-is', async () => {
    const error = {type: 'lockAlreadyHeld'};
    mockInvoke.mockRejectedValue(error);
    await expect(
      runVaultGitSync({vaultPath: VAULT, locksDir: LOCKS_DIR, config: syncConfig}),
    ).rejects.toEqual(error);
  });
});

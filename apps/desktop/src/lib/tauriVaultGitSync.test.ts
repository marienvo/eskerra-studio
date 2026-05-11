import {beforeEach, describe, expect, it, vi} from 'vitest';

const {mockInvoke} = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

import {getVaultGitStatus, type GitStatusResult} from './tauriVaultGitSync';

const VAULT = '/home/user/vault';

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

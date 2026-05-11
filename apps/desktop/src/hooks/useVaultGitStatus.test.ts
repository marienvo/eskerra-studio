import {act, renderHook, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const {mockGetVaultGitStatus} = vi.hoisted(() => ({
  mockGetVaultGitStatus: vi.fn(),
}));

vi.mock('../lib/tauriVaultGitSync', () => ({
  getVaultGitStatus: mockGetVaultGitStatus,
}));

import type {GitStatusResult} from '../lib/tauriVaultGitSync';
import {useVaultGitStatus} from './useVaultGitStatus';

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

function renderGitStatus(vaultPath: string | null = VAULT) {
  return renderHook(() =>
    useVaultGitStatus({vaultPath, remote: 'origin', branch: 'main'}),
  );
}

describe('useVaultGitStatus', () => {
  beforeEach(() => {
    mockGetVaultGitStatus.mockReset();
  });

  it('starts with loading false and no status when vaultPath is null', () => {
    const {result} = renderHook(() =>
      useVaultGitStatus({vaultPath: null, remote: 'origin', branch: 'main'}),
    );
    expect(result.current.loading).toBe(false);
    expect(result.current.status).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('goes loading then delivers status on success', async () => {
    mockGetVaultGitStatus.mockResolvedValue(cleanResult);
    const {result} = renderGitStatus();

    await waitFor(() => {
      expect(result.current.status).toEqual(cleanResult);
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('passes correct arguments to getVaultGitStatus', async () => {
    mockGetVaultGitStatus.mockResolvedValue(cleanResult);
    renderGitStatus(VAULT);

    await waitFor(() => expect(mockGetVaultGitStatus).toHaveBeenCalled());

    expect(mockGetVaultGitStatus).toHaveBeenCalledWith({
      vaultPath: VAULT,
      remote: 'origin',
      branch: 'main',
    });
  });

  it('sets error and clears loading on failure', async () => {
    mockGetVaultGitStatus.mockRejectedValue({type: 'notGitRepository'});
    const {result} = renderGitStatus();

    await waitFor(() => {
      expect(result.current.error).toBe('Not a Git repository');
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.status).toBeNull();
  });

  it('formats lockAlreadyHeld error', async () => {
    mockGetVaultGitStatus.mockRejectedValue({type: 'lockAlreadyHeld'});
    const {result} = renderGitStatus();

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error).toBe('Sync already running');
  });

  it('formats gitCommandFailed error with first stderr line', async () => {
    mockGetVaultGitStatus.mockRejectedValue({
      type: 'gitCommandFailed',
      command: 'git status',
      exitCode: 128,
      stderr: 'fatal: not a git repo\nmore info',
    });
    const {result} = renderGitStatus();

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error).toContain('fatal: not a git repo');
  });

  it('does not call getVaultGitStatus when vaultPath is null', async () => {
    const {result} = renderHook(() =>
      useVaultGitStatus({vaultPath: null, remote: 'origin', branch: 'main'}),
    );
    // Give microtask queue a chance to flush.
    await act(async () => {
      await new Promise(r => setTimeout(r, 10));
    });
    expect(mockGetVaultGitStatus).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
  });

  it('resets state and does not call getVaultGitStatus when vaultPath becomes null', async () => {
    mockGetVaultGitStatus.mockResolvedValue(cleanResult);
    const {result, rerender} = renderHook(
      ({vaultPath}: {vaultPath: string | null}) =>
        useVaultGitStatus({vaultPath, remote: 'origin', branch: 'main'}),
      {initialProps: {vaultPath: VAULT as string | null}},
    );

    await waitFor(() => expect(result.current.status).not.toBeNull());

    rerender({vaultPath: null});

    await act(async () => {
      await new Promise(r => setTimeout(r, 10));
    });

    expect(result.current.status).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('ignores stale result when vaultPath changes before first load resolves', async () => {
    let resolveFirst!: (v: GitStatusResult) => void;
    const firstResult: GitStatusResult = {...cleanResult, branch: 'first'};
    const secondResult: GitStatusResult = {...cleanResult, branch: 'second'};

    mockGetVaultGitStatus
      .mockImplementationOnce(
        () => new Promise<GitStatusResult>(r => { resolveFirst = r; }),
      )
      .mockResolvedValueOnce(secondResult);

    const {result, rerender} = renderHook(
      ({vaultPath}: {vaultPath: string}) =>
        useVaultGitStatus({vaultPath, remote: 'origin', branch: 'main'}),
      {initialProps: {vaultPath: VAULT}},
    );

    // Change vault path while first request is still pending.
    rerender({vaultPath: '/other/vault'});

    // Second request resolves normally.
    await waitFor(() => expect(result.current.status?.branch).toBe('second'));

    // Now resolve the first (stale) request — result must not overwrite.
    await act(async () => { resolveFirst(firstResult); });

    expect(result.current.status?.branch).toBe('second');
  });

  it('refresh triggers a new load', async () => {
    const first: GitStatusResult = {...cleanResult, ahead: 0};
    const second: GitStatusResult = {...cleanResult, ahead: 3};
    mockGetVaultGitStatus
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);

    const {result} = renderGitStatus();
    await waitFor(() => expect(result.current.status).toEqual(first));

    act(() => { result.current.refresh(); });
    await waitFor(() => expect(result.current.status).toEqual(second));
  });
});

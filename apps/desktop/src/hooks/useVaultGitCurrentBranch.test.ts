import {act, renderHook, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const {mockGetVaultGitCurrentBranch} = vi.hoisted(() => ({
  mockGetVaultGitCurrentBranch: vi.fn(),
}));

vi.mock('../lib/tauriVaultGitSync', () => ({
  getVaultGitCurrentBranch: mockGetVaultGitCurrentBranch,
}));

import {useVaultGitCurrentBranch} from './useVaultGitCurrentBranch';

const VAULT = '/home/user/vault';

function branchResult(branch: string | null, detachedHead = false) {
  return {branch, detachedHead};
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => {
    resolve = res;
  });
  return {promise, resolve};
}

describe('useVaultGitCurrentBranch', () => {
  beforeEach(() => {
    mockGetVaultGitCurrentBranch.mockReset();
  });

  it('loads current branch', async () => {
    mockGetVaultGitCurrentBranch.mockResolvedValue(branchResult('main'));

    const {result} = renderHook(() => useVaultGitCurrentBranch({vaultPath: VAULT}));

    await waitFor(() => expect(result.current.branch).toBe('main'));
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.detachedHead).toBe(false);
  });

  it('represents detached HEAD separately from a load error', async () => {
    mockGetVaultGitCurrentBranch.mockResolvedValue(branchResult(null, true));

    const {result} = renderHook(() => useVaultGitCurrentBranch({vaultPath: VAULT}));

    await waitFor(() => expect(result.current.detachedHead).toBe(true));
    expect(result.current.branch).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('does not call when vaultPath is null', async () => {
    const {result} = renderHook(() => useVaultGitCurrentBranch({vaultPath: null}));

    await act(async () => {
      await new Promise(r => setTimeout(r, 10));
    });

    expect(mockGetVaultGitCurrentBranch).not.toHaveBeenCalled();
    expect(result.current.branch).toBeNull();
    expect(result.current.detachedHead).toBe(false);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('resets and does not call when vaultPath becomes null', async () => {
    mockGetVaultGitCurrentBranch.mockResolvedValue(branchResult('main'));
    const {result, rerender} = renderHook(
      ({vaultPath}: {vaultPath: string | null}) => useVaultGitCurrentBranch({vaultPath}),
      {initialProps: {vaultPath: VAULT as string | null}},
    );
    await waitFor(() => expect(result.current.branch).toBe('main'));

    rerender({vaultPath: null});

    expect(result.current.branch).toBeNull();
    expect(result.current.detachedHead).toBe(false);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('stale request cannot overwrite newer branch', async () => {
    const first = deferred<ReturnType<typeof branchResult>>();
    mockGetVaultGitCurrentBranch
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce(branchResult('feature'));

    const {result, rerender} = renderHook(
      ({vaultPath}: {vaultPath: string}) => useVaultGitCurrentBranch({vaultPath}),
      {initialProps: {vaultPath: VAULT}},
    );

    rerender({vaultPath: '/other/vault'});
    await waitFor(() => expect(result.current.branch).toBe('feature'));

    await act(async () => { first.resolve(branchResult('main')); });

    expect(result.current.branch).toBe('feature');
  });

  it('hides stale branch while a new vault branch is loading', async () => {
    const second = deferred<ReturnType<typeof branchResult>>();
    mockGetVaultGitCurrentBranch
      .mockResolvedValueOnce(branchResult('main'))
      .mockImplementationOnce(() => second.promise);

    const {result, rerender} = renderHook(
      ({vaultPath}: {vaultPath: string}) => useVaultGitCurrentBranch({vaultPath}),
      {initialProps: {vaultPath: VAULT}},
    );
    await waitFor(() => expect(result.current.branch).toBe('main'));

    rerender({vaultPath: '/other/vault'});

    expect(result.current.branch).toBeNull();
    expect(result.current.loading).toBe(true);

    await act(async () => { second.resolve(branchResult('feature')); });
    await waitFor(() => expect(result.current.branch).toBe('feature'));
  });

  it('clears a failed vault error when another vault branch loads successfully', async () => {
    mockGetVaultGitCurrentBranch
      .mockRejectedValueOnce({type: 'notGitRepository'})
      .mockResolvedValueOnce(branchResult('main'));

    const {result, rerender} = renderHook(
      ({vaultPath}: {vaultPath: string}) => useVaultGitCurrentBranch({vaultPath}),
      {initialProps: {vaultPath: VAULT}},
    );
    await waitFor(() => expect(result.current.error).toBe('Not a Git repository'));

    rerender({vaultPath: '/other/vault'});

    await waitFor(() => expect(result.current.branch).toBe('main'));
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('refresh uses latest-request-wins', async () => {
    const firstRefresh = deferred<ReturnType<typeof branchResult>>();
    const secondRefresh = deferred<ReturnType<typeof branchResult>>();
    mockGetVaultGitCurrentBranch
      .mockResolvedValueOnce(branchResult('main'))
      .mockImplementationOnce(() => firstRefresh.promise)
      .mockImplementationOnce(() => secondRefresh.promise);

    const {result} = renderHook(() => useVaultGitCurrentBranch({vaultPath: VAULT}));
    await waitFor(() => expect(result.current.branch).toBe('main'));

    act(() => {
      result.current.refresh();
      result.current.refresh();
    });
    await waitFor(() => expect(mockGetVaultGitCurrentBranch).toHaveBeenCalledTimes(3));

    await act(async () => { secondRefresh.resolve(branchResult('latest')); });
    await waitFor(() => expect(result.current.branch).toBe('latest'));

    await act(async () => { firstRefresh.resolve(branchResult('stale')); });

    expect(result.current.branch).toBe('latest');
  });
});

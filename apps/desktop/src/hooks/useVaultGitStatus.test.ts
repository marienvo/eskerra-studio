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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return {promise, resolve, reject};
}

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

  it('clears a failed status error when status later loads successfully', async () => {
    mockGetVaultGitStatus
      .mockRejectedValueOnce({type: 'notGitRepository'})
      .mockResolvedValueOnce(cleanResult);

    const {result, rerender} = renderHook(
      ({branch}: {branch: string}) =>
        useVaultGitStatus({vaultPath: VAULT, remote: 'origin', branch}),
      {initialProps: {branch: 'main'}},
    );
    await waitFor(() => expect(result.current.error).toBe('Not a Git repository'));

    rerender({branch: 'feature'});

    await waitFor(() => expect(result.current.status).toEqual(cleanResult));
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
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

  it('does not call getVaultGitStatus when branch is null', async () => {
    const {result} = renderHook(() =>
      useVaultGitStatus({vaultPath: VAULT, remote: 'origin', branch: null}),
    );
    await act(async () => {
      await new Promise(r => setTimeout(r, 10));
    });
    expect(mockGetVaultGitStatus).not.toHaveBeenCalled();
    expect(result.current.status).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
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

  it('resets state and does not call getVaultGitStatus when branch becomes null', async () => {
    mockGetVaultGitStatus.mockResolvedValue(cleanResult);
    const {result, rerender} = renderHook(
      ({branch}: {branch: string | null}) =>
        useVaultGitStatus({vaultPath: VAULT, remote: 'origin', branch}),
      {initialProps: {branch: 'main' as string | null}},
    );

    await waitFor(() => expect(result.current.status).not.toBeNull());

    rerender({branch: null});

    expect(result.current.status).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(mockGetVaultGitStatus).toHaveBeenCalledTimes(1);
  });

  it('hides stale status while a new branch status is loading', async () => {
    const featureLoad = deferred<GitStatusResult>();
    mockGetVaultGitStatus
      .mockResolvedValueOnce(cleanResult)
      .mockImplementationOnce(() => featureLoad.promise);

    const {result, rerender} = renderHook(
      ({branch}: {branch: string}) =>
        useVaultGitStatus({vaultPath: VAULT, remote: 'origin', branch}),
      {initialProps: {branch: 'main'}},
    );
    await waitFor(() => expect(result.current.status).toEqual(cleanResult));

    rerender({branch: 'feature'});

    expect(result.current.status).toBeNull();
    expect(result.current.loading).toBe(true);

    const featureResult: GitStatusResult = {
      ...cleanResult,
      branch: 'feature',
      expectedBranch: 'feature',
    };
    await act(async () => { featureLoad.resolve(featureResult); });
    await waitFor(() => expect(result.current.status).toEqual(featureResult));
  });

  it('ignores stale result when vaultPath changes before first load resolves', async () => {
    const firstLoad = deferred<GitStatusResult>();
    const firstResult: GitStatusResult = {...cleanResult, branch: 'first'};
    const secondResult: GitStatusResult = {...cleanResult, branch: 'second'};

    mockGetVaultGitStatus
      .mockImplementationOnce(() => firstLoad.promise)
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
    await act(async () => { firstLoad.resolve(firstResult); });

    expect(result.current.status?.branch).toBe('second');
  });

  it('keeps refresh result when initial load resolves after refresh', async () => {
    const initialLoad = deferred<GitStatusResult>();
    const refreshLoad = deferred<GitStatusResult>();
    const initialResult: GitStatusResult = {...cleanResult, branch: 'initial'};
    const refreshResult: GitStatusResult = {...cleanResult, branch: 'refresh', ahead: 2};

    mockGetVaultGitStatus
      .mockImplementationOnce(() => initialLoad.promise)
      .mockImplementationOnce(() => refreshLoad.promise);

    const {result} = renderGitStatus();
    await waitFor(() => expect(mockGetVaultGitStatus).toHaveBeenCalledTimes(1));

    act(() => { result.current.refresh(); });
    await waitFor(() => expect(mockGetVaultGitStatus).toHaveBeenCalledTimes(2));

    await act(async () => { refreshLoad.resolve(refreshResult); });
    await waitFor(() => expect(result.current.status).toEqual(refreshResult));
    expect(result.current.loading).toBe(false);

    await act(async () => { initialLoad.resolve(initialResult); });

    expect(result.current.status).toEqual(refreshResult);
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('uses the latest result when two refreshes run in quick succession', async () => {
    const firstRefresh = deferred<GitStatusResult>();
    const secondRefresh = deferred<GitStatusResult>();
    const first: GitStatusResult = {...cleanResult, ahead: 0};
    const staleRefreshResult: GitStatusResult = {...cleanResult, branch: 'stale-refresh', ahead: 1};
    const latestRefreshResult: GitStatusResult = {...cleanResult, branch: 'latest-refresh', ahead: 4};

    mockGetVaultGitStatus
      .mockResolvedValueOnce(first)
      .mockImplementationOnce(() => firstRefresh.promise)
      .mockImplementationOnce(() => secondRefresh.promise);

    const {result} = renderGitStatus();
    await waitFor(() => expect(result.current.status).toEqual(first));

    act(() => {
      result.current.refresh();
      result.current.refresh();
    });
    await waitFor(() => expect(mockGetVaultGitStatus).toHaveBeenCalledTimes(3));

    await act(async () => { secondRefresh.resolve(latestRefreshResult); });
    await waitFor(() => expect(result.current.status).toEqual(latestRefreshResult));

    await act(async () => { firstRefresh.resolve(staleRefreshResult); });

    expect(result.current.status).toEqual(latestRefreshResult);
    expect(result.current.error).toBeNull();
  });

  it('keeps the current status visible during a silent refresh', async () => {
    const silentRefresh = deferred<GitStatusResult>();
    const initial: GitStatusResult = {...cleanResult, hasUncommittedChanges: true};
    const refreshed: GitStatusResult = {...cleanResult, ahead: 1};
    mockGetVaultGitStatus
      .mockResolvedValueOnce(initial)
      .mockImplementationOnce(() => silentRefresh.promise);

    const {result} = renderGitStatus();
    await waitFor(() => expect(result.current.status).toEqual(initial));

    act(() => { result.current.refresh({silent: true}); });
    await waitFor(() => expect(mockGetVaultGitStatus).toHaveBeenCalledTimes(2));

    expect(result.current.status).toEqual(initial);
    expect(result.current.loading).toBe(false);

    await act(async () => { silentRefresh.resolve(refreshed); });

    await waitFor(() => expect(result.current.status).toEqual(refreshed));
    expect(result.current.loading).toBe(false);
  });

  it('shows loading during a non-silent refresh when a status is already loaded', async () => {
    const refreshLoad = deferred<GitStatusResult>();
    mockGetVaultGitStatus
      .mockResolvedValueOnce(cleanResult)
      .mockImplementationOnce(() => refreshLoad.promise);

    const {result} = renderGitStatus();
    await waitFor(() => expect(result.current.status).toEqual(cleanResult));

    act(() => { result.current.refresh(); });
    await waitFor(() => expect(mockGetVaultGitStatus).toHaveBeenCalledTimes(2));

    expect(result.current.status).toEqual(cleanResult);
    expect(result.current.loading).toBe(true);

    await act(async () => { refreshLoad.resolve({...cleanResult, ahead: 1}); });
    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it('ignores stale error when a newer refresh succeeds', async () => {
    const initialLoad = deferred<GitStatusResult>();
    const refreshLoad = deferred<GitStatusResult>();
    const refreshResult: GitStatusResult = {...cleanResult, branch: 'refresh-success'};

    mockGetVaultGitStatus
      .mockImplementationOnce(() => initialLoad.promise)
      .mockImplementationOnce(() => refreshLoad.promise);

    const {result} = renderGitStatus();
    await waitFor(() => expect(mockGetVaultGitStatus).toHaveBeenCalledTimes(1));

    act(() => { result.current.refresh(); });
    await waitFor(() => expect(mockGetVaultGitStatus).toHaveBeenCalledTimes(2));

    await act(async () => { refreshLoad.resolve(refreshResult); });
    await waitFor(() => expect(result.current.status).toEqual(refreshResult));

    await act(async () => { initialLoad.reject({type: 'notGitRepository'}); });

    expect(result.current.status).toEqual(refreshResult);
    expect(result.current.error).toBeNull();
  });

  it('ignores stale finally when an older request resolves during a newer pending refresh', async () => {
    const initialLoad = deferred<GitStatusResult>();
    const refreshLoad = deferred<GitStatusResult>();
    const initialResult: GitStatusResult = {...cleanResult, branch: 'initial'};
    const refreshResult: GitStatusResult = {...cleanResult, branch: 'refresh'};

    mockGetVaultGitStatus
      .mockImplementationOnce(() => initialLoad.promise)
      .mockImplementationOnce(() => refreshLoad.promise);

    const {result} = renderGitStatus();
    await waitFor(() => expect(result.current.loading).toBe(true));

    act(() => { result.current.refresh(); });
    await waitFor(() => expect(mockGetVaultGitStatus).toHaveBeenCalledTimes(2));

    await act(async () => { initialLoad.resolve(initialResult); });

    expect(result.current.status).toBeNull();
    expect(result.current.loading).toBe(true);

    await act(async () => { refreshLoad.resolve(refreshResult); });
    await waitFor(() => expect(result.current.status).toEqual(refreshResult));
    expect(result.current.loading).toBe(false);
  });

  it('refresh triggers a new load and clears a prior error', async () => {
    const second: GitStatusResult = {...cleanResult, ahead: 3};
    mockGetVaultGitStatus
      .mockRejectedValueOnce({type: 'notGitRepository'})
      .mockResolvedValueOnce(second);

    const {result} = renderGitStatus();
    await waitFor(() => expect(result.current.error).toBe('Not a Git repository'));

    act(() => { result.current.refresh(); });
    await waitFor(() => expect(result.current.status).toEqual(second));
    expect(result.current.error).toBeNull();
  });
});

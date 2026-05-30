import {act, renderHook, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const {mockRefreshVaultGitRemoteStatus} = vi.hoisted(() => ({
  mockRefreshVaultGitRemoteStatus: vi.fn(),
}));

vi.mock('../lib/tauriVaultGitSync', () => ({
  refreshVaultGitRemoteStatus: mockRefreshVaultGitRemoteStatus,
}));

import type {GitStatusResult} from '../lib/tauriVaultGitSync';
import {useVaultGitRemoteRefresh} from './useVaultGitRemoteRefresh';

const VAULT = '/home/user/vault';

const cleanResult: GitStatusResult = {
  branch: 'main',
  expectedBranch: 'main',
  hasUncommittedChanges: false,
  hasStagedChanges: false,
  hasUntrackedFiles: false,
  ahead: 0,
  behind: 1,
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

type HookInput = Parameters<typeof useVaultGitRemoteRefresh>[0];

function renderRemoteRefresh(overrides: Partial<HookInput> = {}) {
  const onRefreshed = vi.fn();
  const {result, rerender} = renderHook((props: Partial<HookInput>) =>
    useVaultGitRemoteRefresh({
      vaultPath: VAULT,
      remote: 'origin',
      branch: 'main',
      fetchTimeoutSecs: 30,
      manualSyncRunning: false,
      onRefreshed,
      ...props,
    }),
    {initialProps: overrides},
  );
  return {result, rerender, onRefreshed};
}

describe('useVaultGitRemoteRefresh', () => {
  beforeEach(() => {
    mockRefreshVaultGitRemoteStatus.mockReset();
  });

  it('starts with loading false and no error', () => {
    const {result} = renderRemoteRefresh();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('does not call refreshVaultGitRemoteStatus on mount', async () => {
    renderRemoteRefresh();
    await act(async () => {
      await new Promise(r => setTimeout(r, 10));
    });
    expect(mockRefreshVaultGitRemoteStatus).not.toHaveBeenCalled();
  });

  it('calls refreshVaultGitRemoteStatus with correct args on refresh', async () => {
    mockRefreshVaultGitRemoteStatus.mockResolvedValue(cleanResult);
    const {result} = renderRemoteRefresh();

    act(() => { result.current.refresh(); });

    await waitFor(() => expect(mockRefreshVaultGitRemoteStatus).toHaveBeenCalled());
    expect(mockRefreshVaultGitRemoteStatus).toHaveBeenCalledWith({
      vaultPath: VAULT,
      remote: 'origin',
      branch: 'main',
      fetchTimeoutSecs: 30,
    });
  });

  it('sets loading true during fetch and false after success', async () => {
    const load = deferred<GitStatusResult>();
    mockRefreshVaultGitRemoteStatus.mockImplementation(() => load.promise);
    const {result} = renderRemoteRefresh();

    act(() => { result.current.refresh(); });
    await waitFor(() => expect(result.current.loading).toBe(true));

    await act(async () => { load.resolve(cleanResult); });
    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it('calls onRefreshed with result on success', async () => {
    mockRefreshVaultGitRemoteStatus.mockResolvedValue(cleanResult);
    const {result, onRefreshed} = renderRemoteRefresh();

    act(() => { result.current.refresh(); });
    await waitFor(() => expect(onRefreshed).toHaveBeenCalled());

    expect(onRefreshed).toHaveBeenCalledWith(cleanResult);
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('calls onSettled with vault path when a started refresh finishes', async () => {
    mockRefreshVaultGitRemoteStatus.mockResolvedValue(cleanResult);
    const onSettled = vi.fn();
    const {result} = renderRemoteRefresh({onSettled});

    act(() => { result.current.refresh(); });
    await waitFor(() => expect(onSettled).toHaveBeenCalledWith(VAULT));
  });

  it('does not call onSettled when refresh is skipped', async () => {
    const onSettled = vi.fn();
    const {result} = renderRemoteRefresh({manualSyncRunning: true, onSettled});

    act(() => { result.current.refresh(); });

    await act(async () => { await new Promise(r => setTimeout(r, 10)); });
    expect(onSettled).not.toHaveBeenCalled();
  });

  it('sets error and clears loading on failure', async () => {
    const fetchError = {type: 'fetchFailed', stderr: 'fatal: auth failure'};
    mockRefreshVaultGitRemoteStatus.mockRejectedValue(fetchError);
    const {result} = renderRemoteRefresh();

    act(() => { result.current.refresh(); });
    await waitFor(() => expect(result.current.error).not.toBeNull());

    expect(result.current.error).toEqual(fetchError);
    expect(result.current.loading).toBe(false);
  });

  it('is a no-op when manualSyncRunning is true', async () => {
    const {result} = renderRemoteRefresh({manualSyncRunning: true});

    act(() => { result.current.refresh(); });

    await act(async () => { await new Promise(r => setTimeout(r, 10)); });
    expect(mockRefreshVaultGitRemoteStatus).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
  });

  it('is a no-op when another frontend Git operation is running', async () => {
    const gitOperationBusyRef = {current: true};
    const {result, onRefreshed} = renderRemoteRefresh({gitOperationBusyRef});

    act(() => { result.current.refresh(); });

    await act(async () => { await new Promise(r => setTimeout(r, 10)); });
    expect(mockRefreshVaultGitRemoteStatus).not.toHaveBeenCalled();
    expect(onRefreshed).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(gitOperationBusyRef.current).toBe(true);
  });

  it('marks the frontend Git operation busy only while refresh is in flight', async () => {
    const gitOperationBusyRef = {current: false};
    const load = deferred<GitStatusResult>();
    mockRefreshVaultGitRemoteStatus.mockImplementation(() => load.promise);
    const {result} = renderRemoteRefresh({gitOperationBusyRef});

    act(() => { result.current.refresh(); });

    expect(gitOperationBusyRef.current).toBe(true);
    await act(async () => { load.resolve(cleanResult); });
    await waitFor(() => expect(gitOperationBusyRef.current).toBe(false));
  });

  it('is a no-op when vaultPath is null', async () => {
    const {result} = renderRemoteRefresh({vaultPath: null});

    act(() => { result.current.refresh(); });

    await act(async () => { await new Promise(r => setTimeout(r, 10)); });
    expect(mockRefreshVaultGitRemoteStatus).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
  });

  it('is a no-op when branch is null', async () => {
    const {result} = renderRemoteRefresh({branch: null});

    act(() => { result.current.refresh(); });

    await act(async () => { await new Promise(r => setTimeout(r, 10)); });
    expect(mockRefreshVaultGitRemoteStatus).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
  });

  it('ignores stale result when a newer refresh is pending', async () => {
    const first = deferred<GitStatusResult>();
    const second = deferred<GitStatusResult>();
    const staleResult: GitStatusResult = {...cleanResult, behind: 99};
    const freshResult: GitStatusResult = {...cleanResult, behind: 1};
    const onRefreshed = vi.fn();

    mockRefreshVaultGitRemoteStatus
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);

    const {result} = renderHook(() =>
      useVaultGitRemoteRefresh({
        vaultPath: VAULT,
        remote: 'origin',
        branch: 'main',
        fetchTimeoutSecs: 30,
        manualSyncRunning: false,
        onRefreshed,
      }),
    );

    act(() => {
      result.current.refresh();
      result.current.refresh();
    });

    await act(async () => { second.resolve(freshResult); });
    await waitFor(() => expect(onRefreshed).toHaveBeenCalledWith(freshResult));

    await act(async () => { first.resolve(staleResult); });

    expect(onRefreshed).toHaveBeenCalledTimes(1);
    expect(onRefreshed).toHaveBeenCalledWith(freshResult);
  });

  it('ignores stale error when a newer refresh succeeds', async () => {
    const first = deferred<GitStatusResult>();
    const second = deferred<GitStatusResult>();
    const onRefreshed = vi.fn();

    mockRefreshVaultGitRemoteStatus
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);

    const {result} = renderHook(() =>
      useVaultGitRemoteRefresh({
        vaultPath: VAULT,
        remote: 'origin',
        branch: 'main',
        fetchTimeoutSecs: 30,
        manualSyncRunning: false,
        onRefreshed,
      }),
    );

    act(() => {
      result.current.refresh();
      result.current.refresh();
    });

    await act(async () => { second.resolve(cleanResult); });
    await waitFor(() => expect(onRefreshed).toHaveBeenCalled());

    await act(async () => { first.reject({type: 'fetchFailed', stderr: 'stale error'}); });

    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });
});

import {act, renderHook} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const {mockRefreshVaultGitRemoteStatus} = vi.hoisted(() => ({
  mockRefreshVaultGitRemoteStatus: vi.fn(),
}));

vi.mock('../lib/tauriVaultGitSync', () => ({
  refreshVaultGitRemoteStatus: mockRefreshVaultGitRemoteStatus,
}));

import type {GitStatusResult} from '../lib/tauriVaultGitSync';
import {
  REMOTE_POLL_INTERVAL_MS,
  useVaultGitRemoteStatusPolling,
} from './useVaultGitRemoteStatusPolling';

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

type HookInput = Parameters<typeof useVaultGitRemoteStatusPolling>[0];

function renderPolling(overrides: Partial<HookInput> = {}) {
  return renderHook((props: Partial<HookInput>) =>
    useVaultGitRemoteStatusPolling({
      vaultPath: VAULT,
      remote: 'origin',
      branch: 'main',
      fetchTimeoutSecs: 30,
      manualSyncRunning: false,
      ...props,
    }),
    {initialProps: overrides},
  );
}

let hiddenSpy: ReturnType<typeof vi.spyOn> | null = null;

function stubDocumentHidden(hidden: boolean): void {
  hiddenSpy?.mockRestore();
  hiddenSpy = vi.spyOn(document, 'hidden', 'get').mockReturnValue(hidden);
}

describe('useVaultGitRemoteStatusPolling', () => {
  beforeEach(() => {
    mockRefreshVaultGitRemoteStatus.mockReset();
    mockRefreshVaultGitRemoteStatus.mockResolvedValue(cleanResult);
  });

  afterEach(() => {
    vi.useRealTimers();
    hiddenSpy?.mockRestore();
    hiddenSpy = null;
  });

  it('calls refreshVaultGitRemoteStatus once when vault and branch are ready', async () => {
    renderPolling();

    await act(async () => { await Promise.resolve(); });

    expect(mockRefreshVaultGitRemoteStatus).toHaveBeenCalledTimes(1);
  });

  it('starts with initialRemoteStatusSettled false until the first fetch completes', async () => {
    const {result} = renderPolling();

    expect(result.current.initialRemoteStatusSettled).toBe(false);

    await act(async () => { await Promise.resolve(); });

    expect(result.current.initialRemoteStatusSettled).toBe(true);
  });

  it('sets initialRemoteStatusSettled when the first fetch fails', async () => {
    mockRefreshVaultGitRemoteStatus.mockRejectedValue({type: 'fetchFailed', stderr: 'err'});
    const {result} = renderPolling();

    await act(async () => { await Promise.resolve(); });

    expect(result.current.initialRemoteStatusSettled).toBe(true);
  });

  it('reports initialRemoteStatusSettled when vaultPath is null', () => {
    const {result} = renderPolling({vaultPath: null});

    expect(result.current.initialRemoteStatusSettled).toBe(true);
    expect(mockRefreshVaultGitRemoteStatus).not.toHaveBeenCalled();
  });

  it('resets initialRemoteStatusSettled when the vault path changes', async () => {
    const {result, rerender} = renderPolling();

    await act(async () => { await Promise.resolve(); });
    expect(result.current.initialRemoteStatusSettled).toBe(true);

    rerender({vaultPath: '/other-vault'});
    expect(result.current.initialRemoteStatusSettled).toBe(false);

    await act(async () => { await Promise.resolve(); });
    expect(result.current.initialRemoteStatusSettled).toBe(true);
    expect(mockRefreshVaultGitRemoteStatus).toHaveBeenCalledTimes(2);
  });

  it('calls remote status after one interval elapses', async () => {
    vi.useFakeTimers();
    renderPolling();

    await act(async () => { await Promise.resolve(); });
    expect(mockRefreshVaultGitRemoteStatus).toHaveBeenCalledTimes(1);

    await act(async () => { vi.advanceTimersByTime(REMOTE_POLL_INTERVAL_MS); });

    expect(mockRefreshVaultGitRemoteStatus).toHaveBeenCalledTimes(2);
  });

  it('polls on each subsequent interval', async () => {
    vi.useFakeTimers();
    renderPolling();

    await act(async () => { await Promise.resolve(); });

    await act(async () => { vi.advanceTimersByTime(REMOTE_POLL_INTERVAL_MS * 3); });

    expect(mockRefreshVaultGitRemoteStatus).toHaveBeenCalledTimes(4);
  });

  it('does not poll when manualSyncRunning is true', async () => {
    vi.useFakeTimers();
    renderPolling({manualSyncRunning: true});

    await act(async () => { vi.advanceTimersByTime(REMOTE_POLL_INTERVAL_MS); });

    expect(mockRefreshVaultGitRemoteStatus).not.toHaveBeenCalled();
  });

  it('retries the initial fetch when manualSyncRunning becomes false', async () => {
    const {rerender} = renderPolling({manualSyncRunning: true});

    expect(mockRefreshVaultGitRemoteStatus).not.toHaveBeenCalled();

    rerender({manualSyncRunning: false});
    await act(async () => { await Promise.resolve(); });

    expect(mockRefreshVaultGitRemoteStatus).toHaveBeenCalledTimes(1);
  });

  it('does not poll when another frontend Git operation is running', async () => {
    vi.useFakeTimers();
    const gitOperationBusyRef = {current: true};
    const onRefreshed = vi.fn();
    renderPolling({gitOperationBusyRef, onRefreshed});

    await act(async () => { vi.advanceTimersByTime(REMOTE_POLL_INTERVAL_MS); });

    expect(mockRefreshVaultGitRemoteStatus).not.toHaveBeenCalled();
    expect(onRefreshed).not.toHaveBeenCalled();
    expect(gitOperationBusyRef.current).toBe(true);
  });

  it('does not poll when vaultPath is null', async () => {
    vi.useFakeTimers();
    renderPolling({vaultPath: null});

    await act(async () => { vi.advanceTimersByTime(REMOTE_POLL_INTERVAL_MS); });

    expect(mockRefreshVaultGitRemoteStatus).not.toHaveBeenCalled();
  });

  it('does not poll when branch is null', async () => {
    vi.useFakeTimers();
    renderPolling({branch: null});

    await act(async () => { vi.advanceTimersByTime(REMOTE_POLL_INTERVAL_MS); });

    expect(mockRefreshVaultGitRemoteStatus).not.toHaveBeenCalled();
  });

  it('clears interval on unmount', async () => {
    vi.useFakeTimers();
    const {unmount} = renderPolling();

    await act(async () => { await Promise.resolve(); });
    expect(mockRefreshVaultGitRemoteStatus).toHaveBeenCalledTimes(1);

    unmount();
    mockRefreshVaultGitRemoteStatus.mockClear();

    await act(async () => { vi.advanceTimersByTime(REMOTE_POLL_INTERVAL_MS * 3); });

    expect(mockRefreshVaultGitRemoteStatus).not.toHaveBeenCalled();
  });

  it('calls onRefreshed with the result when a poll succeeds', async () => {
    vi.useFakeTimers();
    const onRefreshed = vi.fn();

    renderHook(() =>
      useVaultGitRemoteStatusPolling({
        vaultPath: VAULT,
        remote: 'origin',
        branch: 'main',
        fetchTimeoutSecs: 30,
        manualSyncRunning: false,
        onRefreshed,
      }),
    );

    await act(async () => { await Promise.resolve(); });
    await act(async () => { vi.advanceTimersByTime(REMOTE_POLL_INTERVAL_MS); });
    await act(async () => { await Promise.resolve(); });

    expect(onRefreshed).toHaveBeenCalledWith(cleanResult);
  });

  it('does not call onRefreshed when poll fails', async () => {
    vi.useFakeTimers();
    mockRefreshVaultGitRemoteStatus.mockRejectedValue({type: 'fetchFailed', stderr: 'err'});
    const onRefreshed = vi.fn();

    renderHook(() =>
      useVaultGitRemoteStatusPolling({
        vaultPath: VAULT,
        remote: 'origin',
        branch: 'main',
        fetchTimeoutSecs: 30,
        manualSyncRunning: false,
        onRefreshed,
      }),
    );

    await act(async () => { await Promise.resolve(); });
    await act(async () => { vi.advanceTimersByTime(REMOTE_POLL_INTERVAL_MS); });
    await act(async () => { await Promise.resolve(); });

    expect(onRefreshed).not.toHaveBeenCalled();
  });

  it('does not trigger refresh when visibilitychange fires while hidden', async () => {
    stubDocumentHidden(true);
    renderPolling();

    await act(async () => { await Promise.resolve(); });
    mockRefreshVaultGitRemoteStatus.mockClear();

    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    await act(async () => { await Promise.resolve(); });

    expect(mockRefreshVaultGitRemoteStatus).not.toHaveBeenCalled();
  });

  it('triggers one refresh when window becomes visible', async () => {
    stubDocumentHidden(false);
    renderPolling();

    await act(async () => { await Promise.resolve(); });
    mockRefreshVaultGitRemoteStatus.mockClear();

    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });

    expect(mockRefreshVaultGitRemoteStatus).toHaveBeenCalledTimes(1);
  });

  it('removes visibility listener on unmount', async () => {
    stubDocumentHidden(false);
    const {unmount} = renderPolling();

    unmount();
    mockRefreshVaultGitRemoteStatus.mockClear();

    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    await act(async () => { await Promise.resolve(); });

    expect(mockRefreshVaultGitRemoteStatus).not.toHaveBeenCalled();
  });
});

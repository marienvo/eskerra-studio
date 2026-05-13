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
  });

  afterEach(() => {
    vi.useRealTimers();
    hiddenSpy?.mockRestore();
    hiddenSpy = null;
  });

  it('does not call refreshVaultGitRemoteStatus on mount', () => {
    vi.useFakeTimers();
    mockRefreshVaultGitRemoteStatus.mockResolvedValue(cleanResult);
    renderPolling();

    expect(mockRefreshVaultGitRemoteStatus).not.toHaveBeenCalled();
  });

  it('calls remote status after one interval elapses', async () => {
    vi.useFakeTimers();
    mockRefreshVaultGitRemoteStatus.mockResolvedValue(cleanResult);
    renderPolling();

    await act(async () => { vi.advanceTimersByTime(REMOTE_POLL_INTERVAL_MS); });

    expect(mockRefreshVaultGitRemoteStatus).toHaveBeenCalledTimes(1);
  });

  it('polls on each subsequent interval', async () => {
    vi.useFakeTimers();
    mockRefreshVaultGitRemoteStatus.mockResolvedValue(cleanResult);
    renderPolling();

    await act(async () => { vi.advanceTimersByTime(REMOTE_POLL_INTERVAL_MS * 3); });

    expect(mockRefreshVaultGitRemoteStatus).toHaveBeenCalledTimes(3);
  });

  it('does not poll when manualSyncRunning is true', async () => {
    vi.useFakeTimers();
    renderPolling({manualSyncRunning: true});

    await act(async () => { vi.advanceTimersByTime(REMOTE_POLL_INTERVAL_MS); });

    expect(mockRefreshVaultGitRemoteStatus).not.toHaveBeenCalled();
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
    mockRefreshVaultGitRemoteStatus.mockResolvedValue(cleanResult);
    const {unmount} = renderPolling();

    await act(async () => { vi.advanceTimersByTime(REMOTE_POLL_INTERVAL_MS); });
    expect(mockRefreshVaultGitRemoteStatus).toHaveBeenCalledTimes(1);

    unmount();
    mockRefreshVaultGitRemoteStatus.mockClear();

    await act(async () => { vi.advanceTimersByTime(REMOTE_POLL_INTERVAL_MS * 3); });

    expect(mockRefreshVaultGitRemoteStatus).not.toHaveBeenCalled();
  });

  it('calls onRefreshed with the result when a poll succeeds', async () => {
    vi.useFakeTimers();
    mockRefreshVaultGitRemoteStatus.mockResolvedValue(cleanResult);
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

    // Advance the interval, then flush promise microtasks with a real-tick flush.
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

    await act(async () => { vi.advanceTimersByTime(REMOTE_POLL_INTERVAL_MS); });
    await act(async () => { await Promise.resolve(); });

    expect(onRefreshed).not.toHaveBeenCalled();
  });

  it('does not trigger refresh when visibilitychange fires while hidden', async () => {
    stubDocumentHidden(true);
    mockRefreshVaultGitRemoteStatus.mockResolvedValue(cleanResult);
    renderPolling();

    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    await act(async () => { await Promise.resolve(); });

    expect(mockRefreshVaultGitRemoteStatus).not.toHaveBeenCalled();
  });

  it('triggers one refresh when window becomes visible', async () => {
    stubDocumentHidden(false);
    mockRefreshVaultGitRemoteStatus.mockResolvedValue(cleanResult);
    renderPolling();

    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });

    expect(mockRefreshVaultGitRemoteStatus).toHaveBeenCalledTimes(1);
  });

  it('removes visibility listener on unmount', async () => {
    stubDocumentHidden(false);
    mockRefreshVaultGitRemoteStatus.mockResolvedValue(cleanResult);
    const {unmount} = renderPolling();

    unmount();
    mockRefreshVaultGitRemoteStatus.mockClear();

    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    await act(async () => { await Promise.resolve(); });

    expect(mockRefreshVaultGitRemoteStatus).not.toHaveBeenCalled();
  });
});

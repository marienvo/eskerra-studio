import {act, renderHook, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const {
  mockGetVaultGitStatus,
  mockUseGitSyncTransientStatus,
  mockUseManualVaultGitSync,
  mockUseVaultGitAutosyncScheduler,
  mockUseVaultGitCurrentBranch,
  mockUseVaultGitLocalWriteStatusRefresh,
  mockUseVaultGitRemoteStatusPolling,
  mockUseVaultGitStartupSync,
  mockUseVaultGitStatus,
  mockUseAppOsCloseSync,
} = vi.hoisted(() => ({
  mockGetVaultGitStatus: vi.fn(),
  mockUseGitSyncTransientStatus: vi.fn(),
  mockUseManualVaultGitSync: vi.fn(),
  mockUseVaultGitAutosyncScheduler: vi.fn(),
  mockUseVaultGitCurrentBranch: vi.fn(),
  mockUseVaultGitLocalWriteStatusRefresh: vi.fn(),
  mockUseVaultGitRemoteStatusPolling: vi.fn(),
  mockUseVaultGitStartupSync: vi.fn(),
  mockUseVaultGitStatus: vi.fn(),
  mockUseAppOsCloseSync: vi.fn(),
}));

vi.mock('../lib/tauriVaultGitSync', () => ({
  getVaultGitStatus: mockGetVaultGitStatus,
}));

vi.mock('../hooks/useGitSyncTransientStatus', () => ({
  useGitSyncTransientStatus: mockUseGitSyncTransientStatus,
}));

vi.mock('../hooks/useManualVaultGitSync', () => ({
  useManualVaultGitSync: mockUseManualVaultGitSync,
}));

vi.mock('../hooks/useVaultGitAutosyncScheduler', () => ({
  useVaultGitAutosyncScheduler: mockUseVaultGitAutosyncScheduler,
}));

vi.mock('../hooks/useVaultGitCurrentBranch', () => ({
  useVaultGitCurrentBranch: mockUseVaultGitCurrentBranch,
}));

vi.mock('../hooks/useVaultGitLocalWriteStatusRefresh', () => ({
  useVaultGitLocalWriteStatusRefresh: mockUseVaultGitLocalWriteStatusRefresh,
}));

vi.mock('../hooks/useVaultGitRemoteStatusPolling', () => ({
  useVaultGitRemoteStatusPolling: mockUseVaultGitRemoteStatusPolling,
}));

vi.mock('../hooks/useVaultGitStartupSync', () => ({
  useVaultGitStartupSync: mockUseVaultGitStartupSync,
}));

vi.mock('../hooks/useVaultGitStatus', () => ({
  useVaultGitStatus: mockUseVaultGitStatus,
}));

vi.mock('./useAppOsCloseSync', () => ({
  useAppOsCloseSync: mockUseAppOsCloseSync,
}));

import type {MutableRefObject} from 'react';
import type {useDesktopPodcastPlayback} from '../hooks/useDesktopPodcastPlayback';
import type {GitStatusResult} from '../lib/tauriVaultGitSync';
import {useAppGitSyncOrchestration} from './useAppGitSyncOrchestration';

function cleanStatus(): GitStatusResult {
  return {
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
}

function localChangesStatus(): GitStatusResult {
  return {...cleanStatus(), hasUncommittedChanges: true};
}

function desktopPlaybackRef(): MutableRefObject<ReturnType<typeof useDesktopPodcastPlayback>> {
  return {
    current: {
      pauseIfPlaying: vi.fn().mockResolvedValue(undefined),
      waitForPersistFlushed: vi.fn().mockResolvedValue(undefined),
    },
  } as unknown as MutableRefObject<ReturnType<typeof useDesktopPodcastPlayback>>;
}

function renderOrchestration(
  overrides: Partial<Parameters<typeof useAppGitSyncOrchestration>[0]> = {},
) {
  const props: Parameters<typeof useAppGitSyncOrchestration>[0] = {
    vaultPath: '/vault',
    saveSettledNonce: 0,
    notify: vi.fn(),
    desktopPlaybackRef: desktopPlaybackRef(),
    flushInboxSave: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };

  return renderHook(nextProps => useAppGitSyncOrchestration(nextProps), {initialProps: props});
}

describe('useAppGitSyncOrchestration close handling', () => {
  let runManualSync: ReturnType<typeof vi.fn>;
  let programmaticClose: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    runManualSync = vi.fn().mockResolvedValue(true);
    programmaticClose = vi.fn();

    mockGetVaultGitStatus.mockReset();
    mockUseGitSyncTransientStatus.mockReturnValue({
      transient: null,
      show: vi.fn(),
      clear: vi.fn(),
    });
    mockUseManualVaultGitSync.mockReturnValue({
      running: false,
      run: runManualSync,
      waitForCurrentRun: vi.fn().mockReturnValue(null),
    });
    mockUseVaultGitAutosyncScheduler.mockReturnValue({
      autosyncPending: false,
      nextAutosyncAtMs: Date.now() + 300_000,
    });
    mockUseVaultGitCurrentBranch.mockReturnValue({
      branch: 'main',
      detachedHead: false,
      loading: false,
      error: null,
      isNotGitRepository: false,
      refresh: vi.fn(),
    });
    mockUseVaultGitLocalWriteStatusRefresh.mockReturnValue(undefined);
    mockUseVaultGitRemoteStatusPolling.mockReturnValue({
      remoteRefreshLoading: false,
      initialRemoteStatusSettled: true,
    });
    mockUseVaultGitStartupSync.mockReturnValue(undefined);
    mockUseVaultGitStatus.mockReturnValue({
      status: cleanStatus(),
      loading: false,
      error: null,
      refresh: vi.fn(),
    });
    mockUseAppOsCloseSync.mockReturnValue({
      programmaticClose,
      closeSyncInProgress: false,
      markCloseSyncActive: vi.fn((fn: () => Promise<unknown>) => fn()),
    });
  });

  it('refreshes Git status silently after remote polling refreshes', () => {
    const refreshGitStatus = vi.fn();
    mockUseVaultGitStatus.mockReturnValue({
      status: cleanStatus(),
      loading: false,
      error: null,
      refresh: refreshGitStatus,
    });

    renderOrchestration();

    const pollingArgs = mockUseVaultGitRemoteStatusPolling.mock.calls[0][0];
    pollingArgs.onRefreshed?.(localChangesStatus());

    expect(refreshGitStatus).toHaveBeenCalledWith({silent: true});
  });

  it('flushes before the returned manual sync runner and forwards options', async () => {
    const order: string[] = [];
    const flushInboxSave = vi.fn(async () => {
      order.push('flush');
    });
    runManualSync.mockImplementation(async () => {
      order.push('sync');
      return true;
    });

    const {result} = renderOrchestration({flushInboxSave});

    await act(async () => {
      await result.current.manualGitSync.run({silent: true});
    });

    expect(order).toEqual(['flush', 'sync']);
    expect(runManualSync).toHaveBeenCalledWith({silent: true});
  });

  it('rejects concurrent manual sync calls while the pre-sync flush is in progress', async () => {
    let resolveFlush!: () => void;
    const flushInboxSave = vi.fn(
      () =>
        new Promise<void>(resolve => {
          resolveFlush = resolve;
        }),
    );
    runManualSync.mockResolvedValue(true);

    const {result} = renderOrchestration({flushInboxSave});

    let firstResult!: boolean;
    let secondResult!: boolean;
    await act(async () => {
      const first = result.current.manualGitSync.run();
      const second = result.current.manualGitSync.run();
      secondResult = await second;
      resolveFlush();
      firstResult = await first;
    });

    expect(secondResult).toBe(false);
    expect(firstResult).toBe(true);
    expect(flushInboxSave).toHaveBeenCalledTimes(1);
    expect(runManualSync).toHaveBeenCalledTimes(1);
  });

  it('still runs manual sync when the pre-sync flush rejects', async () => {
    const flushInboxSave = vi.fn().mockRejectedValue(new Error('flush failed'));

    const {result} = renderOrchestration({flushInboxSave});

    await act(async () => {
      await result.current.manualGitSync.run();
    });

    expect(flushInboxSave).toHaveBeenCalledTimes(1);
    expect(runManualSync).toHaveBeenCalledTimes(1);
  });

  it('passes the flush-before-sync runner to startup sync and autosync', async () => {
    const order: string[] = [];
    const flushInboxSave = vi.fn(async () => {
      order.push('flush');
    });
    runManualSync.mockImplementation(async () => {
      order.push('sync');
      return true;
    });

    renderOrchestration({flushInboxSave});

    const startupRun = mockUseVaultGitStartupSync.mock.calls[0][0].runManualSync;
    const autosyncRun = mockUseVaultGitAutosyncScheduler.mock.calls[0][0].runManualSync;

    await act(async () => {
      await startupRun({silent: true});
    });
    expect(order).toEqual(['flush', 'sync']);

    order.length = 0;
    await act(async () => {
      await autosyncRun({silent: true});
    });
    expect(order).toEqual(['flush', 'sync']);
  });

  it('passes saveSettledNonce to startup sync so recent app writes do not startup-sync immediately', () => {
    renderOrchestration({saveSettledNonce: 3});

    expect(mockUseVaultGitStartupSync.mock.calls[0][0].localWriteNonce).toBe(3);
  });

  it('passes initialRemoteStatusSettled from remote polling to startup sync', () => {
    mockUseVaultGitRemoteStatusPolling.mockReturnValue({
      remoteRefreshLoading: true,
      initialRemoteStatusSettled: false,
    });
    renderOrchestration();

    expect(mockUseVaultGitStartupSync.mock.calls[0][0].initialRemoteStatusSettled).toBe(false);
  });

  it('flushes and uses fresh status before title-bar close preflight', async () => {
    const order: string[] = [];
    const flushInboxSave = vi.fn(async () => {
      order.push('flush');
    });
    mockGetVaultGitStatus.mockImplementation(async () => {
      order.push('fresh-status');
      return localChangesStatus();
    });
    runManualSync.mockImplementation(async () => {
      order.push('sync');
      return true;
    });

    const {result} = renderOrchestration({flushInboxSave});

    act(() => {
      result.current.handleWindowCloseRequest({instant: false});
    });

    await waitFor(() => expect(runManualSync).toHaveBeenCalledTimes(1));
    expect(order).toEqual(['flush', 'fresh-status', 'sync']);
    expect(flushInboxSave).toHaveBeenCalledTimes(1);
    expect(programmaticClose).toHaveBeenCalledTimes(1);
  });

  it('wraps non-instant title-bar close in markCloseSyncActive so overlay is driven', async () => {
    const order: string[] = [];
    let resolveMark!: () => void;
    const markCloseSyncActive = vi.fn((fn: () => Promise<unknown>) => {
      order.push('mark-start');
      return fn().then(result => {
        order.push('mark-end');
        return result;
      });
    });
    const markDeferred = new Promise<void>(resolve => { resolveMark = resolve; });
    runManualSync.mockImplementation(async () => {
      order.push('sync');
      resolveMark();
      return true;
    });
    mockUseAppOsCloseSync.mockReturnValue({
      programmaticClose,
      closeSyncInProgress: false,
      markCloseSyncActive,
    });

    const {result} = renderOrchestration();

    act(() => {
      result.current.handleWindowCloseRequest({instant: false});
    });

    await markDeferred;
    await waitFor(() => expect(order).toContain('mark-end'));

    expect(order).toEqual(['mark-start', 'sync', 'mark-end']);
    expect(markCloseSyncActive).toHaveBeenCalledTimes(1);
  });

  it('does not flush or fetch fresh status for instant title-bar close', async () => {
    const flushInboxSave = vi.fn().mockResolvedValue(undefined);
    mockGetVaultGitStatus.mockResolvedValue(localChangesStatus());

    const {result} = renderOrchestration({flushInboxSave});

    act(() => {
      result.current.handleWindowCloseRequest({instant: true});
    });

    await waitFor(() => expect(programmaticClose).toHaveBeenCalledTimes(1));
    expect(flushInboxSave).not.toHaveBeenCalled();
    expect(mockGetVaultGitStatus).not.toHaveBeenCalled();
    expect(runManualSync).not.toHaveBeenCalled();
  });
});

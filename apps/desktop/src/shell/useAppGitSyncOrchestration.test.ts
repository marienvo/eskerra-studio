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
    });
    mockUseVaultGitAutosyncScheduler.mockReturnValue(undefined);
    mockUseVaultGitCurrentBranch.mockReturnValue({
      branch: 'main',
      detachedHead: false,
      loading: false,
      error: null,
      isNotGitRepository: false,
      refresh: vi.fn(),
    });
    mockUseVaultGitLocalWriteStatusRefresh.mockReturnValue(undefined);
    mockUseVaultGitRemoteStatusPolling.mockReturnValue(undefined);
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
    });
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
    expect(programmaticClose).toHaveBeenCalledTimes(1);
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

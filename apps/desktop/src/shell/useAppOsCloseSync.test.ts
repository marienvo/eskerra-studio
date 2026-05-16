import {act, renderHook, waitFor} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const {
  mockIsTauri,
  mockGetCurrentWindow,
  mockSaveWindowState,
} = vi.hoisted(() => ({
  mockIsTauri: vi.fn(),
  mockGetCurrentWindow: vi.fn(),
  mockSaveWindowState: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: mockIsTauri,
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: mockGetCurrentWindow,
}));

vi.mock('@tauri-apps/plugin-window-state', () => ({
  saveWindowState: mockSaveWindowState,
  StateFlags: {ALL: 'ALL'},
}));

import type {MutableRefObject} from 'react';
import type {useDesktopPodcastPlayback} from '../hooks/useDesktopPodcastPlayback';
import type {GitStatusResult} from '../lib/tauriVaultGitSync';
import {useAppOsCloseSync} from './useAppOsCloseSync';

type CloseHandler = (event: {preventDefault: () => void}) => Promise<void>;

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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => {
    resolve = res;
  });
  return {promise, resolve};
}

function desktopPlaybackRef(): MutableRefObject<ReturnType<typeof useDesktopPodcastPlayback>> {
  return {
    current: {
      pauseIfPlaying: vi.fn().mockResolvedValue(undefined),
      waitForPersistFlushed: vi.fn().mockResolvedValue(undefined),
    },
  } as unknown as MutableRefObject<ReturnType<typeof useDesktopPodcastPlayback>>;
}

function renderOsCloseSync(
  overrides: Partial<Parameters<typeof useAppOsCloseSync>[0]> = {},
) {
  const props: Parameters<typeof useAppOsCloseSync>[0] = {
    desktopPlaybackRef: desktopPlaybackRef(),
    flushInboxSave: vi.fn().mockResolvedValue(undefined),
    manualSyncRequired: true,
    manualSyncDisabledReason: null,
    manualSyncRunning: false,
    runManualSync: vi.fn().mockResolvedValue(true),
    notify: vi.fn(),
    gitStatus: localChangesStatus(),
    // Keep indicator delay at 0 in tests so closeSyncInProgress flips synchronously
    closeSyncIndicatorDelayMs: 0,
    ...overrides,
  };

  return renderHook(nextProps => useAppOsCloseSync(nextProps), {initialProps: props});
}

describe('useAppOsCloseSync', () => {
  let closeHandler: CloseHandler | null;
  let mockClose: ReturnType<typeof vi.fn>;
  let mockDestroy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    closeHandler = null;
    mockClose = vi.fn().mockResolvedValue(undefined);
    mockDestroy = vi.fn();
    mockIsTauri.mockReturnValue(true);
    mockSaveWindowState.mockResolvedValue(undefined);
    mockGetCurrentWindow.mockReturnValue({
      close: mockClose,
      destroy: mockDestroy,
      onCloseRequested: vi.fn((handler: CloseHandler) => {
        closeHandler = handler;
        return Promise.resolve(vi.fn());
      }),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function triggerOsClose() {
    await waitFor(() => expect(closeHandler).not.toBeNull());
    const event = {preventDefault: vi.fn()};
    await act(async () => {
      await closeHandler!(event);
    });
    return event;
  }

  it('flushes pending edits before fetching fresh status and running close sync', async () => {
    const order: string[] = [];
    const flushInboxSave = vi.fn(async () => {
      order.push('flush');
    });
    const fetchFreshGitStatusForClose = vi.fn(async () => {
      order.push('fresh-status');
      return localChangesStatus();
    });
    const runManualSync = vi.fn(async () => {
      order.push('sync');
      return true;
    });

    renderOsCloseSync({
      flushInboxSave,
      fetchFreshGitStatusForClose,
      runManualSync,
      gitStatus: cleanStatus(),
    });

    await triggerOsClose();

    expect(order).toEqual(['flush', 'fresh-status', 'sync']);
    expect(runManualSync).toHaveBeenCalledTimes(1);
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it('uses fresh close status for preflight when cached status is clean', async () => {
    const runManualSync = vi.fn().mockResolvedValue(true);

    renderOsCloseSync({
      gitStatus: cleanStatus(),
      fetchFreshGitStatusForClose: vi.fn().mockResolvedValue(localChangesStatus()),
      runManualSync,
    });

    await triggerOsClose();

    expect(runManualSync).toHaveBeenCalledTimes(1);
  });

  it('falls back to cached status when fresh status fetch fails', async () => {
    const runManualSync = vi.fn().mockResolvedValue(true);

    renderOsCloseSync({
      gitStatus: localChangesStatus(),
      fetchFreshGitStatusForClose: vi.fn().mockRejectedValue(new Error('status failed')),
      runManualSync,
    });

    await triggerOsClose();

    expect(runManualSync).toHaveBeenCalledTimes(1);
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it('clears closeSyncInProgress immediately after timeout while sync remains pending', async () => {
    const runManualSync = vi.fn(() => new Promise<boolean>(() => {}));
    const notify = vi.fn();
    const {result} = renderOsCloseSync({
      runManualSync,
      notify,
      closeSyncTimeoutMs: 100,
    });

    await waitFor(() => expect(closeHandler).not.toBeNull());
    const event = {preventDefault: vi.fn()};
    const closePromise = closeHandler!(event);

    await waitFor(() => expect(result.current.closeSyncInProgress).toBe(true));
    await waitFor(() => expect(result.current.closeSyncInProgress).toBe(false));
    await closePromise;

    expect(runManualSync).toHaveBeenCalledTimes(1);
    expect(result.current.closeSyncInProgress).toBe(false);
    expect(mockClose).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(
      'error',
      'Sync before close timed out. Eskerra stayed open so you can retry or close instantly.',
    );
  });

  it('clears closeSyncInProgress on normal sync success', async () => {
    const sync = deferred<boolean>();
    const {result} = renderOsCloseSync({
      runManualSync: vi.fn(() => sync.promise),
    });

    await waitFor(() => expect(closeHandler).not.toBeNull());
    const closePromise = closeHandler!({preventDefault: vi.fn()});

    await waitFor(() => expect(result.current.closeSyncInProgress).toBe(true));

    await act(async () => {
      sync.resolve(true);
      await closePromise;
    });

    expect(result.current.closeSyncInProgress).toBe(false);
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it('never shows close sync progress when manual sync is not required', async () => {
    const runManualSync = vi.fn().mockResolvedValue(true);
    const {result} = renderOsCloseSync({
      manualSyncRequired: false,
      manualSyncDisabledReason: 'Git branch unavailable',
      runManualSync,
    });

    await triggerOsClose();

    expect(result.current.closeSyncInProgress).toBe(false);
    expect(runManualSync).not.toHaveBeenCalled();
    expect(mockClose).toHaveBeenCalledTimes(1);
  });
});

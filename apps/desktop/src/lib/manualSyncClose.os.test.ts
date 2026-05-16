import {afterEach, describe, expect, it, vi} from 'vitest';

import {handleOsCloseRequest} from './manualSyncClose';
import type {GitStatusResult} from './tauriVaultGitSync';

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

describe('handleOsCloseRequest', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('prevents close and runs sync when enabled', async () => {
    const runManualSync = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
    const close = vi.fn();
    const closeSyncInProgressRef = {current: false};

    await handleOsCloseRequest({
      manualSyncDisabledReason: null,
      manualSyncRunning: false,
      runManualSync,
      notify: vi.fn(),
      close,
      closeSyncInProgressRef,
    });

    expect(runManualSync).toHaveBeenCalledTimes(1);
  });

  it('does not notify when sync starts', async () => {
    const notify = vi.fn();
    const closeSyncInProgressRef = {current: false};

    await handleOsCloseRequest({
      manualSyncDisabledReason: null,
      manualSyncRunning: false,
      runManualSync: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
      notify,
      close: vi.fn(),
      closeSyncInProgressRef,
    });

    expect(notify).not.toHaveBeenCalledWith('info', expect.any(String));
  });

  it('calls close after successful sync', async () => {
    const close = vi.fn();
    const closeSyncInProgressRef = {current: false};

    await handleOsCloseRequest({
      manualSyncDisabledReason: null,
      manualSyncRunning: false,
      runManualSync: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
      notify: vi.fn(),
      close,
      closeSyncInProgressRef,
    });

    expect(close).toHaveBeenCalledTimes(1);
  });

  it('keeps app open when sync fails', async () => {
    const close = vi.fn();
    const notify = vi.fn();
    const closeSyncInProgressRef = {current: false};

    await handleOsCloseRequest({
      manualSyncDisabledReason: null,
      manualSyncRunning: false,
      runManualSync: vi.fn<() => Promise<boolean>>().mockResolvedValue(false),
      notify,
      close,
      closeSyncInProgressRef,
    });

    expect(close).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith('error', 'Sync before close failed. Eskerra stayed open.');
  });

  it('times out and notifies the user; does not close', async () => {
    vi.useFakeTimers();
    const close = vi.fn();
    const notify = vi.fn();
    const closeSyncInProgressRef = {current: false};

    const p = handleOsCloseRequest({
      manualSyncDisabledReason: null,
      manualSyncRunning: false,
      runManualSync: () => new Promise(() => {}), // never resolves
      notify,
      close,
      closeSyncInProgressRef,
      timeoutMs: 5_000,
    });

    await vi.runAllTimersAsync();
    await p;

    expect(close).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(
      'error',
      'Sync before close timed out. Eskerra stayed open so you can retry or close instantly.',
    );
  });

  it('clears closeSyncInProgressRef after timeout', async () => {
    vi.useFakeTimers();
    const closeSyncInProgressRef = {current: false};

    const p = handleOsCloseRequest({
      manualSyncDisabledReason: null,
      manualSyncRunning: false,
      runManualSync: () => new Promise(() => {}),
      notify: vi.fn(),
      close: vi.fn(),
      closeSyncInProgressRef,
      timeoutMs: 5_000,
    });

    await vi.runAllTimersAsync();
    await p;

    expect(closeSyncInProgressRef.current).toBe(false);
  });

  it('ignores repeated close attempts while close-sync is in progress', async () => {
    const runManualSync = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
    const notify = vi.fn();
    const closeSyncInProgressRef = {current: true}; // already in progress

    await handleOsCloseRequest({
      manualSyncDisabledReason: null,
      manualSyncRunning: false,
      runManualSync,
      notify,
      close: vi.fn(),
      closeSyncInProgressRef,
    });

    expect(runManualSync).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('notifies when sync is disabled and does not start sync', async () => {
    const runManualSync = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
    const close = vi.fn();
    const notify = vi.fn();
    const closeSyncInProgressRef = {current: false};

    await handleOsCloseRequest({
      manualSyncDisabledReason: 'Git branch unavailable',
      manualSyncRunning: false,
      runManualSync,
      notify,
      close,
      closeSyncInProgressRef,
    });

    expect(runManualSync).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(
      'error',
      'Cannot sync before closing: Git branch unavailable. Use the close button while holding Shift to close instantly.',
    );
  });

  it('closes without sync or notify when manual sync is not required', async () => {
    const runManualSync = vi.fn<() => Promise<boolean>>().mockResolvedValue(false);
    const close = vi.fn();
    const notify = vi.fn();
    const closeSyncInProgressRef = {current: false};

    await handleOsCloseRequest({
      manualSyncRequired: false,
      manualSyncDisabledReason: null,
      manualSyncRunning: false,
      runManualSync,
      notify,
      close,
      closeSyncInProgressRef,
    });

    expect(runManualSync).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
    expect(notify).not.toHaveBeenCalled();
  });

  it('closes without notifying when manual sync is not required even if sync is disabled', async () => {
    const runManualSync = vi.fn<() => Promise<boolean>>().mockResolvedValue(false);
    const close = vi.fn();
    const notify = vi.fn();
    const closeSyncInProgressRef = {current: false};

    await handleOsCloseRequest({
      manualSyncRequired: false,
      manualSyncDisabledReason: 'Git branch unavailable',
      manualSyncRunning: false,
      runManualSync,
      notify,
      close,
      closeSyncInProgressRef,
    });

    expect(runManualSync).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
    expect(notify).not.toHaveBeenCalled();
  });

  it('keeps app open and does not start a second sync when manual sync is already running and no waitForCurrentRun provided', async () => {
    const runManualSync = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
    const close = vi.fn();
    const notify = vi.fn();
    const closeSyncInProgressRef = {current: false};

    await handleOsCloseRequest({
      manualSyncDisabledReason: null,
      manualSyncRunning: true,
      runManualSync,
      notify,
      close,
      closeSyncInProgressRef,
    });

    expect(runManualSync).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('awaits in-flight sync via waitForCurrentRun and closes on success', async () => {
    const runManualSync = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
    const close = vi.fn();
    const notify = vi.fn();
    const closeSyncInProgressRef = {current: false};
    let resolveInflight!: (value: boolean) => void;
    const inflight = new Promise<boolean>(r => { resolveInflight = r; });

    const p = handleOsCloseRequest({
      manualSyncDisabledReason: null,
      manualSyncRunning: true,
      runManualSync,
      notify,
      close,
      closeSyncInProgressRef,
      waitForCurrentRun: () => inflight,
    });

    resolveInflight(true);
    await p;

    expect(runManualSync).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
    expect(notify).not.toHaveBeenCalled();
    expect(closeSyncInProgressRef.current).toBe(false);
  });

  it('stays open and notifies when in-flight sync fails', async () => {
    const runManualSync = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
    const close = vi.fn();
    const notify = vi.fn();
    const closeSyncInProgressRef = {current: false};
    let resolveInflight!: (value: boolean) => void;
    const inflight = new Promise<boolean>(r => { resolveInflight = r; });

    const p = handleOsCloseRequest({
      manualSyncDisabledReason: null,
      manualSyncRunning: true,
      runManualSync,
      notify,
      close,
      closeSyncInProgressRef,
      waitForCurrentRun: () => inflight,
    });

    resolveInflight(false);
    await p;

    expect(runManualSync).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith('error', 'Sync before close failed. Eskerra stayed open.');
    expect(closeSyncInProgressRef.current).toBe(false);
  });

  it('clears closeSyncInProgressRef after sync completes', async () => {
    const closeSyncInProgressRef = {current: false};

    await handleOsCloseRequest({
      manualSyncDisabledReason: null,
      manualSyncRunning: false,
      runManualSync: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
      notify: vi.fn(),
      close: vi.fn(),
      closeSyncInProgressRef,
    });

    expect(closeSyncInProgressRef.current).toBe(false);
  });

  describe('preflight', () => {
    it('closes immediately without running sync when status is clean', async () => {
      const runManualSync = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
      const close = vi.fn();
      const notify = vi.fn();
      const closeSyncInProgressRef = {current: false};

      await handleOsCloseRequest({
        manualSyncDisabledReason: null,
        manualSyncRunning: false,
        runManualSync,
        notify,
        close,
        closeSyncInProgressRef,
        gitStatus: cleanStatus(),
      });

      expect(runManualSync).not.toHaveBeenCalled();
      expect(close).toHaveBeenCalledTimes(1);
      expect(notify).not.toHaveBeenCalled();
    });

    it('runs sync when local changes are present', async () => {
      const runManualSync = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
      const close = vi.fn();
      const closeSyncInProgressRef = {current: false};

      await handleOsCloseRequest({
        manualSyncDisabledReason: null,
        manualSyncRunning: false,
        runManualSync,
        notify: vi.fn(),
        close,
        closeSyncInProgressRef,
        gitStatus: localChangesStatus(),
      });

      expect(runManualSync).toHaveBeenCalledTimes(1);
      expect(close).toHaveBeenCalledTimes(1);
    });
  });
});

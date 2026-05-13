import {afterEach, describe, expect, it, vi} from 'vitest';

import {handleManualSyncCloseRequest, handleOsCloseRequest} from './manualSyncClose';

describe('handleManualSyncCloseRequest', () => {
  it('closes immediately with Shift bypass and does not run sync', async () => {
    const runManualSync = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
    const close = vi.fn();
    const notify = vi.fn();

    await handleManualSyncCloseRequest({
      instant: true,
      manualSyncDisabledReason: null,
      manualSyncRunning: false,
      runManualSync,
      close,
      notify,
    });

    expect(close).toHaveBeenCalledTimes(1);
    expect(runManualSync).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('runs sync first and closes after success', async () => {
    const runManualSync = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
    const close = vi.fn();

    await handleManualSyncCloseRequest({
      instant: false,
      manualSyncDisabledReason: null,
      manualSyncRunning: false,
      runManualSync,
      close,
      notify: vi.fn(),
    });

    expect(runManualSync).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('does not close when sync fails', async () => {
    const runManualSync = vi.fn<() => Promise<boolean>>().mockResolvedValue(false);
    const close = vi.fn();

    await handleManualSyncCloseRequest({
      instant: false,
      manualSyncDisabledReason: null,
      manualSyncRunning: false,
      runManualSync,
      close,
      notify: vi.fn(),
    });

    expect(runManualSync).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
  });

  it('does not run sync or close when manual sync is disabled', async () => {
    const runManualSync = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
    const close = vi.fn();
    const notify = vi.fn();

    await handleManualSyncCloseRequest({
      instant: false,
      manualSyncDisabledReason: 'Git branch unavailable',
      manualSyncRunning: false,
      runManualSync,
      close,
      notify,
    });

    expect(runManualSync).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(
      'error',
      'Cannot sync before closing: Git branch unavailable. Hold Shift and click close to close instantly.',
    );
  });

  it('can suppress repeated disabled close notifications', async () => {
    const notify = vi.fn();

    await handleManualSyncCloseRequest({
      instant: false,
      manualSyncDisabledReason: 'Git branch unavailable',
      manualSyncRunning: false,
      runManualSync: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
      close: vi.fn(),
      notify,
      notifyDisabled: false,
    });

    expect(notify).not.toHaveBeenCalled();
  });

  it('does not start another close sync while sync is running', async () => {
    const runManualSync = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
    const close = vi.fn();
    const notify = vi.fn();

    await handleManualSyncCloseRequest({
      instant: false,
      manualSyncDisabledReason: 'Syncing vault',
      manualSyncRunning: true,
      runManualSync,
      close,
      notify,
    });

    expect(runManualSync).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  describe('showCloseSyncFeedback', () => {
    it('does not notify before sync starts', async () => {
      const notify = vi.fn();
      await handleManualSyncCloseRequest({
        instant: false,
        manualSyncDisabledReason: null,
        manualSyncRunning: false,
        runManualSync: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
        close: vi.fn(),
        notify,
        showCloseSyncFeedback: true,
      });

      expect(notify).not.toHaveBeenCalledWith('info', expect.any(String));
    });

    it('does not notify start when showCloseSyncFeedback is false', async () => {
      const notify = vi.fn();
      await handleManualSyncCloseRequest({
        instant: false,
        manualSyncDisabledReason: null,
        manualSyncRunning: false,
        runManualSync: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
        close: vi.fn(),
        notify,
        showCloseSyncFeedback: false,
      });

      expect(notify).not.toHaveBeenCalled();
    });

    it('notifies "Sync before close failed" when sync fails with showCloseSyncFeedback', async () => {
      const notify = vi.fn();
      await handleManualSyncCloseRequest({
        instant: false,
        manualSyncDisabledReason: null,
        manualSyncRunning: false,
        runManualSync: vi.fn<() => Promise<boolean>>().mockResolvedValue(false),
        close: vi.fn(),
        notify,
        showCloseSyncFeedback: true,
      });

      expect(notify).toHaveBeenCalledWith('error', 'Sync before close failed. Eskerra stayed open.');
    });

    it('does not notify failure when showCloseSyncFeedback is false', async () => {
      const notify = vi.fn();
      await handleManualSyncCloseRequest({
        instant: false,
        manualSyncDisabledReason: null,
        manualSyncRunning: false,
        runManualSync: vi.fn<() => Promise<boolean>>().mockResolvedValue(false),
        close: vi.fn(),
        notify,
        showCloseSyncFeedback: false,
      });

      expect(notify).not.toHaveBeenCalled();
    });

    it('does not show start notification on instant close even with showCloseSyncFeedback', async () => {
      const notify = vi.fn();
      await handleManualSyncCloseRequest({
        instant: true,
        manualSyncDisabledReason: null,
        manualSyncRunning: false,
        runManualSync: vi.fn(),
        close: vi.fn(),
        notify,
        showCloseSyncFeedback: true,
      });

      expect(notify).not.toHaveBeenCalled();
    });
  });
});

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

  it('keeps app open and does not start a second sync when manual sync is already running', async () => {
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
});

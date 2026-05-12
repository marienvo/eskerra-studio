import {describe, expect, it, vi} from 'vitest';

import {handleManualSyncCloseRequest} from './manualSyncClose';

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
});

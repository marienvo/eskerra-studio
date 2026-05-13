import {describe, expect, it, vi} from 'vitest';

import {
  buildCloseSyncRunner,
  handleManualSyncCloseRequest,
} from './manualSyncClose';
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

describe('buildCloseSyncRunner', () => {
  it('runs manual sync silently for close flows', async () => {
    const runManualSync = vi.fn<(opts?: {readonly silent?: boolean}) => Promise<boolean>>()
      .mockResolvedValue(false);
    const runManualSyncForClose = buildCloseSyncRunner(runManualSync);

    await expect(runManualSyncForClose()).resolves.toBe(false);

    expect(runManualSync).toHaveBeenCalledTimes(1);
    expect(runManualSync).toHaveBeenCalledWith({silent: true});
  });
});

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

  describe('preflight', () => {
    it('closes immediately without running sync when status is clean', async () => {
      const runManualSync = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
      const close = vi.fn();
      const notify = vi.fn();

      await handleManualSyncCloseRequest({
        instant: false,
        manualSyncDisabledReason: null,
        manualSyncRunning: false,
        runManualSync,
        close,
        notify,
        gitStatus: cleanStatus(),
      });

      expect(close).toHaveBeenCalledTimes(1);
      expect(runManualSync).not.toHaveBeenCalled();
      expect(notify).not.toHaveBeenCalled();
    });

    it('runs sync and shows overlay path when local changes are present', async () => {
      const runManualSync = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
      const close = vi.fn();

      await handleManualSyncCloseRequest({
        instant: false,
        manualSyncDisabledReason: null,
        manualSyncRunning: false,
        runManualSync,
        close,
        notify: vi.fn(),
        gitStatus: localChangesStatus(),
      });

      expect(runManualSync).toHaveBeenCalledTimes(1);
      expect(close).toHaveBeenCalledTimes(1);
    });
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

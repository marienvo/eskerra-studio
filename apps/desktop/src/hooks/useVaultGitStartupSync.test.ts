import {act, renderHook} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';

import {useVaultGitStartupSync} from './useVaultGitStartupSync';
import type {GitStatusResult} from '../lib/tauriVaultGitSync';

type HookArgs = Parameters<typeof useVaultGitStartupSync>[0];

const VAULT = '/home/user/vault';

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

function ready(overrides: Partial<HookArgs> = {}): HookArgs {
  return {
    vaultPath: VAULT,
    gitStatusLoading: false,
    gitStatusError: null,
    manualSyncDisabledReason: null,
    manualSyncRunning: false,
    runManualSync: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
    notify: vi.fn(),
    ...overrides,
  };
}

function render(args: HookArgs) {
  return renderHook((props: HookArgs) => useVaultGitStartupSync(props), {initialProps: args});
}

describe('useVaultGitStartupSync', () => {
  it('does not run when vaultPath is null', async () => {
    const runManualSync = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
    render(ready({vaultPath: null, runManualSync}));

    await act(async () => { await Promise.resolve(); });

    expect(runManualSync).not.toHaveBeenCalled();
  });

  it('does not run while gitStatusLoading is true', async () => {
    const runManualSync = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
    render(ready({gitStatusLoading: true, runManualSync}));

    await act(async () => { await Promise.resolve(); });

    expect(runManualSync).not.toHaveBeenCalled();
  });

  it('does not run when gitStatusError is set', async () => {
    const runManualSync = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
    render(ready({gitStatusError: 'Not a Git repository', runManualSync}));

    await act(async () => { await Promise.resolve(); });

    expect(runManualSync).not.toHaveBeenCalled();
  });

  it('does not run when manualSyncDisabledReason is set', async () => {
    const runManualSync = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
    render(ready({manualSyncDisabledReason: 'Wrong Git branch', runManualSync}));

    await act(async () => { await Promise.resolve(); });

    expect(runManualSync).not.toHaveBeenCalled();
  });

  it('does not run while manual sync is already running', async () => {
    const runManualSync = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
    render(ready({manualSyncRunning: true, runManualSync}));

    await act(async () => { await Promise.resolve(); });

    expect(runManualSync).not.toHaveBeenCalled();
  });

  it('runs once when all gates are ready', async () => {
    const runManualSync = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
    render(ready({runManualSync}));

    await act(async () => { await Promise.resolve(); });

    expect(runManualSync).toHaveBeenCalledTimes(1);
  });

  it('runs when gates become ready after an initial loading state', async () => {
    const runManualSync = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
    const notify = vi.fn();
    const {rerender} = render(ready({gitStatusLoading: true, runManualSync, notify}));

    await act(async () => { await Promise.resolve(); });
    expect(runManualSync).not.toHaveBeenCalled();

    rerender(ready({gitStatusLoading: false, runManualSync, notify}));
    await act(async () => { await Promise.resolve(); });

    expect(runManualSync).toHaveBeenCalledTimes(1);
  });

  it('does not run a second time on rerender with the same vault', async () => {
    const runManualSync = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
    const {rerender} = render(ready({runManualSync}));

    await act(async () => { await Promise.resolve(); });
    rerender(ready({runManualSync}));
    await act(async () => { await Promise.resolve(); });

    expect(runManualSync).toHaveBeenCalledTimes(1);
  });

  it('does not retry after a failed startup sync', async () => {
    const runManualSync = vi.fn<() => Promise<boolean>>().mockResolvedValue(false);
    const {rerender} = render(ready({runManualSync}));

    await act(async () => { await Promise.resolve(); });
    expect(runManualSync).toHaveBeenCalledTimes(1);

    rerender(ready({runManualSync}));
    await act(async () => { await Promise.resolve(); });

    expect(runManualSync).toHaveBeenCalledTimes(1);
  });

  it('shows failure notification when sync returns false', async () => {
    const runManualSync = vi.fn<() => Promise<boolean>>().mockResolvedValue(false);
    const notify = vi.fn();
    render(ready({runManualSync, notify}));

    await act(async () => { await Promise.resolve(); });

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith('error', 'Startup sync failed. You can retry manually.');
  });

  it('does not show failure notification when sync succeeds', async () => {
    const runManualSync = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
    const notify = vi.fn();
    render(ready({runManualSync, notify}));

    await act(async () => { await Promise.resolve(); });

    expect(notify).not.toHaveBeenCalled();
  });

  it('allows one startup sync for a new vault path', async () => {
    const runManualSync = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
    const notify = vi.fn();
    const {rerender} = render(ready({runManualSync, notify}));

    await act(async () => { await Promise.resolve(); });
    expect(runManualSync).toHaveBeenCalledTimes(1);

    rerender(ready({vaultPath: '/other-vault', runManualSync, notify}));
    await act(async () => { await Promise.resolve(); });

    expect(runManualSync).toHaveBeenCalledTimes(2);
  });

  it('does not trigger a second sync for the original vault after switching back', async () => {
    const runManualSync = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
    const notify = vi.fn();
    const {rerender} = render(ready({runManualSync, notify}));

    await act(async () => { await Promise.resolve(); });
    expect(runManualSync).toHaveBeenCalledTimes(1);

    rerender(ready({vaultPath: '/other-vault', runManualSync, notify}));
    await act(async () => { await Promise.resolve(); });
    expect(runManualSync).toHaveBeenCalledTimes(2);

    // Switch back to original vault — no third sync
    rerender(ready({vaultPath: VAULT, runManualSync, notify}));
    await act(async () => { await Promise.resolve(); });
    expect(runManualSync).toHaveBeenCalledTimes(2);
  });

  describe('preflight', () => {
    it('does not run sync when status is clean (nothing to do)', async () => {
      const runManualSync = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
      render(ready({runManualSync, gitStatus: cleanStatus()}));

      await act(async () => { await Promise.resolve(); });

      expect(runManualSync).not.toHaveBeenCalled();
    });

    it('runs sync when git status shows local changes', async () => {
      const runManualSync = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
      render(ready({runManualSync, gitStatus: localChangesStatus()}));

      await act(async () => { await Promise.resolve(); });

      expect(runManualSync).toHaveBeenCalledTimes(1);
    });
  });
});

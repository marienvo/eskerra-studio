import {act, renderHook} from '@testing-library/react';
import {afterEach, describe, expect, it, vi} from 'vitest';

import {useVaultGitAutosyncScheduler} from './useVaultGitAutosyncScheduler';
import type {GitStatusResult} from '../lib/tauriVaultGitSync';

type HookArgs = Parameters<typeof useVaultGitAutosyncScheduler>[0];

const VAULT = '/home/user/vault';
const INTERVAL_MS = 1000;

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

function errorStatus(): GitStatusResult {
  return {...cleanStatus(), unsafeState: 'merge' as const};
}

function ready(overrides: Partial<HookArgs> = {}): HookArgs {
  return {
    saveSettledNonce: 0,
    vaultPath: VAULT,
    gitStatusLoading: false,
    gitStatusError: null,
    gitStatusRevision: 0,
    manualSyncDisabledReason: null,
    manualSyncRunning: false,
    runManualSync: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
    intervalMs: INTERVAL_MS,
    retryDelayMs: INTERVAL_MS,
    minChangeAgeMs: 0,
    ...overrides,
  };
}

function render(args: HookArgs) {
  return renderHook(
    (props: HookArgs) => {
      const state = useVaultGitAutosyncScheduler(props);
      return {state, runManualSync: props.runManualSync};
    },
    {initialProps: args},
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => {
    resolve = res;
  });
  return {promise, resolve};
}

describe('useVaultGitAutosyncScheduler', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not run sync on mount', () => {
    vi.useFakeTimers();
    const runManualSync = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
    const {result} = render(ready({runManualSync}));

    expect(runManualSync).not.toHaveBeenCalled();
    expect(result.current.state.autosyncPending).toBe(false);
  });

  it('reports pending after a save and advances nextAutosyncAtMs on interval', async () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);
    const runManualSync = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
    const {result, rerender} = render(ready({runManualSync}));

    const initialNext = result.current.state.nextAutosyncAtMs;
    expect(initialNext).toBeGreaterThanOrEqual(now + INTERVAL_MS - 5);
    expect(initialNext).toBeLessThanOrEqual(now + INTERVAL_MS + 5);

    rerender(ready({saveSettledNonce: 1, runManualSync}));
    expect(result.current.state.autosyncPending).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(INTERVAL_MS);
    });

    expect(result.current.state.nextAutosyncAtMs).toBeGreaterThanOrEqual(now + INTERVAL_MS * 2 - 10);
    expect(runManualSync).toHaveBeenCalledTimes(1);
    expect(result.current.state.autosyncPending).toBe(false);
  });

  it('marks a save as pending without syncing immediately', () => {
    vi.useFakeTimers();
    const runManualSync = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
    const {rerender} = render(ready({runManualSync}));

    rerender(ready({saveSettledNonce: 1, runManualSync}));

    expect(runManualSync).not.toHaveBeenCalled();
  });

  it('runs one silent sync after the configured interval when a save is pending', async () => {
    vi.useFakeTimers();
    const runManualSync = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
    const {rerender} = render(ready({runManualSync}));

    rerender(ready({saveSettledNonce: 1, runManualSync}));
    await act(async () => { vi.advanceTimersByTime(INTERVAL_MS); });

    expect(runManualSync).toHaveBeenCalledTimes(1);
    expect(runManualSync).toHaveBeenCalledWith({silent: true});
  });

  it('coalesces multiple saves into one sync per interval', async () => {
    vi.useFakeTimers();
    const runManualSync = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
    const {rerender} = render(ready({runManualSync}));

    rerender(ready({saveSettledNonce: 1, runManualSync}));
    rerender(ready({saveSettledNonce: 2, runManualSync}));
    rerender(ready({saveSettledNonce: 3, runManualSync}));

    await act(async () => { vi.advanceTimersByTime(INTERVAL_MS); });
    await act(async () => { vi.advanceTimersByTime(INTERVAL_MS); });

    expect(runManualSync).toHaveBeenCalledTimes(1);
  });

  it('does not run when no save has been marked pending', async () => {
    vi.useFakeTimers();
    const runManualSync = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
    render(ready({runManualSync}));

    await act(async () => { vi.advanceTimersByTime(INTERVAL_MS * 3); });

    expect(runManualSync).not.toHaveBeenCalled();
  });

  it('does not run while sync gates are closed and keeps the save pending', async () => {
    vi.useFakeTimers();
    const runManualSync = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
    const {rerender} = render(ready({manualSyncDisabledReason: 'Unsafe Git state', runManualSync}));

    rerender(ready({saveSettledNonce: 1, manualSyncDisabledReason: 'Unsafe Git state', runManualSync}));
    await act(async () => { vi.advanceTimersByTime(INTERVAL_MS); });
    expect(runManualSync).not.toHaveBeenCalled();

    rerender(ready({saveSettledNonce: 1, runManualSync}));
    await act(async () => { vi.advanceTimersByTime(INTERVAL_MS); });

    expect(runManualSync).toHaveBeenCalledTimes(1);
  });

  it('skips while a remote status refresh is running and keeps the save pending', async () => {
    vi.useFakeTimers();
    const runManualSync = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
    const gitOperationBusyRef = {current: true};
    const {rerender} = render(ready({runManualSync, gitOperationBusyRef}));

    rerender(ready({saveSettledNonce: 1, runManualSync, gitOperationBusyRef}));
    await act(async () => { vi.advanceTimersByTime(INTERVAL_MS); });
    expect(runManualSync).not.toHaveBeenCalled();

    gitOperationBusyRef.current = false;
    rerender(ready({saveSettledNonce: 1, runManualSync, gitOperationBusyRef}));
    await act(async () => { vi.advanceTimersByTime(INTERVAL_MS); });

    expect(runManualSync).toHaveBeenCalledTimes(1);
  });

  it('uses a short retry instead of a full interval when a git operation is busy at the due time', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-20T12:00:00.000Z'));
    const runManualSync = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
    const gitOperationBusyRef = {current: true};
    const retryDelayMs = 25;
    const {result, rerender} = render(
      ready({runManualSync, gitOperationBusyRef, retryDelayMs}),
    );

    rerender(ready({saveSettledNonce: 1, runManualSync, gitOperationBusyRef, retryDelayMs}));
    await act(async () => { vi.advanceTimersByTime(INTERVAL_MS); });

    expect(runManualSync).not.toHaveBeenCalled();
    expect(result.current.state.autosyncPending).toBe(true);
    expect(result.current.state.nextAutosyncAtMs).toBe(Date.now() + retryDelayMs);

    gitOperationBusyRef.current = false;
    rerender(ready({saveSettledNonce: 1, runManualSync, gitOperationBusyRef, retryDelayMs}));
    await act(async () => { vi.advanceTimersByTime(retryDelayMs - 1); });
    expect(runManualSync).not.toHaveBeenCalled();

    await act(async () => { vi.advanceTimersByTime(1); });
    expect(runManualSync).toHaveBeenCalledTimes(1);
  });

  it('waits until the latest disk change is at least the configured age before syncing', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-20T12:00:00.000Z'));
    const runManualSync = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
    const minChangeAgeMs = 60_000;
    const {result, rerender} = render(
      ready({intervalMs: 5_000, minChangeAgeMs, runManualSync}),
    );

    await act(async () => { vi.advanceTimersByTime(4_500); });
    rerender(ready({saveSettledNonce: 1, intervalMs: 5_000, minChangeAgeMs, runManualSync}));

    expect(result.current.state.nextAutosyncAtMs).toBe(Date.now() + minChangeAgeMs);

    await act(async () => { vi.advanceTimersByTime(59_999); });
    expect(runManualSync).not.toHaveBeenCalled();

    await act(async () => { vi.advanceTimersByTime(1); });
    expect(runManualSync).toHaveBeenCalledTimes(1);
  });

  it('retries on the next interval when autosync returns false', async () => {
    vi.useFakeTimers();
    const runManualSync = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const {rerender} = render(ready({runManualSync}));

    rerender(ready({saveSettledNonce: 1, runManualSync}));
    await act(async () => { vi.advanceTimersByTime(INTERVAL_MS); });
    await act(async () => { vi.advanceTimersByTime(INTERVAL_MS); });

    expect(runManualSync).toHaveBeenCalledTimes(2);
  });

  it('does not overlap runs when a sync lasts longer than an interval', async () => {
    vi.useFakeTimers();
    const pending = deferred<boolean>();
    const runManualSync = vi.fn<() => Promise<boolean>>().mockReturnValue(pending.promise);
    const {rerender} = render(ready({runManualSync}));

    rerender(ready({saveSettledNonce: 1, runManualSync}));
    await act(async () => { vi.advanceTimersByTime(INTERVAL_MS); });
    await act(async () => { vi.advanceTimersByTime(INTERVAL_MS * 3); });

    expect(runManualSync).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending.resolve(true);
      await pending.promise;
    });
  });

  it('does not carry a pending save across vault path changes', async () => {
    vi.useFakeTimers();
    const runManualSync = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
    const {rerender} = render(ready({runManualSync}));

    rerender(ready({saveSettledNonce: 1, runManualSync}));
    rerender(ready({saveSettledNonce: 1, vaultPath: '/other-vault', runManualSync}));

    await act(async () => { vi.advanceTimersByTime(INTERVAL_MS); });

    expect(runManualSync).not.toHaveBeenCalled();
  });

  it('keeps a newer save pending when it happens during an autosync run', async () => {
    vi.useFakeTimers();
    const first = deferred<boolean>();
    const runManualSync = vi
      .fn<() => Promise<boolean>>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(true);
    const {rerender} = render(ready({runManualSync}));

    rerender(ready({saveSettledNonce: 1, runManualSync}));
    await act(async () => { vi.advanceTimersByTime(INTERVAL_MS); });
    rerender(ready({saveSettledNonce: 2, runManualSync}));

    await act(async () => {
      first.resolve(true);
      await first.promise;
    });
    await act(async () => { vi.advanceTimersByTime(INTERVAL_MS); });

    expect(runManualSync).toHaveBeenCalledTimes(2);
  });

  describe('preflight', () => {
    it('does not run sync AND clears pending when status is clean/synced after a fresh status revision', async () => {
      vi.useFakeTimers();
      const runManualSync = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
      const {rerender} = render(
        ready({runManualSync, gitStatus: cleanStatus(), gitStatusRevision: 1}),
      );

      rerender(
        ready({
          saveSettledNonce: 1,
          runManualSync,
          gitStatus: cleanStatus(),
          gitStatusRevision: 1,
        }),
      );
      await act(async () => { vi.advanceTimersByTime(INTERVAL_MS); });
      expect(runManualSync).not.toHaveBeenCalled();

      rerender(
        ready({
          saveSettledNonce: 1,
          runManualSync,
          gitStatus: cleanStatus(),
          gitStatusRevision: 2,
        }),
      );
      await act(async () => { vi.advanceTimersByTime(INTERVAL_MS); });
      expect(runManualSync).not.toHaveBeenCalled();

      await act(async () => { vi.advanceTimersByTime(INTERVAL_MS); });
      expect(runManualSync).not.toHaveBeenCalled();
    });

    it('does not clear pending on stale clean status before post-save status refresh', async () => {
      vi.useFakeTimers();
      const runManualSync = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
      const {result, rerender} = render(
        ready({runManualSync, gitStatus: cleanStatus(), gitStatusRevision: 1}),
      );

      rerender(
        ready({
          saveSettledNonce: 1,
          runManualSync,
          gitStatus: cleanStatus(),
          gitStatusRevision: 1,
        }),
      );
      expect(result.current.state.autosyncPending).toBe(true);

      await act(async () => { vi.advanceTimersByTime(INTERVAL_MS); });

      expect(runManualSync).not.toHaveBeenCalled();
      expect(result.current.state.autosyncPending).toBe(true);
    });

    it('runs autosync after a fresh dirty status revision following a pending save', async () => {
      vi.useFakeTimers();
      const runManualSync = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
      const dirty = {
        ...cleanStatus(),
        hasUncommittedChanges: true,
      };
      const {rerender} = render(
        ready({runManualSync, gitStatus: cleanStatus(), gitStatusRevision: 1}),
      );

      rerender(
        ready({
          saveSettledNonce: 1,
          runManualSync,
          gitStatus: cleanStatus(),
          gitStatusRevision: 1,
        }),
      );
      await act(async () => { vi.advanceTimersByTime(INTERVAL_MS); });
      expect(runManualSync).not.toHaveBeenCalled();

      rerender(
        ready({
          saveSettledNonce: 1,
          runManualSync,
          gitStatus: dirty,
          gitStatusRevision: 2,
        }),
      );
      await act(async () => { vi.advanceTimersByTime(INTERVAL_MS); });

      expect(runManualSync).toHaveBeenCalledTimes(1);
      expect(runManualSync).toHaveBeenCalledWith({silent: true});
    });

    it('does not run sync AND keeps pending when status is unknown (null)', async () => {
      vi.useFakeTimers();
      const runManualSync = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
      // gitStatus = null (unknown/loading)
      const {rerender} = render(ready({runManualSync, gitStatus: null}));

      rerender(ready({saveSettledNonce: 1, runManualSync, gitStatus: null}));
      await act(async () => { vi.advanceTimersByTime(INTERVAL_MS); });
      expect(runManualSync).not.toHaveBeenCalled();

      // When status becomes actionable (local changes), sync should run
      rerender(ready({saveSettledNonce: 1, runManualSync, gitStatus: {
        branch: 'main', expectedBranch: 'main',
        hasUncommittedChanges: true, hasStagedChanges: false, hasUntrackedFiles: false,
        ahead: 0, behind: 0, remoteRefAvailable: true, unsafeState: null, isWrongBranch: false,
      }}));
      await act(async () => { vi.advanceTimersByTime(INTERVAL_MS); });
      expect(runManualSync).toHaveBeenCalledTimes(1);
    });

    it('does not run sync AND keeps pending when status has error/unsafe state', async () => {
      vi.useFakeTimers();
      const runManualSync = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
      const {rerender} = render(ready({runManualSync, gitStatus: errorStatus()}));

      rerender(ready({saveSettledNonce: 1, runManualSync, gitStatus: errorStatus()}));
      await act(async () => { vi.advanceTimersByTime(INTERVAL_MS); });
      expect(runManualSync).not.toHaveBeenCalled();

      // Multiple intervals should not clear the pending either
      await act(async () => { vi.advanceTimersByTime(INTERVAL_MS * 3); });
      expect(runManualSync).not.toHaveBeenCalled();
    });
  });
});

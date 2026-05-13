import {act, renderHook} from '@testing-library/react';
import {afterEach, describe, expect, it, vi} from 'vitest';

import {useVaultGitAutosyncScheduler} from './useVaultGitAutosyncScheduler';

type HookArgs = Parameters<typeof useVaultGitAutosyncScheduler>[0];

const VAULT = '/home/user/vault';
const INTERVAL_MS = 1000;

function ready(overrides: Partial<HookArgs> = {}): HookArgs {
  return {
    saveSettledNonce: 0,
    vaultPath: VAULT,
    gitStatusLoading: false,
    gitStatusError: null,
    manualSyncDisabledReason: null,
    manualSyncRunning: false,
    runManualSync: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
    intervalMs: INTERVAL_MS,
    ...overrides,
  };
}

function render(args: HookArgs) {
  return renderHook((props: HookArgs) => useVaultGitAutosyncScheduler(props), {
    initialProps: args,
  });
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
    render(ready({runManualSync}));

    expect(runManualSync).not.toHaveBeenCalled();
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
});

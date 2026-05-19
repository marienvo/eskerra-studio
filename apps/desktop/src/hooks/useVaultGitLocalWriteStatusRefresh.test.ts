import {act, renderHook} from '@testing-library/react';
import {afterEach, describe, expect, it, vi} from 'vitest';

import {
  GIT_LOCAL_WRITE_REFRESH_DEBOUNCE_MS,
  useVaultGitLocalWriteStatusRefresh,
} from './useVaultGitLocalWriteStatusRefresh';

describe('useVaultGitLocalWriteStatusRefresh', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not refresh on mount before any write settles', () => {
    const refreshGitStatus = vi.fn();
    renderHook(() =>
      useVaultGitLocalWriteStatusRefresh({
        saveSettledNonce: 0,
        refreshGitStatus,
      }),
    );

    expect(refreshGitStatus).not.toHaveBeenCalled();
  });

  it('refreshes local Git status silently after the debounce when a normal note save settles', () => {
    vi.useFakeTimers();
    const refreshGitStatus = vi.fn();
    const runManualSync = vi.fn();
    const {rerender} = renderHook(
      ({saveSettledNonce}) =>
        useVaultGitLocalWriteStatusRefresh({
          saveSettledNonce,
          refreshGitStatus,
        }),
      {initialProps: {saveSettledNonce: 0}},
    );

    rerender({saveSettledNonce: 1});

    expect(refreshGitStatus).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(GIT_LOCAL_WRITE_REFRESH_DEBOUNCE_MS);
    });

    expect(refreshGitStatus).toHaveBeenCalledTimes(1);
    expect(refreshGitStatus).toHaveBeenCalledWith({silent: true});
    expect(runManualSync).not.toHaveBeenCalled();
  });

  it('coalesces rapid settled writes into one silent refresh', () => {
    vi.useFakeTimers();
    const refreshGitStatus = vi.fn();
    const {rerender} = renderHook(
      ({saveSettledNonce}) =>
        useVaultGitLocalWriteStatusRefresh({
          saveSettledNonce,
          refreshGitStatus,
        }),
      {initialProps: {saveSettledNonce: 0}},
    );

    rerender({saveSettledNonce: 1});
    act(() => {
      vi.advanceTimersByTime(GIT_LOCAL_WRITE_REFRESH_DEBOUNCE_MS - 1);
    });
    rerender({saveSettledNonce: 2});
    act(() => {
      vi.advanceTimersByTime(GIT_LOCAL_WRITE_REFRESH_DEBOUNCE_MS - 1);
    });
    rerender({saveSettledNonce: 3});

    act(() => {
      vi.advanceTimersByTime(GIT_LOCAL_WRITE_REFRESH_DEBOUNCE_MS);
    });

    expect(refreshGitStatus).toHaveBeenCalledTimes(1);
    expect(refreshGitStatus).toHaveBeenCalledWith({silent: true});
  });

  it('clears a pending refresh on unmount', () => {
    vi.useFakeTimers();
    const refreshGitStatus = vi.fn();
    const {rerender, unmount} = renderHook(
      ({saveSettledNonce}) =>
        useVaultGitLocalWriteStatusRefresh({
          saveSettledNonce,
          refreshGitStatus,
        }),
      {initialProps: {saveSettledNonce: 0}},
    );

    rerender({saveSettledNonce: 1});
    unmount();

    act(() => {
      vi.advanceTimersByTime(GIT_LOCAL_WRITE_REFRESH_DEBOUNCE_MS);
    });

    expect(refreshGitStatus).not.toHaveBeenCalled();
  });
});

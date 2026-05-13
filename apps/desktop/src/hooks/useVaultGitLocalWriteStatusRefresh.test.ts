import {renderHook} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';

import {useVaultGitLocalWriteStatusRefresh} from './useVaultGitLocalWriteStatusRefresh';

describe('useVaultGitLocalWriteStatusRefresh', () => {
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

  it('refreshes local Git status when a normal note save settles', () => {
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

    expect(refreshGitStatus).toHaveBeenCalledTimes(1);
    expect(runManualSync).not.toHaveBeenCalled();
  });

  it('refreshes local Git status when a TodayHub write settles', () => {
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

    expect(refreshGitStatus).toHaveBeenCalledTimes(1);
    expect(runManualSync).not.toHaveBeenCalled();
  });
});

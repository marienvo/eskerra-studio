import {renderHook} from '@testing-library/react';
import {afterEach, describe, expect, it, vi} from 'vitest';

import {useVaultGitAutosyncCountdown} from './useVaultGitAutosyncCountdown';
import type {GitStatusResult} from '../lib/tauriVaultGitSync';

function localDirtyStatus(): GitStatusResult {
  return {
    branch: 'main',
    expectedBranch: 'main',
    hasUncommittedChanges: true,
    hasStagedChanges: false,
    hasUntrackedFiles: false,
    ahead: 0,
    behind: 0,
    remoteRefAvailable: true,
    unsafeState: null,
    isWrongBranch: false,
  };
}

describe('useVaultGitAutosyncCountdown', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('returns null when countdown should not show', () => {
    const setIntervalSpy = vi.spyOn(window, 'setInterval');

    const {result} = renderHook(() =>
      useVaultGitAutosyncCountdown({
        autosyncPending: false,
        nextAutosyncAtMs: Date.now() + 60_000,
        gitStatus: localDirtyStatus(),
        gitStatusLoading: false,
        gitStatusError: null,
        manualSyncDisabledReason: null,
        manualSyncRunning: false,
        gitOperationBusy: false,
      }),
    );

    expect(result.current).toBeNull();
    expect(setIntervalSpy).not.toHaveBeenCalled();
  });

  it('recomputes the label when the next autosync target moves earlier', () => {
    vi.setSystemTime(new Date('2026-05-20T12:00:00.000Z'));
    const now = Date.now();
    const args = {
      autosyncPending: true,
      gitStatus: localDirtyStatus(),
      gitStatusLoading: false,
      gitStatusError: null,
      manualSyncDisabledReason: null,
      manualSyncRunning: false,
      gitOperationBusy: false,
    };

    const {result, rerender} = renderHook(
      (nextAutosyncAtMs: number) =>
        useVaultGitAutosyncCountdown({
          ...args,
          nextAutosyncAtMs,
        }),
      {initialProps: now + 65_000},
    );

    expect(result.current).toBe('Syncs in 1:05');

    rerender(now + 60_000);

    expect(result.current).toBe('Syncs in 1:00');
  });
});

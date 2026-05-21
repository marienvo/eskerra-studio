import {describe, expect, it} from 'vitest';

import {
  formatAutosyncCountdownLabel,
  getAutosyncPreflight,
  remainingMsUntil,
  resolveAutosyncCountdownLabel,
  shouldShowAutosyncCountdown,
} from './gitAutosyncCountdown';
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

function localDirtyStatus(): GitStatusResult {
  return {...cleanStatus(), hasUncommittedChanges: true};
}

describe('formatAutosyncCountdownLabel', () => {
  it('formats minutes and zero-padded seconds', () => {
    expect(formatAutosyncCountdownLabel(4 * 60 * 1000 + 53 * 1000)).toBe('Syncs in 4:53');
  });

  it('ceil partial seconds and clamps at zero', () => {
    expect(formatAutosyncCountdownLabel(500)).toBe('Syncs in 0:01');
    expect(formatAutosyncCountdownLabel(0)).toBe('Syncs in 0:00');
    expect(formatAutosyncCountdownLabel(-100)).toBe('Syncs in 0:00');
  });
});

describe('remainingMsUntil', () => {
  it('returns non-negative delta', () => {
    expect(remainingMsUntil(1000, 400)).toBe(600);
    expect(remainingMsUntil(1000, 1500)).toBe(0);
  });
});

describe('resolveAutosyncCountdownLabel', () => {
  it('combines target and now', () => {
    expect(resolveAutosyncCountdownLabel(10_000, 0)).toBe('Syncs in 0:10');
  });
});

describe('getAutosyncPreflight', () => {
  it('returns run for local dirty status', () => {
    expect(getAutosyncPreflight(localDirtyStatus())).toBe('run');
  });

  it('returns skip-clear-pending for clean status', () => {
    expect(getAutosyncPreflight(cleanStatus())).toBe('skip-clear-pending');
  });

  it('returns skip-keep-pending for unsafe status', () => {
    expect(getAutosyncPreflight({...cleanStatus(), unsafeState: 'merge'})).toBe(
      'skip-keep-pending',
    );
  });
});

describe('shouldShowAutosyncCountdown', () => {
  const base = {
    autosyncPending: true,
    gitStatus: localDirtyStatus(),
    gitStatusLoading: false,
    gitStatusError: null,
    manualSyncDisabledReason: null,
    manualSyncRunning: false,
    gitOperationBusy: false,
  };

  it('returns true when pending local dirty and gates are open', () => {
    expect(shouldShowAutosyncCountdown(base)).toBe(true);
  });

  it('returns false when not pending', () => {
    expect(shouldShowAutosyncCountdown({...base, autosyncPending: false})).toBe(false);
  });

  it('returns false for ahead-only (Not pushed chip)', () => {
    expect(
      shouldShowAutosyncCountdown({
        ...base,
        gitStatus: {...cleanStatus(), ahead: 2},
      }),
    ).toBe(false);
  });

  it('returns false when manual sync is disabled', () => {
    expect(
      shouldShowAutosyncCountdown({
        ...base,
        manualSyncDisabledReason: 'Unsafe Git state',
      }),
    ).toBe(false);
  });

  it('returns false when preflight would skip-keep-pending', () => {
    expect(
      shouldShowAutosyncCountdown({
        ...base,
        gitStatus: {...cleanStatus(), unsafeState: 'merge'},
      }),
    ).toBe(false);
  });

  it('returns false when git status is unknown', () => {
    expect(shouldShowAutosyncCountdown({...base, gitStatus: null})).toBe(false);
  });
});

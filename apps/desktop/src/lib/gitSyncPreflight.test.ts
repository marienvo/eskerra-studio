import {describe, expect, it} from 'vitest';

import {shouldRunVaultGitSync, type SyncIntent} from './gitSyncPreflight';
import type {GitStatusResult} from './tauriVaultGitSync';

const ALL_INTENTS: SyncIntent[] = ['manual', 'keyboard', 'close', 'startup', 'autosync'];

function clean(): GitStatusResult {
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

function withLocalWork(overrides?: Partial<GitStatusResult>): GitStatusResult {
  return {...clean(), hasUncommittedChanges: true, ...overrides};
}

describe('shouldRunVaultGitSync — null status', () => {
  it('returns true for manual when status is null', () => {
    expect(shouldRunVaultGitSync(null, 'manual')).toBe(true);
  });

  it('returns false for keyboard when status is null', () => {
    expect(shouldRunVaultGitSync(null, 'keyboard')).toBe(false);
  });

  it('returns false for close when status is null', () => {
    expect(shouldRunVaultGitSync(null, 'close')).toBe(false);
  });

  it('returns false for startup when status is null', () => {
    expect(shouldRunVaultGitSync(null, 'startup')).toBe(false);
  });

  it('returns false for autosync when status is null', () => {
    expect(shouldRunVaultGitSync(null, 'autosync')).toBe(false);
  });
});

describe('shouldRunVaultGitSync — clean/synced status', () => {
  for (const intent of ALL_INTENTS) {
    it(`returns false for ${intent} when status is clean`, () => {
      expect(shouldRunVaultGitSync(clean(), intent)).toBe(false);
    });
  }
});

describe('shouldRunVaultGitSync — local work present', () => {
  it('returns true for manual when hasUncommittedChanges is true', () => {
    expect(shouldRunVaultGitSync(withLocalWork(), 'manual')).toBe(true);
  });

  it('returns true for keyboard when hasUncommittedChanges is true', () => {
    expect(shouldRunVaultGitSync(withLocalWork(), 'keyboard')).toBe(true);
  });

  it('returns true for close when hasUncommittedChanges is true', () => {
    expect(shouldRunVaultGitSync(withLocalWork(), 'close')).toBe(true);
  });

  it('returns true for autosync when hasUncommittedChanges is true', () => {
    expect(shouldRunVaultGitSync(withLocalWork(), 'autosync')).toBe(true);
  });

  it('returns true for close when hasStagedChanges is true', () => {
    expect(shouldRunVaultGitSync({...clean(), hasStagedChanges: true}, 'close')).toBe(true);
  });

  it('returns true for close when hasUntrackedFiles is true', () => {
    expect(shouldRunVaultGitSync({...clean(), hasUntrackedFiles: true}, 'close')).toBe(true);
  });
});

describe('shouldRunVaultGitSync — ahead-only', () => {
  const aheadOnly = () => ({...clean(), ahead: 3});

  it('returns true for manual when ahead > 0', () => {
    expect(shouldRunVaultGitSync(aheadOnly(), 'manual')).toBe(true);
  });

  it('returns true for close when ahead > 0', () => {
    expect(shouldRunVaultGitSync(aheadOnly(), 'close')).toBe(true);
  });

  it('returns true for autosync when ahead > 0', () => {
    expect(shouldRunVaultGitSync(aheadOnly(), 'autosync')).toBe(true);
  });
});

describe('shouldRunVaultGitSync — behind-only', () => {
  const behindOnly = () => ({...clean(), behind: 2});

  it('returns true for manual when behind > 0', () => {
    expect(shouldRunVaultGitSync(behindOnly(), 'manual')).toBe(true);
  });

  it('returns true for keyboard when behind > 0', () => {
    expect(shouldRunVaultGitSync(behindOnly(), 'keyboard')).toBe(true);
  });

  it('returns false for close when behind > 0 but nothing local', () => {
    expect(shouldRunVaultGitSync(behindOnly(), 'close')).toBe(false);
  });

  it('returns false for startup when behind > 0 but nothing local', () => {
    expect(shouldRunVaultGitSync(behindOnly(), 'startup')).toBe(false);
  });

  it('returns false for autosync when behind > 0 but nothing local', () => {
    expect(shouldRunVaultGitSync(behindOnly(), 'autosync')).toBe(false);
  });
});

describe('shouldRunVaultGitSync — diverged', () => {
  const diverged = () => ({...clean(), ahead: 1, behind: 1});

  it('returns true for close when diverged', () => {
    expect(shouldRunVaultGitSync(diverged(), 'close')).toBe(true);
  });

  it('returns true for autosync when diverged', () => {
    expect(shouldRunVaultGitSync(diverged(), 'autosync')).toBe(true);
  });

  it('returns true for manual when diverged', () => {
    expect(shouldRunVaultGitSync(diverged(), 'manual')).toBe(true);
  });
});

describe('shouldRunVaultGitSync — error state (unsafeState set)', () => {
  const errored = () => ({...clean(), unsafeState: 'merge' as const});

  it('returns true for manual when unsafeState is set', () => {
    expect(shouldRunVaultGitSync(errored(), 'manual')).toBe(true);
  });

  it('returns false for keyboard when unsafeState is set', () => {
    expect(shouldRunVaultGitSync(errored(), 'keyboard')).toBe(false);
  });

  it('returns false for close when unsafeState is set', () => {
    expect(shouldRunVaultGitSync(errored(), 'close')).toBe(false);
  });

  it('returns false for startup when unsafeState is set', () => {
    expect(shouldRunVaultGitSync(errored(), 'startup')).toBe(false);
  });

  it('returns false for autosync when unsafeState is set', () => {
    expect(shouldRunVaultGitSync(errored(), 'autosync')).toBe(false);
  });
});

describe('shouldRunVaultGitSync — wrong branch', () => {
  const wrongBranch = () => ({...clean(), isWrongBranch: true});

  it('returns true for manual when isWrongBranch', () => {
    expect(shouldRunVaultGitSync(wrongBranch(), 'manual')).toBe(true);
  });

  it('returns false for close when isWrongBranch', () => {
    expect(shouldRunVaultGitSync(wrongBranch(), 'close')).toBe(false);
  });

  it('returns false for autosync when isWrongBranch', () => {
    expect(shouldRunVaultGitSync(wrongBranch(), 'autosync')).toBe(false);
  });
});

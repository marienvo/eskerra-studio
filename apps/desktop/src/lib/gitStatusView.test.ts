import {describe, expect, it} from 'vitest';

import {mapGitStatusToView} from './gitStatusView';
import type {GitStatusResult} from './tauriVaultGitSync';

const clean: GitStatusResult = {
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

describe('mapGitStatusToView', () => {
  // -------------------------------------------------------------------------
  // Priority 1: unsafe beats everything else
  // -------------------------------------------------------------------------

  it('unsafe state beats wrong branch', () => {
    const view = mapGitStatusToView({
      ...clean,
      unsafeState: 'merge',
      isWrongBranch: true,
      ahead: 3,
      behind: 2,
    });
    expect(view.label).toBe('Git needs attention');
    expect(view.tone).toBe('danger');
  });

  it('unsafe state beats diverged', () => {
    const view = mapGitStatusToView({
      ...clean,
      unsafeState: 'rebase',
      ahead: 2,
      behind: 1,
    });
    expect(view.label).toBe('Git needs attention');
    expect(view.tone).toBe('danger');
  });

  it('detached HEAD describes correctly', () => {
    const view = mapGitStatusToView({...clean, unsafeState: 'detachedHead'});
    expect(view.label).toBe('Git needs attention');
    expect(view.description).toContain('detached');
  });

  it('index lock describes correctly', () => {
    const view = mapGitStatusToView({...clean, unsafeState: 'indexLock'});
    expect(view.description).toContain('locked');
  });

  it('merge describes correctly', () => {
    const view = mapGitStatusToView({...clean, unsafeState: 'merge'});
    expect(view.description).toContain('Merge');
  });

  it('rebase describes correctly', () => {
    const view = mapGitStatusToView({...clean, unsafeState: 'rebase'});
    expect(view.description).toContain('Rebase');
  });

  it('bisect describes correctly', () => {
    const view = mapGitStatusToView({...clean, unsafeState: 'bisect'});
    expect(view.description).toContain('Bisect');
  });

  // -------------------------------------------------------------------------
  // Priority 2: wrong branch beats divergence
  // -------------------------------------------------------------------------

  it('wrong branch beats diverged', () => {
    const view = mapGitStatusToView({...clean, isWrongBranch: true, ahead: 2, behind: 1});
    expect(view.label).toBe('Wrong branch');
    expect(view.tone).toBe('warning');
  });

  it('wrong branch description includes current and expected branch names', () => {
    const view = mapGitStatusToView({
      ...clean,
      branch: 'feature/x',
      isWrongBranch: true,
    });
    expect(view.description).toContain('feature/x');
    expect(view.description).toContain('main');
  });

  it('wrong branch with null branch shows detached HEAD in description', () => {
    const view = mapGitStatusToView({...clean, branch: null, isWrongBranch: true});
    expect(view.description).toContain('detached HEAD');
  });

  // -------------------------------------------------------------------------
  // Priority 3: diverged beats ahead-only and behind-only
  // -------------------------------------------------------------------------

  it('diverged beats ahead-only', () => {
    const view = mapGitStatusToView({...clean, ahead: 3, behind: 1});
    expect(view.label).toBe('Diverged');
    expect(view.tone).toBe('warning');
  });

  it('diverged description includes both counts', () => {
    const view = mapGitStatusToView({...clean, ahead: 2, behind: 3});
    expect(view.description).toContain('2 local commit');
    expect(view.description).toContain('3 remote commit');
  });

  it('diverged pluralises commits correctly for singular', () => {
    const view = mapGitStatusToView({...clean, ahead: 1, behind: 1});
    expect(view.description).toContain('1 local commit,');
    expect(view.description).toContain('1 remote commit');
    expect(view.description).not.toContain('commits');
  });

  // -------------------------------------------------------------------------
  // Priority 4: ahead-only → Not pushed
  // -------------------------------------------------------------------------

  it('ahead-only maps to Not pushed', () => {
    const view = mapGitStatusToView({...clean, ahead: 2, behind: 0});
    expect(view.label).toBe('Not pushed');
    expect(view.tone).toBe('warning');
  });

  it('not pushed description includes commit count', () => {
    const view = mapGitStatusToView({...clean, ahead: 3, behind: 0});
    expect(view.description).toContain('3 local commit');
  });

  // -------------------------------------------------------------------------
  // Priority 5: behind-only → Remote changes
  // -------------------------------------------------------------------------

  it('behind-only maps to Remote changes', () => {
    const view = mapGitStatusToView({...clean, ahead: 0, behind: 4});
    expect(view.label).toBe('Remote changes');
    expect(view.tone).toBe('info');
  });

  it('remote changes description includes commit count', () => {
    const view = mapGitStatusToView({...clean, behind: 1});
    expect(view.description).toContain('1 remote commit');
    expect(view.description).not.toContain('commits');
  });

  // -------------------------------------------------------------------------
  // Priority 6: local changes
  // -------------------------------------------------------------------------

  it('staged changes maps to Local changes', () => {
    const view = mapGitStatusToView({...clean, hasStagedChanges: true});
    expect(view.label).toBe('Local changes');
    expect(view.tone).toBe('info');
    expect(view.description).toContain('staged');
  });

  it('uncommitted changes maps to Local changes', () => {
    const view = mapGitStatusToView({...clean, hasUncommittedChanges: true});
    expect(view.label).toBe('Local changes');
    expect(view.description).toContain('unstaged');
  });

  it('untracked files maps to Local changes', () => {
    const view = mapGitStatusToView({...clean, hasUntrackedFiles: true});
    expect(view.label).toBe('Local changes');
    expect(view.description).toContain('untracked');
  });

  it('local changes description includes all applicable categories', () => {
    const view = mapGitStatusToView({
      ...clean,
      hasStagedChanges: true,
      hasUncommittedChanges: true,
      hasUntrackedFiles: true,
    });
    expect(view.description).toContain('staged');
    expect(view.description).toContain('unstaged');
    expect(view.description).toContain('untracked');
  });

  // -------------------------------------------------------------------------
  // Priority 7: remote unknown
  // -------------------------------------------------------------------------

  it('missing remote ref maps to Remote unknown when no higher-priority state', () => {
    const view = mapGitStatusToView({...clean, remoteRefAvailable: false});
    expect(view.label).toBe('Remote unknown');
    expect(view.tone).toBe('muted');
    expect(view.description).toBeTruthy();
  });

  it('missing remote ref is overridden by local changes', () => {
    const view = mapGitStatusToView({
      ...clean,
      remoteRefAvailable: false,
      hasUncommittedChanges: true,
    });
    expect(view.label).toBe('Local changes');
  });

  // -------------------------------------------------------------------------
  // Priority 8: synced
  // -------------------------------------------------------------------------

  it('clean repo maps to Synced', () => {
    const view = mapGitStatusToView(clean);
    expect(view.label).toBe('Synced');
    expect(view.tone).toBe('success');
    expect(view.description).toBeNull();
  });
});

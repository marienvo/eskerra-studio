import {describe, expect, it} from 'vitest';

import {createWorkspaceHomeState} from '../lib/workspaceHomeNavigation';
import {
  computePrunedHomeStatesAfterUriRemoval,
  computeRemappedHomeStatesForVaultPrefix,
} from './workspaceHomeHistoryShadowSync';

describe('computeRemappedHomeStatesForVaultPrefix', () => {
  it('returns changed false when home map is empty', () => {
    const {changed} = computeRemappedHomeStatesForVaultPrefix({
      current: {},
      oldPrefix: '/a',
      newPrefix: '/b',
    });
    expect(changed).toBe(false);
  });

  it('remaps hub keys when vault prefix applies', () => {
    const oldHub = '/vault/Inbox/OldHub/Today.md';
    const state = createWorkspaceHomeState(oldHub);
    const {next, changed} = computeRemappedHomeStatesForVaultPrefix({
      current: {[oldHub]: state},
      oldPrefix: '/vault/Inbox/OldHub',
      newPrefix: '/vault/Inbox/NewHub',
    });
    expect(changed).toBe(true);
    expect(Object.keys(next)).toEqual(['/vault/Inbox/NewHub/Today.md']);
  });
});

describe('computePrunedHomeStatesAfterUriRemoval', () => {
  it('keeps hub when removal predicate never matches entries', () => {
    const hub = '/vault/A/Today.md';
    const state = createWorkspaceHomeState(hub);
    const {next} = computePrunedHomeStatesAfterUriRemoval({
      current: {[hub]: state},
      shouldRemove: uri => uri.includes('__no_match__'),
    });
    expect(next[hub]).toBeDefined();
  });

  it('drops a hub entry when prune removes all stack content', () => {
    const hub = '/vault/A/Today.md';
    const state = createWorkspaceHomeState(hub);
    const {next, changed} = computePrunedHomeStatesAfterUriRemoval({
      current: {[hub]: state},
      shouldRemove: () => true,
    });
    expect(changed).toBe(true);
    expect(next[hub]).toBeUndefined();
  });
});

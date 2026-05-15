import {describe, expect, it} from 'vitest';
import {
  createDefaultWorkspaceState,
  normalizeWorkspaceUri,
  openTabForegroundAction,
  syncHubWorkspacesToVaultTodayRefsAction,
} from '../index';
import type {WorkspaceModel} from '../types';

const HUB_A = '/vault/A/Today.md';
const HUB_B = '/vault/B/Today.md';
const NOTE = '/vault/Inbox/n.md';

describe('syncHubWorkspacesToVaultTodayRefsAction', () => {
  it('removes workspace rows not in the vault hub list', () => {
    const a = normalizeWorkspaceUri(HUB_A);
    const b = normalizeWorkspaceUri(HUB_B);
    const m0: WorkspaceModel = {
      activeHub: a,
      workspaces: {
        [a]: createDefaultWorkspaceState(a),
        [b]: createDefaultWorkspaceState(b),
      },
    };
    const m1 = syncHubWorkspacesToVaultTodayRefsAction(m0, [HUB_A]);
    expect(Object.keys(m1.workspaces).map(normalizeWorkspaceUri)).toEqual([a]);
    expect(m1.workspaces[b]).toBeUndefined();
  });

  it('clears all hub workspaces when the vault lists none', () => {
    const a = normalizeWorkspaceUri(HUB_A);
    const m0: WorkspaceModel = {
      activeHub: a,
      workspaces: {[a]: createDefaultWorkspaceState(a)},
    };
    const m1 = syncHubWorkspacesToVaultTodayRefsAction(m0, []);
    expect(m1.workspaces).toEqual({});
    expect(m1.activeHub).toBeNull();
  });

  it('does not strip arbitrary note URIs from tab history when pruning another hub', () => {
    const a = normalizeWorkspaceUri(HUB_A);
    const b = normalizeWorkspaceUri(HUB_B);
    let m: WorkspaceModel = {
      activeHub: a,
      workspaces: {
        [a]: createDefaultWorkspaceState(a),
        [b]: createDefaultWorkspaceState(b),
      },
    };
    m = openTabForegroundAction(m, NOTE, {tabId: 't1'});
    const m1 = syncHubWorkspacesToVaultTodayRefsAction(m, [HUB_A]);
    const tab = m1.workspaces[a]!.tabs.find(t => t.id === 't1');
    expect(tab?.history.entries.map(normalizeWorkspaceUri)).toContain(normalizeWorkspaceUri(NOTE));
    expect(m1.workspaces[b]).toBeUndefined();
  });
});

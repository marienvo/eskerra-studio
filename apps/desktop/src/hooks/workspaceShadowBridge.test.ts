import {describe, expect, it} from 'vitest';

import type {TodayHubWorkspaceSnapshot} from '../lib/mainWindowUiStore';

import {
  computeProjectionHubUris,
  resolveTodayHubWorkspacesForProjection,
} from './workspaceShadowBridge';

const emptySnap = {} as TodayHubWorkspaceSnapshot;

describe('computeProjectionHubUris', () => {
  const vaultRoot = '/vault';

  it('merges only restored hubs under the active vault that are Today.md files', () => {
    const merged = computeProjectionHubUris({
      workspaceModelHubUris: ['/vault/A/Today.md'],
      vaultRootNormalized: vaultRoot,
      restoredInboxState: {
        todayHubWorkspaces: {
          '/vault/B/Today.md': emptySnap,
          '/vault/C/Today.md': emptySnap,
          '/other-vault/B/Today.md': emptySnap,
          '/vault/Inbox/Note.md': emptySnap,
        },
      },
    });
    expect(merged).toEqual([
      '/vault/A/Today.md',
      '/vault/B/Today.md',
      '/vault/C/Today.md',
    ]);
  });

  it('does not merge restored keys when vaultRootNormalized is null', () => {
    const hubs = ['/vault/A/Today.md'];
    expect(
      computeProjectionHubUris({
        workspaceModelHubUris: hubs,
        vaultRootNormalized: null,
        restoredInboxState: {
          todayHubWorkspaces: {'/vault/B/Today.md': emptySnap},
        },
      }),
    ).toEqual(hubs);
  });

  it('merges when model and restored have the same count but different hub URIs', () => {
    const merged = computeProjectionHubUris({
      workspaceModelHubUris: ['/vault/A/Today.md', '/vault/B/Today.md'],
      vaultRootNormalized: vaultRoot,
      restoredInboxState: {
        todayHubWorkspaces: {
          '/vault/C/Today.md': emptySnap,
          '/vault/D/Today.md': emptySnap,
        },
      },
    });
    expect(merged).toEqual([
      '/vault/A/Today.md',
      '/vault/B/Today.md',
      '/vault/C/Today.md',
      '/vault/D/Today.md',
    ]);
  });
});

describe('resolveTodayHubWorkspacesForProjection', () => {
  const vaultRoot = '/vault';

  it('filters restored snapshots to the active vault when legacy is empty', () => {
    const filtered = resolveTodayHubWorkspacesForProjection({
      legacyTodayHubWorkspaces: {},
      vaultRootNormalized: vaultRoot,
      restoredTodayHubWorkspaces: {
        '/vault/A/Today.md': emptySnap,
        '/other-vault/B/Today.md': emptySnap,
      },
    });
    expect(Object.keys(filtered)).toEqual(['/vault/A/Today.md']);
  });

  it('returns empty legacy when vault is unknown even if restored has entries', () => {
    const filtered = resolveTodayHubWorkspacesForProjection({
      legacyTodayHubWorkspaces: {},
      vaultRootNormalized: null,
      restoredTodayHubWorkspaces: {'/vault/A/Today.md': emptySnap},
    });
    expect(filtered).toEqual({});
  });
});

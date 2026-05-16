/**
 * Asserts that home-history remap + URI removal go through the WorkspaceModel actions
 * (`remapPrefixAction`, `removeUrisAction`) without needing a parallel runtime bridge.
 *
 * After step 3c, the legacy `homeStatesByHub` is mirrored from the model via the existing
 * signature-comparison layout effect in `useMainWindowWorkspace`; the per-hub home history
 * therefore only needs to be correct in the model itself.
 */
import {describe, expect, it} from 'vitest';

import {
  createDefaultWorkspaceState,
  normalizeWorkspaceUri,
  remapPrefixAction,
  removeUrisAction,
  type WorkspaceModel,
} from '../lib/workspaceModel';
import {workspaceHomeStatesFromWorkspaceModel} from './workspaceRuntimeProjection';

const OLD_HUB = '/vault/Inbox/OldFolder/Today.md';
const NEW_HUB = '/vault/Inbox/NewFolder/Today.md';
const NOTE_KEEP = '/vault/Inbox/Keep.md';
const NOTE_REMOVE = '/vault/Inbox/Remove.md';

function modelWithHomeHistory(
  hub: string,
  homeEntries: string[],
  homeIndex = homeEntries.length - 1,
): WorkspaceModel {
  return {
    activeHub: hub,
    workspaces: {
      [hub]: {
        ...createDefaultWorkspaceState(hub),
        homeHistory: {entries: homeEntries, index: homeIndex},
      },
    },
  };
}

describe('home-history via WorkspaceModel (no runtime bridge)', () => {
  it('remapPrefixAction renames hub key and rewrites home entries', () => {
    const start = modelWithHomeHistory(OLD_HUB, [OLD_HUB, NOTE_KEEP], 1);
    const next = remapPrefixAction(
      start,
      '/vault/Inbox/OldFolder',
      '/vault/Inbox/NewFolder',
    );

    const newKey = normalizeWorkspaceUri(NEW_HUB);
    expect(next.activeHub).toBe(newKey);
    expect(next.workspaces[newKey]?.homeHistory).toEqual({
      entries: [NEW_HUB, NOTE_KEEP],
      index: 1,
    });
  });

  it('removeUrisAction prunes a deleted note from home history but keeps the hub root', () => {
    const start = modelWithHomeHistory(OLD_HUB, [OLD_HUB, NOTE_REMOVE, NOTE_KEEP], 2);
    const next = removeUrisAction(start, u => u === NOTE_REMOVE);

    const key = normalizeWorkspaceUri(OLD_HUB);
    expect(next.workspaces[key]?.homeHistory.entries).toEqual([OLD_HUB, NOTE_KEEP]);
  });

  it('removeUrisAction drops the workspace when its hub URI itself is removed', () => {
    const start = modelWithHomeHistory(OLD_HUB, [OLD_HUB, NOTE_KEEP], 1);
    const next = removeUrisAction(start, u => u === normalizeWorkspaceUri(OLD_HUB));

    expect(Object.keys(next.workspaces)).toEqual([]);
    expect(next.activeHub).toBeNull();
  });

  it('workspaceHomeStatesFromWorkspaceModel mirrors per-hub home history for legacy consumers', () => {
    const start = modelWithHomeHistory(OLD_HUB, [OLD_HUB, NOTE_KEEP], 1);
    const homeStates = workspaceHomeStatesFromWorkspaceModel(start);
    expect(homeStates[OLD_HUB]?.history.entries).toEqual([OLD_HUB, NOTE_KEEP]);
    expect(homeStates[OLD_HUB]?.history.index).toBe(1);
  });
});

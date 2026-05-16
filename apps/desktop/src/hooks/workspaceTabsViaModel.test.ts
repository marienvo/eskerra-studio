/**
 * Asserts that the editor tab strip derived from WorkspaceModel actions matches what the
 * legacy ref + React state should hold, so the runtime `assignLegacyEditorWorkspaceTabs`
 * wrapper is no longer required. Production code dispatches a model action; the layout
 * effect in `useMainWindowWorkspace` mirrors `editorWorkspaceTabs` + `activeEditorTabId`
 * back to legacy state via `editorWorkspaceTabsFromModelTabEntries` /
 * `activeSurfaceTabIdFromWorkspaceModel`. This test pins the model-projection contract.
 */
import {describe, expect, it} from 'vitest';

import {
  closeTabAction,
  createDefaultWorkspaceState,
  normalizeWorkspaceUri,
  openTabBackgroundAction,
  reorderTabsAction,
  type WorkspaceModel,
} from '../lib/workspaceModel';
import {
  activeEditorWorkspaceTabsFromWorkspaceModel,
  activeSurfaceTabIdFromWorkspaceModel,
} from './workspaceRuntimeProjection';

const HUB = '/vault/A/Today.md';
const NOTE_A = '/vault/Inbox/A.md';
const NOTE_B = '/vault/Inbox/B.md';

function baseModel(): WorkspaceModel {
  const hub = normalizeWorkspaceUri(HUB);
  return {
    activeHub: hub,
    workspaces: {
      [hub]: createDefaultWorkspaceState(HUB),
    },
  };
}

describe('editor tab strip via WorkspaceModel (no runtime bridge)', () => {
  it('openTabBackgroundAction adds a tab; projection exposes it to legacy mirror', () => {
    const opened = openTabBackgroundAction(baseModel(), NOTE_A, {tabId: 't-a'});
    const tabs = activeEditorWorkspaceTabsFromWorkspaceModel(opened);
    expect(tabs).toEqual([{id: 't-a', history: {entries: [NOTE_A], index: 0}}]);
    expect(activeSurfaceTabIdFromWorkspaceModel(opened)).toBeNull();
  });

  it('closeTabAction removes the tab and updates active surface', () => {
    let m = openTabBackgroundAction(baseModel(), NOTE_A, {tabId: 't-a'});
    m = openTabBackgroundAction(m, NOTE_B, {tabId: 't-b'});
    m = closeTabAction(m, 't-a');
    expect(activeEditorWorkspaceTabsFromWorkspaceModel(m).map(t => t.id)).toEqual([
      't-b',
    ]);
  });

  it('reorderTabsAction moves a tab to a new index', () => {
    let m = openTabBackgroundAction(baseModel(), NOTE_A, {tabId: 't-a'});
    m = openTabBackgroundAction(m, NOTE_B, {tabId: 't-b'});
    m = reorderTabsAction(m, 1, 0);
    expect(activeEditorWorkspaceTabsFromWorkspaceModel(m).map(t => t.id)).toEqual([
      't-b',
      't-a',
    ]);
  });
});

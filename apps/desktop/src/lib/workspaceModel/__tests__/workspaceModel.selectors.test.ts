import {describe, expect, it} from 'vitest';
import {
  activateTabAction,
  canGoBack,
  canGoForward,
  createDefaultWorkspaceState,
  normalizeWorkspaceUri,
  workspaceSelectorShowsActiveTabPill,
  workspaceSelectorSubLabel,
} from '../index';
import type {WorkspaceModel} from '../types';

const HUB = normalizeWorkspaceUri('/vault/Today.md');
const NOTE = normalizeWorkspaceUri('/vault/Note.md');

describe('workspaceModel selectors', () => {
  it('subLabel exists when Home history index > 0 even if active surface is a tab', () => {
    const m: WorkspaceModel = {
      activeHub: HUB,
      workspaces: {
        [HUB]: {
          tabs: [{id: 't1', history: {entries: [HUB], index: 0}}],
          homeHistory: {entries: [HUB, NOTE], index: 1},
          active: {kind: 'tab', id: 't1'},
        },
      },
    };
    expect(workspaceSelectorSubLabel(m)).toBe(NOTE);
  });

  it('pill styling is active only when active surface is Home', () => {
    const base: WorkspaceModel = {
      activeHub: HUB,
      workspaces: {
        [HUB]: {
          ...createDefaultWorkspaceState(HUB),
          homeHistory: {entries: [HUB, NOTE], index: 1},
        },
      },
    };
    expect(workspaceSelectorShowsActiveTabPill(base)).toBe(true);
    const onTab = activateTabAction(
      {
        ...base,
        workspaces: {
          [HUB]: {
            ...base.workspaces[HUB]!,
            tabs: [{id: 't1', history: {entries: [NOTE], index: 0}}],
          },
        },
      },
      't1',
    );
    expect(workspaceSelectorShowsActiveTabPill(onTab)).toBe(false);
  });

  it('canGoBack / canGoForward read the active surface only', () => {
    const m: WorkspaceModel = {
      activeHub: HUB,
      workspaces: {
        [HUB]: {
          tabs: [{id: 't1', history: {entries: [HUB], index: 0}}],
          homeHistory: {entries: [HUB, NOTE, NOTE], index: 2},
          active: {kind: 'tab', id: 't1'},
        },
      },
    };
    expect(canGoBack(m)).toBe(false);
    expect(canGoForward(m)).toBe(false);
  });
});

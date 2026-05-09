import {describe, expect, it} from 'vitest';
import {createDefaultWorkspaceState, normalizeWorkspaceUri, validateWorkspaceModel} from '../index';
import type {WorkspaceModel} from '../types';

const HUB = normalizeWorkspaceUri('/vault/Today.md');

describe('workspaceModel validateWorkspaceModel', () => {
  it('reports invalid home root', () => {
    const m: WorkspaceModel = {
      activeHub: HUB,
      workspaces: {
        [HUB]: {
          ...createDefaultWorkspaceState(HUB),
          homeHistory: {entries: [normalizeWorkspaceUri('/wrong/Today.md')], index: 0},
        },
      },
    };
    const codes = validateWorkspaceModel(m).map(i => i.code);
    expect(codes).toContain('home_root_mismatch');
  });

  it('reports invalid history index', () => {
    const m: WorkspaceModel = {
      activeHub: HUB,
      workspaces: {
        [HUB]: {
          ...createDefaultWorkspaceState(HUB),
          homeHistory: {entries: [HUB], index: 5},
        },
      },
    };
    const codes = validateWorkspaceModel(m).map(i => i.code);
    expect(codes).toContain('home_history_index_range');
  });

  it('reports active tab id must exist', () => {
    const m: WorkspaceModel = {
      activeHub: HUB,
      workspaces: {
        [HUB]: {
          ...createDefaultWorkspaceState(HUB),
          active: {kind: 'tab', id: 'missing'},
        },
      },
    };
    const codes = validateWorkspaceModel(m).map(i => i.code);
    expect(codes).toContain('active_tab_missing');
  });

  it('reports duplicate tab ids', () => {
    const m: WorkspaceModel = {
      activeHub: HUB,
      workspaces: {
        [HUB]: {
          ...createDefaultWorkspaceState(HUB),
          tabs: [
            {id: 'x', history: {entries: [HUB], index: 0}},
            {id: 'x', history: {entries: [HUB], index: 0}},
          ],
        },
      },
    };
    const codes = validateWorkspaceModel(m).map(i => i.code);
    expect(codes).toContain('duplicate_tab_id');
  });
});

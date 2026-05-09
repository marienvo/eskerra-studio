import {activateWorkspaceSelectorAction} from './activateSurface';
import type {WorkspaceModel, WorkspaceState} from '../types';
import {createDefaultWorkspaceState, normalizeWorkspaceUri} from '../types';

function ensureWorkspaceEntry(
  workspaces: Readonly<Record<string, WorkspaceState>>,
  hub: string,
): Record<string, WorkspaceState> {
  if (workspaces[hub]) {
    return {...workspaces};
  }
  return {...workspaces, [hub]: createDefaultWorkspaceState(hub)};
}

/**
 * selectWorkspaceAction(W) with W === activeHub behaves like activateWorkspaceSelectorAction
 * (transition table).
 */
export function selectWorkspaceAction(m: WorkspaceModel, hubUri: string): WorkspaceModel {
  const w = normalizeWorkspaceUri(hubUri);
  if (m.activeHub != null && normalizeWorkspaceUri(m.activeHub) === w) {
    return activateWorkspaceSelectorAction(m);
  }
  const workspaces = m.workspaces[w]
    ? m.workspaces
    : ensureWorkspaceEntry(m.workspaces, w);
  return {
    ...m,
    activeHub: w,
    workspaces,
  };
}

/**
 * Ensures each listed hub has a workspace entry. Does not remove hubs missing from the list
 * (deletions use removeUrisAction). If activeHub is null and the list is non-empty, activeHub
 * becomes the first hub in the given order.
 */
export function ensureWorkspaceForHubsAction(
  m: WorkspaceModel,
  hubUris: readonly string[],
): WorkspaceModel {
  const workspaces: Record<string, WorkspaceState> = {...m.workspaces};
  for (const raw of hubUris) {
    const h = normalizeWorkspaceUri(raw);
    if (!workspaces[h]) {
      workspaces[h] = createDefaultWorkspaceState(h);
    }
  }
  let activeHub = m.activeHub;
  if (activeHub == null && hubUris.length > 0) {
    activeHub = normalizeWorkspaceUri(hubUris[0]!);
  }
  return {...m, workspaces, activeHub};
}

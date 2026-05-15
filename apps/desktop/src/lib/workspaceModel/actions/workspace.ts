import {activateWorkspaceSelectorAction} from './activateSurface';
import {removeUrisAction} from './external';
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

export function applyIncomingHubWorkspaceAction(
  m: WorkspaceModel,
  hubUri: string,
  workspace: WorkspaceState,
): WorkspaceModel {
  const next = selectWorkspaceAction(m, hubUri);
  const hub = normalizeWorkspaceUri(hubUri);
  return {
    ...next,
    workspaces: {
      ...next.workspaces,
      [hub]: workspace,
    },
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

/**
 * Drops workspace rows whose hub keys are not listed in `hubUrisFromVault`, then ensures each
 * listed hub exists. Uses {@link removeUrisAction} with a predicate that matches **only** stale hub
 * URIs (never `u => !allowed.has(u)`), so normal note paths in tab histories are not stripped.
 */
export function syncHubWorkspacesToVaultTodayRefsAction(
  m: WorkspaceModel,
  hubUrisFromVault: readonly string[],
): WorkspaceModel {
  const allowed = new Set(hubUrisFromVault.map(h => normalizeWorkspaceUri(h)));
  const staleHubKeys = new Set<string>();
  for (const hubKey of Object.keys(m.workspaces)) {
    const n = normalizeWorkspaceUri(hubKey);
    if (!allowed.has(n)) {
      staleHubKeys.add(n);
    }
  }
  const afterPrune =
    staleHubKeys.size > 0
      ? removeUrisAction(m, u => staleHubKeys.has(normalizeWorkspaceUri(u)))
      : m;
  return ensureWorkspaceForHubsAction(afterPrune, hubUrisFromVault);
}

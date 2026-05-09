/**
 * Home stack (runtime) ↔ WorkspaceModel shadow sync for URI remap and targeted removals.
 * Runtime `homeStatesByHub` stays authoritative; shadow updates use `dispatchWorkspaceAction` /
 * `dispatchWorkspaceActionSync` at orchestration sites (see `remapHomeStatesPrefix` and
 * `removeHomeHistoryUris` in `useMainWindowWorkspace`).
 */
import type {Dispatch, RefObject, SetStateAction} from 'react';

import {remapVaultUriPrefix} from '../lib/editorDocumentHistory';
import {
  homeRemapPrefix,
  homeRemoveUris,
  type WorkspaceHomeState,
} from '../lib/workspaceHomeNavigation';
import type {DispatchWorkspaceModelAction} from './workspaceShadowBridge';

export function computeRemappedHomeStatesForVaultPrefix(args: {
  current: Record<string, WorkspaceHomeState>;
  oldPrefix: string;
  newPrefix: string;
}): {next: Record<string, WorkspaceHomeState>; changed: boolean} {
  const {current, oldPrefix, newPrefix} = args;
  const next: Record<string, WorkspaceHomeState> = {};
  let changed = false;
  for (const [hubUri, state] of Object.entries(current)) {
    const mappedHub = remapVaultUriPrefix(hubUri, oldPrefix, newPrefix) ?? hubUri;
    const mappedState = homeRemapPrefix(state, oldPrefix, newPrefix);
    next[mappedHub] = mappedState;
    changed = changed || mappedHub !== hubUri || mappedState !== state;
  }
  return {next, changed};
}

export function computePrunedHomeStatesAfterUriRemoval(args: {
  current: Record<string, WorkspaceHomeState>;
  shouldRemove: (normalizedUri: string) => boolean;
}): {next: Record<string, WorkspaceHomeState>; changed: boolean} {
  const {current, shouldRemove} = args;
  const next: Record<string, WorkspaceHomeState> = {};
  let changed = false;
  for (const [hubUri, state] of Object.entries(current)) {
    const pruned = homeRemoveUris(state, shouldRemove);
    if (pruned == null) {
      changed = true;
      continue;
    }
    next[hubUri] = pruned;
    changed = changed || pruned !== state;
  }
  return {next, changed};
}

export type HomeHistoryShadowSyncBridgeDeps = {
  homeStatesByHubRef: RefObject<Record<string, WorkspaceHomeState>>;
  setHomeStatesByHub: Dispatch<
    SetStateAction<Record<string, WorkspaceHomeState>>
  >;
  dispatchWorkspaceAction: DispatchWorkspaceModelAction;
};

export type HomeStatesPrefixRemapReactDeps = Pick<
  HomeHistoryShadowSyncBridgeDeps,
  'homeStatesByHubRef' | 'setHomeStatesByHub'
>;

/**
 * Updates runtime `homeStatesByHub` when hub keys or home stacks change under a vault prefix
 * remap. Does **not** mutate {@link WorkspaceModel} — callers sync the shadow model (e.g.
 * {@link remapPrefixAction}) in the same transaction.
 */
export function remapHomeStatesPrefixBridge(
  deps: HomeStatesPrefixRemapReactDeps,
  oldPrefix: string,
  newPrefix: string,
): boolean {
  const {homeStatesByHubRef, setHomeStatesByHub} = deps;
  const {next, changed} = computeRemappedHomeStatesForVaultPrefix({
    current: homeStatesByHubRef.current,
    oldPrefix,
    newPrefix,
  });
  if (!changed) {
    return false;
  }
  homeStatesByHubRef.current = next;
  setHomeStatesByHub(next);
  return true;
}

export type HomeHistoryRemoveUrisReactDeps = Pick<
  HomeHistoryShadowSyncBridgeDeps,
  'homeStatesByHubRef' | 'setHomeStatesByHub'
>;

/**
 * Prunes runtime `homeStatesByHub` entries. Does **not** update {@link WorkspaceModel} — callers
 * run {@link removeUrisAction} (e.g. via `dispatchWorkspaceActionSync`) in the same transaction.
 */
export function removeHomeHistoryUrisBridge(
  deps: HomeHistoryRemoveUrisReactDeps,
  shouldRemove: (normalizedUri: string) => boolean,
): boolean {
  const {homeStatesByHubRef, setHomeStatesByHub} = deps;
  const {next, changed} = computePrunedHomeStatesAfterUriRemoval({
    current: homeStatesByHubRef.current,
    shouldRemove,
  });
  if (!changed) {
    return false;
  }
  homeStatesByHubRef.current = next;
  setHomeStatesByHub(next);
  return true;
}

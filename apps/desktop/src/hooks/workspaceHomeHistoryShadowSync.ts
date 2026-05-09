/**
 * Home stack (runtime) ↔ WorkspaceModel shadow sync for URI remap and targeted removals.
 * Runtime `homeStatesByHub` stays authoritative; shadow mirrors via `dispatchWorkspaceAction`.
 */
import type {Dispatch, RefObject, SetStateAction} from 'react';

import {remapVaultUriPrefix} from '../lib/editorDocumentHistory';
import {
  homeRemapPrefix,
  homeRemoveUris,
  type WorkspaceHomeState,
} from '../lib/workspaceHomeNavigation';
import {remapPrefixAction, removeUrisAction} from '../lib/workspaceModel';
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

export function remapHomeStatesPrefixBridge(
  deps: HomeHistoryShadowSyncBridgeDeps,
  oldPrefix: string,
  newPrefix: string,
): void {
  const {homeStatesByHubRef, setHomeStatesByHub, dispatchWorkspaceAction} = deps;
  const {next, changed} = computeRemappedHomeStatesForVaultPrefix({
    current: homeStatesByHubRef.current,
    oldPrefix,
    newPrefix,
  });
  if (!changed) {
    return;
  }
  homeStatesByHubRef.current = next;
  setHomeStatesByHub(next);
  dispatchWorkspaceAction(
    `homeHistory remap ${oldPrefix} -> ${newPrefix}`,
    model => remapPrefixAction(model, oldPrefix, newPrefix),
  );
}

export function removeHomeHistoryUrisBridge(
  deps: HomeHistoryShadowSyncBridgeDeps,
  shouldRemove: (normalizedUri: string) => boolean,
): void {
  const {homeStatesByHubRef, setHomeStatesByHub, dispatchWorkspaceAction} = deps;
  const {next, changed} = computePrunedHomeStatesAfterUriRemoval({
    current: homeStatesByHubRef.current,
    shouldRemove,
  });
  if (!changed) {
    return;
  }
  homeStatesByHubRef.current = next;
  setHomeStatesByHub(next);
  dispatchWorkspaceAction(
    'homeHistory remove uris',
    model => removeUrisAction(model, shouldRemove),
  );
}

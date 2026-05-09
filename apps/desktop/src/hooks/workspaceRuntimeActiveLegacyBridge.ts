/**
 * Centralizes paired legacy updates for active Today hub URI and active editor tab id (state + ref).
 * Workspace shadow model mirrors remain driven by separate mirror callbacks.
 */
import type {MutableRefObject} from 'react';

import {normalizeWorkspaceUri, type WorkspaceModel} from '../lib/workspaceModel';
import {
  activeSurfaceTabIdFromWorkspaceModel,
} from './workspaceRuntimeProjection';

export type LegacyRuntimeActiveHubSink = {
  ref: MutableRefObject<string | null>;
  setActiveTodayHubUri: (uri: string | null) => void;
};

export type LegacyRuntimeActiveSurfaceTabSink = {
  ref: MutableRefObject<string | null>;
  setActiveEditorTabId: (tabId: string | null) => void;
};

export function workspaceHubUriEqual(a: string | null, b: string | null): boolean {
  if (a === b) {
    return true;
  }
  if (a == null || b == null) {
    return false;
  }
  return normalizeWorkspaceUri(a) === normalizeWorkspaceUri(b);
}

/** Ref first so synchronous readers observe the new hub before React commits. */
export function assignLegacyRuntimeActiveHub(
  hubUri: string | null,
  sink: LegacyRuntimeActiveHubSink,
): void {
  sink.ref.current = hubUri;
  sink.setActiveTodayHubUri(hubUri);
}

/** Ref first so synchronous readers observe the new tab id before React commits. */
export function assignLegacyRuntimeActiveSurfaceTab(
  tabId: string | null,
  sink: LegacyRuntimeActiveSurfaceTabSink,
): void {
  sink.ref.current = tabId;
  sink.setActiveEditorTabId(tabId);
}

/**
 * Matches projection layout effect: conditional React state when diverged, then unconditional ref
 * assignment from the shadow model.
 */
export function reconcileLegacyRuntimeHubSurfaceAfterProjection(args: {
  model: WorkspaceModel;
  activeTodayHubUri: string | null;
  activeEditorTabId: string | null;
  hubSink: LegacyRuntimeActiveHubSink;
  tabSink: LegacyRuntimeActiveSurfaceTabSink;
}): void {
  const hub = args.model.activeHub;
  const tab = activeSurfaceTabIdFromWorkspaceModel(args.model);
  if (!workspaceHubUriEqual(hub, args.activeTodayHubUri)) {
    args.hubSink.setActiveTodayHubUri(hub);
  }
  if (tab !== args.activeEditorTabId) {
    args.tabSink.setActiveEditorTabId(tab);
  }
  args.hubSink.ref.current = hub;
  args.tabSink.ref.current = tab;
}

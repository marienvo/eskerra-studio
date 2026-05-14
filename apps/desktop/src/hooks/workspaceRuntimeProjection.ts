import type {EditorWorkspaceTab} from '../lib/editorWorkspaceTabs';
import type {TodayHubWorkspaceSnapshot} from '../lib/mainWindowUiStore';
import {
  createDefaultWorkspaceState,
  normalizeWorkspaceUri,
  sortedNormalizedHubs,
  type HistoryStack,
  type TabEntry,
  type WorkspaceModel,
  type WorkspaceState,
} from '../lib/workspaceModel';
import type {WorkspaceHomeState} from '../lib/workspaceHomeNavigation';

export type ProjectWorkspaceRuntimeToModelArgs = {
  activeTodayHubUri: string | null;
  editorWorkspaceTabs: readonly EditorWorkspaceTab[];
  activeEditorTabId: string | null;
  /** Inactive-hub tab snapshots; active hub uses live `editorWorkspaceTabs`. */
  legacyHubWorkspaceSnapshots: Record<string, TodayHubWorkspaceSnapshot>;
  homeStatesByHub: Record<string, WorkspaceHomeState>;
  hubUris: readonly string[];
};

function stackFromEditorHistory(history: {
  entries: readonly string[];
  index: number;
}): HistoryStack {
  const entries = history.entries.map(normalizeWorkspaceUri).filter(Boolean);
  if (entries.length === 0) {
    return {entries: [], index: 0};
  }
  let index = Number.isFinite(history.index) ? Math.floor(history.index) : 0;
  if (index < 0 || index >= entries.length) {
    index = entries.length - 1;
  }
  return {entries, index};
}

export function workspaceHomeStateToHistoryStack(state: WorkspaceHomeState): HistoryStack {
  return stackFromEditorHistory(state.history);
}

function tabEntriesFromRuntimeTabs(tabs: readonly EditorWorkspaceTab[]): TabEntry[] {
  return tabs
    .map(t => ({
      id: t.id,
      history: stackFromEditorHistory(t.history),
    }))
    .filter(t => t.id.trim() !== '' && t.history.entries.length > 0);
}

/** Inverse of {@link tabEntriesFromRuntimeTabs} for the active hub (preserves id, entries, index). */
export function editorWorkspaceTabsFromModelTabEntries(
  tabs: readonly TabEntry[],
): EditorWorkspaceTab[] {
  return tabs.map(t => ({
    id: t.id,
    history: {
      entries: [...t.history.entries],
      index: t.history.index,
    },
  }));
}

/** Stable signature for comparing legacy vs model-derived tab strips (ids + normalized histories). */
export function legacyEditorWorkspaceTabsSignature(
  tabs: readonly EditorWorkspaceTab[],
): string {
  return JSON.stringify(
    tabs.map(t => ({
      id: t.id,
      entries: t.history.entries.map(e => normalizeWorkspaceUri(e)),
      index: t.history.index,
    })),
  );
}

function tabEntriesFromStoredSnapshot(snap: TodayHubWorkspaceSnapshot | undefined): TabEntry[] {
  return (snap?.editorWorkspaceTabs ?? [])
    .map(t => ({
      id: t.id,
      history: stackFromEditorHistory({entries: t.entries, index: t.index}),
    }))
    .filter(t => t.id.trim() !== '' && t.history.entries.length > 0);
}

function homeHistoryForHub(
  hub: string,
  snap: TodayHubWorkspaceSnapshot | undefined,
  homeStatesByHub: Record<string, WorkspaceHomeState>,
): HistoryStack {
  const fromRuntime = homeStatesByHub[hub]?.history;
  if (fromRuntime) {
    const stack = stackFromEditorHistory(fromRuntime);
    if (stack.entries[0] === hub) {
      return stack;
    }
  }
  const fromSnapshot = snap?.homeHistory;
  if (fromSnapshot) {
    const stack = stackFromEditorHistory(fromSnapshot);
    if (stack.entries[0] === hub) {
      return stack;
    }
  }
  return createDefaultWorkspaceState(hub).homeHistory;
}

function activeSurfaceForTabs(
  tabs: readonly TabEntry[],
  activeEditorTabId: string | null | undefined,
): WorkspaceState['active'] {
  if (activeEditorTabId === null) {
    return {kind: 'home'};
  }
  if (typeof activeEditorTabId === 'string' && tabs.some(t => t.id === activeEditorTabId)) {
    return {kind: 'tab', id: activeEditorTabId};
  }
  if (activeEditorTabId === undefined && tabs.length > 0) {
    return {kind: 'tab', id: tabs[0]!.id};
  }
  return {kind: 'home'};
}

/**
 * Active editor tab id when the shadow workspace model's active surface is a tab; otherwise null (Home).
 */
export function activeSurfaceTabIdFromWorkspaceModel(m: WorkspaceModel): string | null {
  const h = m.activeHub;
  if (h == null) {
    return null;
  }
  const ws = m.workspaces[h];
  if (ws == null) {
    return null;
  }
  return ws.active.kind === 'tab' ? ws.active.id : null;
}

export type WorkspaceStateForIncomingHubSwitchArgs = {
  hubUri: string;
  nextTabs: readonly EditorWorkspaceTab[];
  nextActive: string | null;
  snapshot: TodayHubWorkspaceSnapshot | undefined;
  homeStatesByHub: Record<string, WorkspaceHomeState>;
};

/**
 * Builds the target hub's {@link WorkspaceState} from the same inputs used during a Today hub
 * workspace switch (restored tab strip + snapshot + live Home stacks). Matches the active-hub
 * branch inside {@link projectWorkspaceRuntimeToModel} without rebuilding other workspaces.
 */
export function workspaceStateForIncomingHubSwitch(
  args: WorkspaceStateForIncomingHubSwitchArgs,
): WorkspaceState {
  const hub = normalizeWorkspaceUri(args.hubUri);
  const tabs = tabEntriesFromRuntimeTabs(args.nextTabs);
  const active = activeSurfaceForTabs(tabs, args.nextActive);
  return {
    tabs,
    active,
    homeHistory: homeHistoryForHub(hub, args.snapshot, args.homeStatesByHub),
  };
}

export function projectWorkspaceRuntimeToModel(
  args: ProjectWorkspaceRuntimeToModelArgs,
): WorkspaceModel {
  const hubs = sortedNormalizedHubs(args.hubUris);
  const workspaces: Record<string, WorkspaceState> = {};
  const activeNorm = args.activeTodayHubUri
    ? normalizeWorkspaceUri(args.activeTodayHubUri)
    : null;
  const activeHub = activeNorm && hubs.includes(activeNorm)
    ? activeNorm
    : hubs[0] ?? null;

  for (const hub of hubs) {
    const snap = args.legacyHubWorkspaceSnapshots[hub];
    const isActiveHub = activeHub === hub;
    const tabs = isActiveHub
      ? tabEntriesFromRuntimeTabs(args.editorWorkspaceTabs)
      : tabEntriesFromStoredSnapshot(snap);
    const active = isActiveHub
      ? activeSurfaceForTabs(tabs, args.activeEditorTabId)
      : activeSurfaceForTabs(tabs, snap?.activeEditorTabId);
    workspaces[hub] = {
      tabs,
      active,
      homeHistory: homeHistoryForHub(hub, snap, args.homeStatesByHub),
    };
  }

  return {activeHub, workspaces};
}

function currentUriFromTab(t: TabEntry): string | null {
  const {entries, index} = t.history;
  if (index < 0 || index >= entries.length) {
    return null;
  }
  return entries[index] ?? null;
}

function formatActive(active: WorkspaceState['active']): string {
  return active.kind === 'home' ? 'home' : `tab:${active.id}`;
}

function describeWorkspaceStateDivergence(
  hub: string,
  expected: WorkspaceState,
  actual: WorkspaceState,
): string[] {
  const out: string[] = [];
  if (formatActive(expected.active) !== formatActive(actual.active)) {
    out.push(`workspace ${hub} active expected=${formatActive(expected.active)} actual=${formatActive(actual.active)}`);
  }
  const expectedTabs = expected.tabs.map(t => `${t.id}:${currentUriFromTab(t) ?? ''}`);
  const actualTabs = actual.tabs.map(t => `${t.id}:${currentUriFromTab(t) ?? ''}`);
  if (expectedTabs.join('|') !== actualTabs.join('|')) {
    out.push(`workspace ${hub} tabs expected=[${expectedTabs.join(',')}] actual=[${actualTabs.join(',')}]`);
  }
  if (
    expected.homeHistory.index !== actual.homeHistory.index
    || expected.homeHistory.entries.join('|') !== actual.homeHistory.entries.join('|')
  ) {
    out.push(
      `workspace ${hub} homeHistory expected=${JSON.stringify(expected.homeHistory)} actual=${JSON.stringify(actual.homeHistory)}`,
    );
  }
  return out;
}

export type ResolveModelBackedLegacyTabStripResult = {
  nextTabs: EditorWorkspaceTab[];
  derivedTabs: EditorWorkspaceTab[] | null;
  matched: boolean;
  mismatch:
    | null
    | {kind: 'signature'; legacySig: string; derivedSig: string}
    | {kind: 'ids'; legacyIds: string[]; derivedIds: string[]};
};

/**
 * Selects between the model-derived tab strip and the legacy computed strip.
 *
 * 'signature' (background open): full history comparison via {@link legacyEditorWorkspaceTabsSignature}.
 * 'ids' (close tab): id/order-only comparison.
 *
 * Returns legacy tabs when no active hub/workspace is present in the model.
 * Does not call console.warn or read process.env — leave those side effects to the caller.
 */
export function resolveModelBackedLegacyTabStrip(
  nextModel: WorkspaceModel,
  nextTabsLegacy: EditorWorkspaceTab[],
  match: 'signature' | 'ids',
): ResolveModelBackedLegacyTabStripResult {
  const hub = nextModel.activeHub;
  const derivedTabs =
    hub != null && nextModel.workspaces[hub] != null
      ? editorWorkspaceTabsFromModelTabEntries(nextModel.workspaces[hub].tabs)
      : null;

  if (derivedTabs == null) {
    return {nextTabs: nextTabsLegacy, derivedTabs: null, matched: false, mismatch: null};
  }

  if (match === 'signature') {
    const legacySig = legacyEditorWorkspaceTabsSignature(nextTabsLegacy);
    const derivedSig = legacyEditorWorkspaceTabsSignature(derivedTabs);
    const matched = derivedSig === legacySig;
    return {
      nextTabs: matched ? derivedTabs : nextTabsLegacy,
      derivedTabs,
      matched,
      mismatch: matched ? null : {kind: 'signature', legacySig, derivedSig},
    };
  }

  const legacyIds = nextTabsLegacy.map(t => t.id);
  const derivedIds = derivedTabs.map(t => t.id);
  const matched =
    derivedIds.length === legacyIds.length &&
    derivedIds.every((id, i) => id === legacyIds[i]);
  return {
    nextTabs: matched ? derivedTabs : nextTabsLegacy,
    derivedTabs,
    matched,
    mismatch: matched ? null : {kind: 'ids', legacyIds, derivedIds},
  };
}

export function describeWorkspaceModelDivergence(
  expected: WorkspaceModel,
  actual: WorkspaceModel,
): string[] {
  const out: string[] = [];
  if (expected.activeHub !== actual.activeHub) {
    out.push(`activeHub expected=${expected.activeHub ?? 'null'} actual=${actual.activeHub ?? 'null'}`);
  }
  const hubs = sortedNormalizedHubs([
    ...Object.keys(expected.workspaces),
    ...Object.keys(actual.workspaces),
  ]);
  for (const hub of hubs) {
    const e = expected.workspaces[hub];
    const a = actual.workspaces[hub];
    if (!e || !a) {
      out.push(`workspace ${hub} presence expected=${e ? 'yes' : 'no'} actual=${a ? 'yes' : 'no'}`);
      continue;
    }
    out.push(...describeWorkspaceStateDivergence(hub, e, a));
  }
  return out;
}

import type {EditorWorkspaceTab} from '../lib/editorWorkspaceTabs';
import type {TodayHubWorkspaceSnapshot} from '../lib/mainWindowUiStore';
import {
  createDefaultWorkspaceState,
  normalizeWorkspaceUri,
  type HistoryStack,
  type TabEntry,
  type WorkspaceModel,
  type WorkspaceState,
} from '../lib/workspaceModel';
import type {WorkspaceHomeState} from '../lib/workspaceHomeNavigation';

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

export function activeEditorWorkspaceTabsFromWorkspaceModel(
  m: WorkspaceModel,
): EditorWorkspaceTab[] {
  const hub = m.activeHub;
  if (hub == null) {
    return [];
  }
  const ws = m.workspaces[hub];
  if (ws == null) {
    return [];
  }
  return editorWorkspaceTabsFromModelTabEntries(ws.tabs);
}

export function workspaceHomeStatesFromWorkspaceModel(
  m: WorkspaceModel,
): Record<string, WorkspaceHomeState> {
  const out: Record<string, WorkspaceHomeState> = {};
  for (const [hub, ws] of Object.entries(m.workspaces)) {
    out[hub] = {
      history: {
        entries: [...ws.homeHistory.entries],
        index: ws.homeHistory.index,
      },
    };
  }
  return out;
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

export function workspaceHomeStatesSignature(
  states: Record<string, WorkspaceHomeState>,
): string {
  return JSON.stringify(
    Object.entries(states)
      .map(([hub, state]) => ({
        hub: normalizeWorkspaceUri(hub),
        entries: state.history.entries.map(e => normalizeWorkspaceUri(e)),
        index: state.history.index,
      }))
      .sort((a, b) => a.hub.localeCompare(b.hub)),
  );
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

/**
 * Tab strip for shell/chrome: workspace model when `activeHub` is set; otherwise legacy React
 * state (vaults with Inbox notes but no `Today.md` never get `activeHub`).
 */
export function tabsControllerEditorSurface(
  activeHub: string | null,
  modelTabs: readonly EditorWorkspaceTab[],
  modelActiveId: string | null,
  legacyTabs: readonly EditorWorkspaceTab[],
  legacyActiveId: string | null,
): readonly [readonly EditorWorkspaceTab[], string | null] {
  return activeHub != null
    ? [modelTabs, modelActiveId]
    : [legacyTabs, legacyActiveId];
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
 * workspace switch (restored tab strip + snapshot + live Home stacks).
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

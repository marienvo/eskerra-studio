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
  todayHubWorkspacesForSave: Record<string, TodayHubWorkspaceSnapshot>;
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

function tabEntriesFromRuntimeTabs(tabs: readonly EditorWorkspaceTab[]): TabEntry[] {
  return tabs
    .map(t => ({
      id: t.id,
      history: stackFromEditorHistory(t.history),
    }))
    .filter(t => t.id.trim() !== '' && t.history.entries.length > 0);
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
    const snap = args.todayHubWorkspacesForSave[hub];
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
    if (formatActive(e.active) !== formatActive(a.active)) {
      out.push(`workspace ${hub} active expected=${formatActive(e.active)} actual=${formatActive(a.active)}`);
    }
    const eTabs = e.tabs.map(t => `${t.id}:${currentUriFromTab(t) ?? ''}`);
    const aTabs = a.tabs.map(t => `${t.id}:${currentUriFromTab(t) ?? ''}`);
    if (eTabs.join('|') !== aTabs.join('|')) {
      out.push(`workspace ${hub} tabs expected=[${eTabs.join(',')}] actual=[${aTabs.join(',')}]`);
    }
    if (
      e.homeHistory.index !== a.homeHistory.index
      || e.homeHistory.entries.join('|') !== a.homeHistory.entries.join('|')
    ) {
      out.push(
        `workspace ${hub} homeHistory expected=${JSON.stringify(e.homeHistory)} actual=${JSON.stringify(a.homeHistory)}`,
      );
    }
  }
  return out;
}

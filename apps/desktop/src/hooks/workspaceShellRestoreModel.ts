/**
 * JSON→model path for inbox shell restore.
 *
 * Replaces the legacy `mergeStoredHubWorkspaces` + `projectWorkspaceRuntimeToModel` route:
 * `parseWorkspaceModelFromPersistence` is the single canonical parser for persisted
 * `todayHubWorkspaces` (handles URI key normalization, hub-echo row dropping, and per-hub
 * `homeHistory` parsing). {@link useInboxShellRestore} applies `sanitizeTodayHubWorkspacesWithStoredTabFilter`
 * before this path so inactive hubs match the same vault markdown tab rules as the live strip.
 * The active hub's tabs/active surface are then overridden from the live editor tab strip, because
 * that strip is the source of truth at restore time.
 */
import type {EditorWorkspaceTab} from '../lib/editorWorkspaceTabs';
import type {TodayHubWorkspaceSnapshot} from '../lib/mainWindowUiStore';
import type {WorkspaceHomeState} from '../lib/workspaceHomeNavigation';
import {
  normalizeWorkspaceUri,
  parseWorkspaceModelFromPersistence,
  type TabEntry,
  type WorkspaceModel,
  type WorkspaceState,
} from '../lib/workspaceModel';

export type RestoreShadowWorkspaceModelArgs = {
  hubUris: readonly string[];
  activeTodayHubUri: string | null;
  todayHubWorkspaces: Record<string, TodayHubWorkspaceSnapshot> | null | undefined;
  editorWorkspaceTabs: readonly EditorWorkspaceTab[];
  activeEditorTabId: string | null;
  homeStatesByHub: Record<string, WorkspaceHomeState>;
};

function tabEntriesFromLiveTabs(tabs: readonly EditorWorkspaceTab[]): TabEntry[] {
  const out: TabEntry[] = [];
  for (const t of tabs) {
    if (t.id.trim() === '' || t.history.entries.length === 0) {
      continue;
    }
    out.push({
      id: t.id,
      history: {entries: [...t.history.entries], index: t.history.index},
    });
  }
  return out;
}

function activeSurfaceFromLive(
  tabs: readonly TabEntry[],
  activeEditorTabId: string | null,
): WorkspaceState['active'] {
  if (activeEditorTabId == null) {
    return {kind: 'home'};
  }
  if (tabs.some(t => t.id === activeEditorTabId)) {
    return {kind: 'tab', id: activeEditorTabId};
  }
  return {kind: 'home'};
}

function pickHomeHistoryForHub(
  hub: string,
  parsed: WorkspaceState,
  homeStatesByHub: Record<string, WorkspaceHomeState>,
): WorkspaceState['homeHistory'] {
  const hubNorm = normalizeWorkspaceUri(hub);
  const runtime =
    homeStatesByHub[hub]?.history ?? homeStatesByHub[hubNorm]?.history;
  if (
    runtime
    && runtime.entries.length > 0
    && normalizeWorkspaceUri(runtime.entries[0]!) === hubNorm
  ) {
    let index = Number.isFinite(runtime.index) ? Math.floor(runtime.index) : 0;
    if (index < 0 || index >= runtime.entries.length) {
      index = runtime.entries.length - 1;
    }
    return {entries: [...runtime.entries], index};
  }
  return parsed.homeHistory;
}

export function restoreShadowWorkspaceModelFromInboxState(
  args: RestoreShadowWorkspaceModelArgs,
): WorkspaceModel {
  const parsed = parseWorkspaceModelFromPersistence({
    hubUris: args.hubUris,
    activeTodayHubUri: args.activeTodayHubUri,
    todayHubWorkspaces: args.todayHubWorkspaces as
      | Record<string, unknown>
      | null
      | undefined,
  });

  const activeHub = parsed.activeHub;
  if (activeHub == null) {
    return parsed;
  }

  const workspaces: Record<string, WorkspaceState> = {};
  for (const [hub, ws] of Object.entries(parsed.workspaces)) {
    if (hub === activeHub) {
      const liveTabs = tabEntriesFromLiveTabs(args.editorWorkspaceTabs);
      workspaces[hub] = {
        tabs: liveTabs,
        active: activeSurfaceFromLive(liveTabs, args.activeEditorTabId),
        homeHistory: pickHomeHistoryForHub(hub, ws, args.homeStatesByHub),
      };
    } else {
      workspaces[hub] = {
        tabs: ws.tabs,
        active: ws.active,
        homeHistory: pickHomeHistoryForHub(hub, ws, args.homeStatesByHub),
      };
    }
  }
  return {activeHub, workspaces};
}

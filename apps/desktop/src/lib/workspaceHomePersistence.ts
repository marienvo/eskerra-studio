/**
 * Adapters between runtime {@link WorkspaceHomeState} and persisted hub snapshots
 * (`todayHubWorkspaces[hub].homeHistory`), using {@link parseWorkspaceModelFromPersistence}
 * as the canonical parser for disk JSON.
 */

import type {EditorDocumentHistoryState} from './editorDocumentHistory';
import {
  createWorkspaceHomeState,
  type WorkspaceHomeState,
} from './workspaceHomeNavigation';
import {parseWorkspaceModelFromPersistence} from './workspaceModel/persistence';

export function hydrateWorkspaceHomeStatesFromPersisted(args: {
  hubUris: readonly string[];
  activeTodayHubUri: string | null;
  todayHubWorkspaces: Record<string, unknown> | null | undefined;
}): Record<string, WorkspaceHomeState> {
  const model = parseWorkspaceModelFromPersistence({
    hubUris: args.hubUris,
    activeTodayHubUri: args.activeTodayHubUri ?? undefined,
    todayHubWorkspaces: args.todayHubWorkspaces ?? null,
  });
  const out: Record<string, WorkspaceHomeState> = {};
  for (const hub of args.hubUris) {
    const ws = model.workspaces[hub];
    if (!ws) {
      out[hub] = createWorkspaceHomeState(hub);
      continue;
    }
    out[hub] = {
      history: {
        entries: [...ws.homeHistory.entries],
        index: ws.homeHistory.index,
      },
    };
  }
  return out;
}

/** Optional `homeHistory` for `TodayHubWorkspaceSnapshot` when loading desktop JSON. */
export function parseTodayHubSnapshotHomeHistoryForStore(
  hubUri: string,
  snap: Record<string, unknown>,
): EditorDocumentHistoryState | undefined {
  if (!Object.prototype.hasOwnProperty.call(snap, 'homeHistory')) {
    return undefined;
  }
  const model = parseWorkspaceModelFromPersistence({
    hubUris: [hubUri],
    activeTodayHubUri: hubUri,
    todayHubWorkspaces: {[hubUri]: snap},
  });
  const ws = model.workspaces[hubUri];
  if (!ws || ws.homeHistory.entries.length === 0) {
    return undefined;
  }
  return {
    entries: [...ws.homeHistory.entries],
    index: ws.homeHistory.index,
  };
}

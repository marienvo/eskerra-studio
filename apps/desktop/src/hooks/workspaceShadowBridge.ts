/**
 * WorkspaceModel migration bridge: runtime projection → shadow replacement + DEV divergence checks,
 * plus shadow model mirror factories (verification-only shadow stays aligned with legacy UI state).
 */
import type {EditorWorkspaceTab} from '../lib/editorWorkspaceTabs';
import type {TodayHubWorkspaceSnapshot} from '../lib/mainWindowUiStore';
import type {WorkspaceHomeState} from '../lib/workspaceHomeNavigation';
import {
  activateTabAction,
  createDefaultWorkspaceState,
  normalizeWorkspaceUri,
  selectWorkspaceAction,
  type TabEntry,
  type WorkspaceModel,
  sortedNormalizedHubs,
} from '../lib/workspaceModel';
import {
  describeWorkspaceModelDivergence,
  workspaceHomeStateToHistoryStack,
} from './workspaceRuntimeProjection';

export type DispatchWorkspaceModelAction = (
  actionDescription: string,
  updater: (current: WorkspaceModel) => WorkspaceModel,
) => void;

export function createWorkspaceShadowMirrorCallbacks(
  dispatchWorkspaceAction: DispatchWorkspaceModelAction,
) {
  const replaceShadowHomeStateForHub = (
    hubUri: string,
    state: WorkspaceHomeState,
    reason: string,
  ) => {
    const hub = normalizeWorkspaceUri(hubUri);
    dispatchWorkspaceAction(reason, (model: WorkspaceModel): WorkspaceModel => {
      const current = model.workspaces[hub] ?? createDefaultWorkspaceState(hub);
      return {
        ...model,
        activeHub: model.activeHub ?? hub,
        workspaces: {
          ...model.workspaces,
          [hub]: {
            ...current,
            homeHistory: workspaceHomeStateToHistoryStack(state),
          },
        },
      };
    });
  };

  const mirrorShadowActiveHub = (hubUri: string | null, reason: string) => {
    dispatchWorkspaceAction(reason, model => {
      if (hubUri == null) {
        return {...model, activeHub: null, workspaces: {}};
      }
      const hub = normalizeWorkspaceUri(hubUri);
      if (model.activeHub === hub) {
        return model;
      }
      return selectWorkspaceAction(model, hub);
    });
  };

  const mirrorShadowHomeSurface = (reason: string) => {
    dispatchWorkspaceAction(reason, model => {
      const hub = model.activeHub;
      if (hub == null) {
        return model;
      }
      const current = model.workspaces[hub];
      if (current == null || current.active.kind === 'home') {
        return model;
      }
      return {
        ...model,
        workspaces: {
          ...model.workspaces,
          [hub]: {...current, active: {kind: 'home'}},
        },
      };
    });
  };

  const mirrorShadowActiveTab = (tabId: string, reason: string) => {
    dispatchWorkspaceAction(reason, model => activateTabAction(model, tabId));
  };

  const mirrorShadowActiveWorkspaceTabs = (
    tabs: readonly EditorWorkspaceTab[],
    activeId: string | null,
    reason: string,
  ) => {
    const shadowTabs: TabEntry[] = tabs
      .map(t => ({
        id: t.id,
        history: {
          entries: t.history.entries.map(normalizeWorkspaceUri).filter(Boolean),
          index: t.history.index,
        },
      }))
      .filter(t => t.id.trim() !== '' && t.history.entries.length > 0);
    dispatchWorkspaceAction(reason, model => {
      const hub = model.activeHub;
      if (hub == null) {
        return model;
      }
      const current = model.workspaces[hub];
      if (current == null) {
        return model;
      }
      const active = activeId != null && shadowTabs.some(t => t.id === activeId)
        ? {kind: 'tab' as const, id: activeId}
        : {kind: 'home' as const};
      return {
        ...model,
        workspaces: {
          ...model.workspaces,
          [hub]: {
            ...current,
            tabs: shadowTabs,
            active,
          },
        },
      };
    });
  };

  return {
    replaceShadowHomeStateForHub,
    mirrorShadowActiveHub,
    mirrorShadowHomeSurface,
    mirrorShadowActiveTab,
    mirrorShadowActiveWorkspaceTabs,
  };
}

export function resolveTodayHubWorkspacesForProjection(args: {
  legacyTodayHubWorkspaces: Record<string, TodayHubWorkspaceSnapshot>;
  restoredTodayHubWorkspaces: Record<string, TodayHubWorkspaceSnapshot> | null | undefined;
}): Record<string, TodayHubWorkspaceSnapshot> {
  return Object.keys(args.legacyTodayHubWorkspaces).length === 0
    ? args.restoredTodayHubWorkspaces ?? args.legacyTodayHubWorkspaces
    : args.legacyTodayHubWorkspaces;
}

export function computeProjectionHubUris(args: {
  workspaceModelHubUris: readonly string[];
  restoredInboxState: null | {
    todayHubWorkspaces?: Record<string, TodayHubWorkspaceSnapshot> | null;
  };
}): readonly string[] {
  const restoredHubs = args.restoredInboxState
    ? Object.keys(
        args.restoredInboxState.todayHubWorkspaces as Record<string, TodayHubWorkspaceSnapshot>,
      )
    : [];
  if (restoredHubs.length === 0 || args.workspaceModelHubUris.length >= restoredHubs.length) {
    return args.workspaceModelHubUris;
  }
  return sortedNormalizedHubs([...args.workspaceModelHubUris, ...restoredHubs]);
}

export function resolveProjectionActiveHubUri(args: {
  activeTodayHubUri: string | null;
  restoredActiveTodayHubUri: string | null | undefined;
}): string | null {
  return args.activeTodayHubUri ?? args.restoredActiveTodayHubUri ?? null;
}

export function scheduleDevWorkspaceShadowModelDivergenceCheck(args: {
  devOrTest: boolean;
  projected: WorkspaceModel;
  readShadowModel: () => WorkspaceModel;
}): void {
  if (!args.devOrTest) {
    return;
  }
  queueMicrotask(() => {
    const diffs = describeWorkspaceModelDivergence(
      args.projected,
      args.readShadowModel(),
    );
    if (diffs.length > 0) {
      console.warn('[workspaceModel] shadow divergence', diffs);
    }
  });
}

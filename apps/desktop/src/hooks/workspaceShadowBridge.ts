/**
 * WorkspaceModel migration bridge: runtime projection → shadow replacement + DEV divergence checks.
 */
import type {TodayHubWorkspaceSnapshot} from '../lib/mainWindowUiStore';
import {sortedNormalizedHubs, type WorkspaceModel} from '../lib/workspaceModel';
import {describeWorkspaceModelDivergence} from './workspaceRuntimeProjection';

export function resolveTodayHubWorkspacesForProjection(args: {
  todayHubWorkspacesForSave: Record<string, TodayHubWorkspaceSnapshot>;
  restoredTodayHubWorkspaces: Record<string, TodayHubWorkspaceSnapshot> | null | undefined;
}): Record<string, TodayHubWorkspaceSnapshot> {
  return Object.keys(args.todayHubWorkspacesForSave).length === 0
    ? args.restoredTodayHubWorkspaces ?? args.todayHubWorkspacesForSave
    : args.todayHubWorkspacesForSave;
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

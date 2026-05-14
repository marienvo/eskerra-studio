/**
 * WorkspaceModel migration bridge: model-derived persistence vs legacy runtime persistence (DEV/test).
 */
import {
  describeWorkspacePersistenceDivergence,
  filterPersistenceDivergenceDiffsExcludingKnownTiming,
  type PersistenceTimingDivergenceContext,
  type RuntimePersistencePayload,
} from '../lib/workspacePersistenceShadow';
import {
  serializeWorkspaceModelToPersistence,
  type SerializedWorkspacePersistence,
  type WorkspaceModel,
} from '../lib/workspaceModel';

export function deriveModelDerivedPersistencePayload(
  workspaceShadowModel: WorkspaceModel,
): SerializedWorkspacePersistence {
  return serializeWorkspaceModelToPersistence(workspaceShadowModel);
}

export function describeFilteredLegacyVsModelPersistenceDivergence(
  modelDerivedPersistence: SerializedWorkspacePersistence,
  legacyRuntimePayload: RuntimePersistencePayload,
  timingContext: PersistenceTimingDivergenceContext,
): string[] {
  const raw = describeWorkspacePersistenceDivergence(
    modelDerivedPersistence,
    legacyRuntimePayload,
  );
  return filterPersistenceDivergenceDiffsExcludingKnownTiming(raw, timingContext);
}

/**
 * Collects shadow-model divergence diagnostics for DEV/test use.
 * Returns `{suppress: true}` when preconditions are not met so the caller
 * can skip the `console.warn` without inspecting `diffs`.
 */
export function collectShadowDivergenceDevDiagnostics(params: {
  inboxShellRestored: boolean;
  isDevOrTest: boolean;
  shadowModelActiveHub: string | null;
  modelDerivedPersistence: SerializedWorkspacePersistence;
  legacyRuntimePayload: RuntimePersistencePayload;
  hubForProjection: string | null;
  restoredActiveTodayHubUri: string | null;
  todayHubWorkspacesForProjection: Record<string, unknown>;
}): {diffs: string[]; suppress: boolean} {
  const {
    inboxShellRestored,
    isDevOrTest,
    shadowModelActiveHub,
    modelDerivedPersistence,
    legacyRuntimePayload,
    hubForProjection,
    restoredActiveTodayHubUri,
    todayHubWorkspacesForProjection,
  } = params;
  if (!inboxShellRestored || !isDevOrTest || shadowModelActiveHub === null) {
    return {diffs: [], suppress: true};
  }
  const modelHubKeys = new Set(Object.keys(modelDerivedPersistence.todayHubWorkspaces));
  const legacyHubKeys = new Set(Object.keys(legacyRuntimePayload.todayHubWorkspaces));
  const hasPendingProjectionHubs = Object.keys(todayHubWorkspacesForProjection).some(
    hub => !modelHubKeys.has(hub),
  );
  const diffs = describeFilteredLegacyVsModelPersistenceDivergence(
    modelDerivedPersistence,
    legacyRuntimePayload,
    {
      activeHub: shadowModelActiveHub,
      runtimeActiveHub: legacyRuntimePayload.activeTodayHubUri,
      projectionActiveHub: hubForProjection,
      restoredActiveHub: restoredActiveTodayHubUri,
      modelHubKeys,
      legacyHubKeys,
      hasPendingProjectionHubs,
    },
  );
  return {diffs, suppress: false};
}

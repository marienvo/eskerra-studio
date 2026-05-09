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

/**
 * Model-derived persistence payload: serializes the shadow `WorkspaceModel` for disk persistence.
 */
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

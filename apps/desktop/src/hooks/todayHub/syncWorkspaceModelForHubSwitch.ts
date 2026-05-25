import type {EditorWorkspaceTab} from '../../lib/editorWorkspaceTabs';
import type {TodayHubWorkspaceSnapshot} from '../../lib/mainWindowUiStore';
import type {WorkspaceHomeState} from '../../lib/workspaceHomeNavigation';
import {
  applyIncomingHubWorkspaceAction,
  normalizeWorkspaceUri,
  type WorkspaceModel,
} from '../../lib/workspaceModel';
import {workspaceStateForIncomingHubSwitch} from '../workspaceRuntimeProjection';

export type HubSwitchWorkspacePayload = {
  outgoing?: {
    hubUri: string;
    nextTabs: readonly EditorWorkspaceTab[];
    nextActive: string | null;
    snapshot: TodayHubWorkspaceSnapshot;
  };
  incoming: {
    hubUri: string;
    nextTabs: readonly EditorWorkspaceTab[];
    nextActive: string | null;
    snapshot: TodayHubWorkspaceSnapshot | undefined;
  };
};

export function reduceWorkspaceModelForHubSwitch(
  model: WorkspaceModel,
  payload: HubSwitchWorkspacePayload,
  homeStatesByHub: Record<string, WorkspaceHomeState>,
): WorkspaceModel {
  let next = model;
  if (payload.outgoing) {
    const outgoingWs = workspaceStateForIncomingHubSwitch({
      hubUri: payload.outgoing.hubUri,
      nextTabs: payload.outgoing.nextTabs,
      nextActive: payload.outgoing.nextActive,
      snapshot: payload.outgoing.snapshot,
      homeStatesByHub,
    });
    const hub = normalizeWorkspaceUri(payload.outgoing.hubUri);
    next = {
      ...next,
      workspaces: {
        ...next.workspaces,
        [hub]: outgoingWs,
      },
    };
  }
  return applyIncomingHubWorkspaceAction(
    next,
    payload.incoming.hubUri,
    workspaceStateForIncomingHubSwitch({
      hubUri: payload.incoming.hubUri,
      nextTabs: payload.incoming.nextTabs,
      nextActive: payload.incoming.nextActive,
      snapshot: payload.incoming.snapshot,
      homeStatesByHub,
    }),
  );
}

/**
 * Today Hub per-hub home navigation history (legacy React state + shadow mirror).
 */
import {useCallback, useLayoutEffect, useRef, useState} from 'react';

import {
  createWorkspaceHomeState,
  pushHomeNavigate,
  type WorkspaceHomeState,
} from '../../lib/workspaceHomeNavigation';
import {
  remapPrefixAction,
  removeUrisAction,
  type WorkspaceModel,
} from '../../lib/workspaceModel';
import {workspaceHomeStatesFromWorkspaceModel} from '../workspaceRuntimeProjection';

export type UseTodayHubHomeStateArgs = {
  dispatchWorkspaceActionSync: (
    reason: string,
    reduce: (model: WorkspaceModel) => WorkspaceModel,
  ) => WorkspaceModel;
  replaceShadowHomeStateForHub: (
    hubUri: string,
    state: WorkspaceHomeState,
    reason: string,
  ) => void;
};

export function useTodayHubHomeState({
  dispatchWorkspaceActionSync,
  replaceShadowHomeStateForHub,
}: UseTodayHubHomeStateArgs) {
  const [homeStatesByHub, setHomeStatesByHub] = useState<
    Record<string, WorkspaceHomeState>
  >({});
  const homeStatesByHubRef = useRef<Record<string, WorkspaceHomeState>>({});

  useLayoutEffect(() => {
    homeStatesByHubRef.current = homeStatesByHub;
  }, [homeStatesByHub]);

  const replaceHomeStatesByHub = useCallback(
    (next: Record<string, WorkspaceHomeState>) => {
      homeStatesByHubRef.current = next;
      setHomeStatesByHub(next);
    },
    [],
  );

  const projectHomeStatesFromModel = useCallback(
    (nextModel: WorkspaceModel) => {
      replaceHomeStatesByHub(workspaceHomeStatesFromWorkspaceModel(nextModel));
    },
    [replaceHomeStatesByHub],
  );

  const remapHomeStatesPrefix = useCallback(
    (oldPrefix: string, newPrefix: string) => {
      if (oldPrefix === newPrefix) {
        return;
      }
      const nextModel = dispatchWorkspaceActionSync(
        'remap vault uri prefix',
        m => remapPrefixAction(m, oldPrefix, newPrefix),
      );
      projectHomeStatesFromModel(nextModel);
    },
    [dispatchWorkspaceActionSync, projectHomeStatesFromModel],
  );

  const removeHomeHistoryUris = useCallback(
    (shouldRemove: (normalizedUri: string) => boolean) => {
      const nextModel = dispatchWorkspaceActionSync(
        'remove uris',
        m => removeUrisAction(m, shouldRemove),
      );
      projectHomeStatesFromModel(nextModel);
    },
    [dispatchWorkspaceActionSync, projectHomeStatesFromModel],
  );

  const setHomeStateForHub = useCallback(
    (hubUri: string, state: WorkspaceHomeState) => {
      const next = {
        ...homeStatesByHubRef.current,
        [hubUri]: state,
      };
      replaceHomeStatesByHub(next);
      replaceShadowHomeStateForHub(hubUri, state, 'homeHistory set');
    },
    [replaceHomeStatesByHub, replaceShadowHomeStateForHub],
  );

  const pushHomeHistoryForHub = useCallback(
    (hubUri: string, targetUri: string) => {
      const currentHome =
        homeStatesByHubRef.current[hubUri] ?? createWorkspaceHomeState(hubUri);
      setHomeStateForHub(hubUri, pushHomeNavigate(currentHome, targetUri));
    },
    [setHomeStateForHub],
  );

  return {
    homeStatesByHubRef,
    replaceHomeStatesByHub,
    projectHomeStatesFromModel,
    remapHomeStatesPrefix,
    removeHomeHistoryUris,
    setHomeStateForHub,
    pushHomeHistoryForHub,
  };
}

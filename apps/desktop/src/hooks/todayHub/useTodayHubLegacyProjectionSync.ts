/**
 * Sync shadow workspace model projections into legacy Today Hub / tab React state.
 */
import {useLayoutEffect, type Dispatch, type MutableRefObject, type SetStateAction} from 'react';

import type {EditorWorkspaceTab} from '../../lib/editorWorkspaceTabs';
import {syncHubWorkspacesToVaultTodayRefsAction, type WorkspaceModel} from '../../lib/workspaceModel';
import type {WorkspaceHomeState} from '../../lib/workspaceHomeNavigation';
import {
  legacyEditorWorkspaceTabsSignature,
  workspaceHomeStatesSignature,
} from '../workspaceRuntimeProjection';
import {workspaceHubUriEqual} from './workspaceHubUriEqual';

export type UseTodayHubLegacyProjectionSyncArgs = {
  inboxShellRestored: boolean;
  vaultRoot: string | null;
  vaultMarkdownRefsReady: boolean;
  workspaceModelHubUris: readonly string[];
  workspaceShadowModel: WorkspaceModel;
  dispatchWorkspaceActionSync: (
    reason: string,
    reduce: (model: WorkspaceModel) => WorkspaceModel,
  ) => WorkspaceModel;
  activeTodayHubUriRef: MutableRefObject<string | null>;
  setActiveTodayHubUri: Dispatch<SetStateAction<string | null>>;
  modelActiveTodayHubUri: string | null;
  modelActiveEditorTabId: string | null;
  modelEditorWorkspaceTabs: readonly EditorWorkspaceTab[];
  modelHomeStatesByHub: Record<string, WorkspaceHomeState>;
  editorWorkspaceTabsRef: MutableRefObject<EditorWorkspaceTab[]>;
  activeEditorTabIdRef: MutableRefObject<string | null>;
  replaceEditorWorkspaceTabs: (nextTabs: EditorWorkspaceTab[]) => void;
  setActiveEditorTabId: Dispatch<SetStateAction<string | null>>;
  homeStatesByHubRef: MutableRefObject<Record<string, WorkspaceHomeState>>;
  replaceHomeStatesByHub: (next: Record<string, WorkspaceHomeState>) => void;
};

export function useTodayHubLegacyProjectionSync(
  args: UseTodayHubLegacyProjectionSyncArgs,
): void {
  const {
    inboxShellRestored,
    vaultRoot,
    vaultMarkdownRefsReady,
    workspaceModelHubUris,
    workspaceShadowModel,
    dispatchWorkspaceActionSync,
    activeTodayHubUriRef,
    setActiveTodayHubUri,
    modelActiveTodayHubUri,
    modelActiveEditorTabId,
    modelEditorWorkspaceTabs,
    modelHomeStatesByHub,
    editorWorkspaceTabsRef,
    activeEditorTabIdRef,
    replaceEditorWorkspaceTabs,
    setActiveEditorTabId,
    homeStatesByHubRef,
    replaceHomeStatesByHub,
  } = args;

  useLayoutEffect(() => {
    if (!inboxShellRestored) {
      return;
    }
    if (vaultRoot != null && !vaultMarkdownRefsReady) {
      return;
    }
    dispatchWorkspaceActionSync('sync today hub workspaces to vault refs', m =>
      syncHubWorkspacesToVaultTodayRefsAction(m, workspaceModelHubUris),
    );
  }, [
    inboxShellRestored,
    workspaceModelHubUris,
    vaultRoot,
    vaultMarkdownRefsReady,
    workspaceShadowModel,
    dispatchWorkspaceActionSync,
  ]);

  useLayoutEffect(() => {
    if (!inboxShellRestored) {
      return;
    }
    if (!workspaceHubUriEqual(activeTodayHubUriRef.current, modelActiveTodayHubUri)) {
      activeTodayHubUriRef.current = modelActiveTodayHubUri;
      setActiveTodayHubUri(modelActiveTodayHubUri);
    }
    if (modelActiveTodayHubUri != null) {
      const legacyTabsSig = legacyEditorWorkspaceTabsSignature(
        editorWorkspaceTabsRef.current,
      );
      const modelTabsSig = legacyEditorWorkspaceTabsSignature(modelEditorWorkspaceTabs);
      if (legacyTabsSig !== modelTabsSig) {
        replaceEditorWorkspaceTabs([...modelEditorWorkspaceTabs]);
      }
      if (activeEditorTabIdRef.current !== modelActiveEditorTabId) {
        activeEditorTabIdRef.current = modelActiveEditorTabId;
        setActiveEditorTabId(modelActiveEditorTabId);
      }
    }
    if (
      workspaceHomeStatesSignature(homeStatesByHubRef.current) !==
      workspaceHomeStatesSignature(modelHomeStatesByHub)
    ) {
      replaceHomeStatesByHub(modelHomeStatesByHub);
    }
  }, [
    inboxShellRestored,
    modelActiveTodayHubUri,
    modelActiveEditorTabId,
    modelEditorWorkspaceTabs,
    modelHomeStatesByHub,
    activeEditorTabIdRef,
    activeTodayHubUriRef,
    editorWorkspaceTabsRef,
    replaceEditorWorkspaceTabs,
    replaceHomeStatesByHub,
    setActiveEditorTabId,
    setActiveTodayHubUri,
  ]);
}

/**
 * Pick and seed the default active Today hub when vault refs change.
 */
import {useEffect, type Dispatch, type MutableRefObject, type SetStateAction} from 'react';

import {sortedTodayHubNoteUrisFromRefs, type VaultMarkdownRef} from '@eskerra/core';

import {tabsToStored, type EditorWorkspaceTab} from '../../lib/editorWorkspaceTabs';
import {pickDefaultActiveTodayHubUri} from '../../lib/todayHub/todayHubWorkspaceRestore';

export type UseTodayHubDefaultActiveHubEffectArgs = {
  vaultRoot: string | null;
  inboxShellRestored: boolean;
  vaultMarkdownRefs: readonly VaultMarkdownRef[];
  modelActiveTodayHubUri: string | null;
  activeTodayHubUriRef: MutableRefObject<string | null>;
  setActiveTodayHubUri: Dispatch<SetStateAction<string | null>>;
  selectedUriRef: MutableRefObject<string | null>;
  editorWorkspaceTabsRef: MutableRefObject<EditorWorkspaceTab[]>;
  activeEditorTabIdRef: MutableRefObject<string | null>;
  mirrorShadowActiveHub: (hubUri: string | null, reason: string) => void;
  mirrorShadowActiveWorkspaceTabs: (
    tabs: readonly EditorWorkspaceTab[],
    activeId: string | null,
    reason: string,
  ) => void;
  switchTodayHubWorkspace: (todayNoteUri: string) => Promise<void>;
};

export function useTodayHubDefaultActiveHubEffect(
  args: UseTodayHubDefaultActiveHubEffectArgs,
): void {
  const {
    vaultRoot,
    inboxShellRestored,
    vaultMarkdownRefs,
    modelActiveTodayHubUri,
    activeTodayHubUriRef,
    setActiveTodayHubUri,
    selectedUriRef,
    editorWorkspaceTabsRef,
    activeEditorTabIdRef,
    mirrorShadowActiveHub,
    mirrorShadowActiveWorkspaceTabs,
    switchTodayHubWorkspace,
  } = args;

  useEffect(() => {
    if (!vaultRoot || !inboxShellRestored || vaultMarkdownRefs.length === 0) {
      return;
    }
    const hubs = sortedTodayHubNoteUrisFromRefs(vaultMarkdownRefs);
    if (hubs.length === 0) {
      return;
    }
    const cur = modelActiveTodayHubUri;
    if (cur != null && hubs.includes(cur)) {
      return;
    }
    if (cur != null && !hubs.includes(cur)) {
      switchTodayHubWorkspace(hubs[0]!).catch(() => undefined);
      return;
    }
    const pick =
      pickDefaultActiveTodayHubUri({
        hubUris: hubs,
        selectedUri: selectedUriRef.current,
        editorWorkspaceTabs: tabsToStored(editorWorkspaceTabsRef.current),
        openTabUris: null,
      }) ?? hubs[0]!;
    activeTodayHubUriRef.current = pick;
    setActiveTodayHubUri(pick);
    mirrorShadowActiveHub(pick, 'default active hub');
    mirrorShadowActiveWorkspaceTabs(
      editorWorkspaceTabsRef.current,
      activeEditorTabIdRef.current,
      'seed shadow tabs from legacy on first default hub',
    );
  }, [
    vaultRoot,
    inboxShellRestored,
    vaultMarkdownRefs,
    modelActiveTodayHubUri,
    mirrorShadowActiveHub,
    mirrorShadowActiveWorkspaceTabs,
    switchTodayHubWorkspace,
    selectedUriRef,
    editorWorkspaceTabsRef,
    activeEditorTabIdRef,
    activeTodayHubUriRef,
    setActiveTodayHubUri,
  ]);
}

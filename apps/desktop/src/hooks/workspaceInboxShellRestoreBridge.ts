/**
 * Imperative legacy inbox shell restore: persisted tabs → refs, React state, shadow mirrors.
 * React effect guards stay in `useMainWindowWorkspace`; call these from `useCallback` only (not during render).
 *
 * Tab refs are updated synchronously by {@link applyRestoredEditorWorkspaceTabsBridge} /
 * {@link migrateLegacyOpenTabsIfNeededBridge}. The caller must invoke
 * {@link runDeferredShellRestoreTabStateAndShadowSync} after hub/workspace merge (when applicable)
 * so React tab state + shadow updates land in the same deferred microtask turn as before merge —
 * with merged hub snapshots and Home stacks available for a synchronous full-model projection.
 */
import type {Dispatch, RefObject, SetStateAction} from 'react';

import {
  migrateOpenTabUrisToWorkspaceTabs,
  tabCurrentUri,
  type EditorWorkspaceTab,
} from '../lib/editorWorkspaceTabs';
import type {TodayHubWorkspaceSnapshot} from '../lib/mainWindowUiStore';
import type {WorkspaceHomeState} from '../lib/workspaceHomeNavigation';
import {
  buildRestoredEditorWorkspace,
  isUriValidVaultMarkdown,
  type RestoredInboxState,
} from './inboxShellRestoreHelpers';

export type ApplyRestoredEditorWorkspaceTabsDeps = {
  editorWorkspaceTabsRef: RefObject<EditorWorkspaceTab[]>;
  activeEditorTabIdRef: RefObject<string | null>;
};

export function applyRestoredEditorWorkspaceTabsBridge(
  deps: ApplyRestoredEditorWorkspaceTabsDeps,
  chosenTabsSource: ReadonlyArray<{id: string; entries: string[]; index: number}>
    | null
    | undefined,
  chosenActiveEditorTabId: string | null,
  filter: (raw: string) => boolean,
): string[] {
  const {editorWorkspaceTabsRef, activeEditorTabIdRef} = deps;

  if (chosenTabsSource == null) {
    return [];
  }
  const built = buildRestoredEditorWorkspace({
    chosenTabsSource,
    chosenActiveEditorTabId,
    filter,
  });
  if (built == null) {
    return [];
  }
  editorWorkspaceTabsRef.current = built.tabs;
  activeEditorTabIdRef.current = built.activeEditorTabId;
  return built.uris;
}

export type MigrateLegacyOpenTabsDeps = {
  editorWorkspaceTabsRef: RefObject<EditorWorkspaceTab[]>;
  activeEditorTabIdRef: RefObject<string | null>;
};

export function migrateLegacyOpenTabsIfNeededBridge(
  deps: MigrateLegacyOpenTabsDeps,
  rawTabs: readonly string[] | null | undefined,
  filter: (raw: string) => boolean,
): string[] {
  const {editorWorkspaceTabsRef, activeEditorTabIdRef} = deps;

  if (
    editorWorkspaceTabsRef.current.length > 0
    || rawTabs == null
    || rawTabs.length === 0
  ) {
    return [];
  }
  const filtered = rawTabs.filter(filter);
  const migrated = migrateOpenTabUrisToWorkspaceTabs(filtered);
  if (migrated.length === 0) {
    return [];
  }
  const nextActive = migrated[0]!.id;
  editorWorkspaceTabsRef.current = migrated;
  activeEditorTabIdRef.current = nextActive;
  return migrated
    .map(t => tabCurrentUri(t))
    .filter((u): u is string => u != null);
}

/** Payload for {@link syncShadowWorkspaceFromShellRestore}; aligns with {@link projectWorkspaceRuntimeToModel}. */
export type ShellRestoreProjectionSyncArgs = {
  activeTodayHubUri: string | null;
  hubUris: readonly string[];
  legacyHubWorkspaceSnapshots: Record<string, TodayHubWorkspaceSnapshot>;
  homeStatesByHub: Record<string, WorkspaceHomeState>;
};

export type DeferredShellRestoreTabsDeps = {
  editorWorkspaceTabsRef: RefObject<EditorWorkspaceTab[]>;
  activeEditorTabIdRef: RefObject<string | null>;
  setEditorWorkspaceTabs: Dispatch<SetStateAction<EditorWorkspaceTab[]>>;
  setActiveEditorTabId: Dispatch<SetStateAction<string | null>>;
  mirrorShadowActiveWorkspaceTabs: (
    tabs: readonly EditorWorkspaceTab[],
    activeId: string | null,
    reason: string,
  ) => void;
  mirrorShadowActiveTab: (tabId: string, reason: string) => void;
  mirrorShadowHomeSurface: (reason: string) => void;
  /**
   * When provided with a non-null projection payload (hub list non-empty), replaces async tab mirrors
   * with one synchronous full-model write matching legacy + merged snapshots.
   */
  syncShadowWorkspaceFromShellRestore?: (
    projection: ShellRestoreProjectionSyncArgs,
  ) => void;
};

/**
 * Queues the deferred tab React state + shadow sync (same timing as the former in-bridge
 * `queueMicrotask`). Call after hub/workspace merge when merged snapshots exist.
 */
export function runDeferredShellRestoreTabStateAndShadowSync(
  deps: DeferredShellRestoreTabsDeps,
  projection: ShellRestoreProjectionSyncArgs | null,
): void {
  const {
    editorWorkspaceTabsRef,
    activeEditorTabIdRef,
    setEditorWorkspaceTabs,
    setActiveEditorTabId,
    mirrorShadowActiveWorkspaceTabs,
    mirrorShadowActiveTab,
    mirrorShadowHomeSurface,
    syncShadowWorkspaceFromShellRestore,
  } = deps;

  queueMicrotask(() => {
    const tabs = editorWorkspaceTabsRef.current;
    const activeId = activeEditorTabIdRef.current;
    setEditorWorkspaceTabs(tabs);
    setActiveEditorTabId(activeId);

    const useProjection =
      projection != null
      && projection.hubUris.length > 0
      && syncShadowWorkspaceFromShellRestore != null;

    if (useProjection) {
      syncShadowWorkspaceFromShellRestore(projection);
      return;
    }

    mirrorShadowActiveWorkspaceTabs(tabs, activeId, 'restore editor workspace tabs');
    if (activeId == null) {
      mirrorShadowHomeSurface('restore editor workspace home surface');
    } else {
      mirrorShadowActiveTab(activeId, 'restore editor workspace active tab');
    }
  });
}

export type RestoreInboxSelectionAfterShellDeps = {
  editorWorkspaceTabsRef: RefObject<EditorWorkspaceTab[]>;
  activeEditorTabIdRef: RefObject<string | null>;
  activeTodayHubUriRef: RefObject<string | null>;
  notesRef: RefObject<readonly {uri: string}[]>;
  getRestoredInboxState: () => RestoredInboxState | null;
  startNewEntry: () => void;
  selectNote: (uri: string) => void;
  /** Re-applies the Today hub Home surface (same as workspace selector) without tab navigation. */
  selectHomeCurrentNote: (todayNoteUri: string) => void | Promise<void>;
};

export function restoreInboxSelectionAfterShellRestoreBridge(
  deps: RestoreInboxSelectionAfterShellDeps,
  root: string,
  restoredTabs: readonly string[],
  hubUrisLength: number,
): void {
  const {
    editorWorkspaceTabsRef,
    activeEditorTabIdRef,
    activeTodayHubUriRef,
    notesRef,
    getRestoredInboxState,
    startNewEntry,
    selectNote,
    selectHomeCurrentNote,
  } = deps;

  const restoredInboxState = getRestoredInboxState();
  if (!restoredInboxState) {
    return;
  }
  const knownNoteUris = new Set(notesRef.current.map(n => n.uri));
  if (restoredInboxState.composingNewEntry) {
    startNewEntry();
    return;
  }
  const hub = activeTodayHubUriRef.current;
  if (activeEditorTabIdRef.current == null && hub != null) {
    void selectHomeCurrentNote(hub);
    return;
  }
  if (restoredInboxState.selectedUri) {
    const selectedOk = isUriValidVaultMarkdown({
      uri: restoredInboxState.selectedUri,
      root,
      knownNoteUris,
    });
    if (selectedOk) {
      selectNote(restoredInboxState.selectedUri);
      return;
    }
    if (restoredTabs.length > 0) {
      selectNote(restoredTabs[0]!);
    }
    return;
  }
  if (restoredTabs.length > 0) {
    selectNote(restoredTabs[0]!);
    return;
  }
  if (
    hubUrisLength > 0
    && editorWorkspaceTabsRef.current.length === 0
    && activeTodayHubUriRef.current
  ) {
    selectNote(activeTodayHubUriRef.current);
  }
}

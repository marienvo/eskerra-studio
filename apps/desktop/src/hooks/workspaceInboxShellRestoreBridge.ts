/**
 * Imperative legacy inbox shell restore: persisted tabs → refs, React state, shadow mirrors.
 * React effect guards stay in `useMainWindowWorkspace`; call these from `useCallback` only (not during render).
 */
import type {Dispatch, RefObject, SetStateAction} from 'react';

import {
  migrateOpenTabUrisToWorkspaceTabs,
  tabCurrentUri,
  type EditorWorkspaceTab,
} from '../lib/editorWorkspaceTabs';
import {
  buildRestoredEditorWorkspace,
  isUriValidVaultMarkdown,
  type RestoredInboxState,
} from './inboxShellRestoreHelpers';

export type ApplyRestoredEditorWorkspaceTabsDeps = {
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
};

export function applyRestoredEditorWorkspaceTabsBridge(
  deps: ApplyRestoredEditorWorkspaceTabsDeps,
  chosenTabsSource: ReadonlyArray<{id: string; entries: string[]; index: number}>
    | null
    | undefined,
  chosenActiveEditorTabId: string | null,
  filter: (raw: string) => boolean,
): string[] {
  const {
    editorWorkspaceTabsRef,
    activeEditorTabIdRef,
    setEditorWorkspaceTabs,
    setActiveEditorTabId,
    mirrorShadowActiveWorkspaceTabs,
    mirrorShadowActiveTab,
    mirrorShadowHomeSurface,
  } = deps;

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
  // Sync ref immediately; defer React tab state + shadow mirrors to match restore sequencing.
  queueMicrotask(() => {
    setEditorWorkspaceTabs(built.tabs);
    setActiveEditorTabId(built.activeEditorTabId);
    mirrorShadowActiveWorkspaceTabs(
      built.tabs,
      built.activeEditorTabId,
      'restore editor workspace tabs',
    );
    if (built.activeEditorTabId == null) {
      mirrorShadowHomeSurface('restore editor workspace home surface');
    } else {
      mirrorShadowActiveTab(
        built.activeEditorTabId,
        'restore editor workspace active tab',
      );
    }
  });
  return built.uris;
}

export type MigrateLegacyOpenTabsDeps = {
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
};

export function migrateLegacyOpenTabsIfNeededBridge(
  deps: MigrateLegacyOpenTabsDeps,
  rawTabs: readonly string[] | null | undefined,
  filter: (raw: string) => boolean,
): string[] {
  const {
    editorWorkspaceTabsRef,
    activeEditorTabIdRef,
    setEditorWorkspaceTabs,
    setActiveEditorTabId,
    mirrorShadowActiveWorkspaceTabs,
    mirrorShadowActiveTab,
  } = deps;

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
  queueMicrotask(() => {
    setEditorWorkspaceTabs(migrated);
    setActiveEditorTabId(nextActive);
    mirrorShadowActiveWorkspaceTabs(migrated, nextActive, 'restore legacy tabs');
    mirrorShadowActiveTab(nextActive, 'restore legacy open tab');
  });
  return migrated
    .map(t => tabCurrentUri(t))
    .filter((u): u is string => u != null);
}

export type RestoreInboxSelectionAfterShellDeps = {
  editorWorkspaceTabsRef: RefObject<EditorWorkspaceTab[]>;
  activeTodayHubUriRef: RefObject<string | null>;
  notesRef: RefObject<readonly {uri: string}[]>;
  getRestoredInboxState: () => RestoredInboxState | null;
  startNewEntry: () => void;
  selectNote: (uri: string) => void;
};

export function restoreInboxSelectionAfterShellRestoreBridge(
  deps: RestoreInboxSelectionAfterShellDeps,
  root: string,
  restoredTabs: readonly string[],
  hubUrisLength: number,
): void {
  const {
    editorWorkspaceTabsRef,
    activeTodayHubUriRef,
    notesRef,
    getRestoredInboxState,
    startNewEntry,
    selectNote,
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

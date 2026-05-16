import {useCallback, useEffect, useRef, type Dispatch, type MutableRefObject, type RefObject, type SetStateAction} from 'react';

import {
  normalizeVaultBaseUri,
  sortedTodayHubNoteUrisFromRefs,
  trimTrailingSlashes,
  type VaultMarkdownRef,
} from '@eskerra/core';

import type {EditorWorkspaceTab} from '../lib/editorWorkspaceTabs';
import type {WorkspaceHomeState} from '../lib/workspaceHomeNavigation';
import {hydrateWorkspaceHomeStatesFromPersisted} from '../lib/workspaceHomePersistence';
import {
  makeStoredTabFilter,
  pickFinalActiveHub,
  resolveActiveHubAndTabsSource,
  restoredTodayHubWorkspaceUrisForRestore,
  type RestoredInboxState,
} from './inboxShellRestoreHelpers';
import {
  applyRestoredEditorWorkspaceTabsBridge,
  migrateLegacyOpenTabsIfNeededBridge,
  restoreInboxSelectionAfterShellRestoreBridge,
  runDeferredShellRestoreTabStateAndShadowSync,
  type ShellRestoreProjectionSyncArgs,
} from './workspaceInboxShellRestoreBridge';
import {replaceRuntimeActiveHub} from './workspaceTabCommands';

function normalizedVaultRootPath(vaultRoot: string): string {
  return trimTrailingSlashes(normalizeVaultBaseUri(vaultRoot).replace(/\\/g, '/'));
}

export type UseInboxShellRestoreArgs = {
  vaultRoot: string | null;
  inboxRestoreEnabled: boolean;
  inboxShellRestored: boolean;
  setInboxShellRestored: Dispatch<SetStateAction<boolean>>;
  restoredInboxState: RestoredInboxState | null;
  notes: readonly {uri: string}[];
  notesRef: RefObject<readonly {uri: string}[]>;
  vaultMarkdownRefs: readonly VaultMarkdownRef[];
  editorWorkspaceTabsRef: MutableRefObject<EditorWorkspaceTab[]>;
  activeEditorTabIdRef: MutableRefObject<string | null>;
  activeTodayHubUriRef: MutableRefObject<string | null>;
  setEditorWorkspaceTabs: Dispatch<SetStateAction<EditorWorkspaceTab[]>>;
  setActiveEditorTabId: Dispatch<SetStateAction<string | null>>;
  setActiveTodayHubUri: Dispatch<SetStateAction<string | null>>;
  replaceHomeStatesByHub: (next: Record<string, WorkspaceHomeState>) => void;
  mirrorShadowActiveHub: (hubUri: string | null, reason: string) => void;
  mirrorShadowActiveWorkspaceTabs: (
    tabs: readonly EditorWorkspaceTab[],
    activeId: string | null,
    reason: string,
  ) => void;
  mirrorShadowActiveTab: (tabId: string, reason: string) => void;
  mirrorShadowHomeSurface: (reason: string) => void;
  syncShadowWorkspaceFromShellRestore: (projection: ShellRestoreProjectionSyncArgs) => void;
  startNewEntry: () => void;
  selectNote: (uri: string) => void;
  selectHomeCurrentNote: (todayNoteUri: string) => void | Promise<void>;
};

export function useInboxShellRestore(args: UseInboxShellRestoreArgs): void {
  const {
    vaultRoot,
    inboxRestoreEnabled,
    inboxShellRestored,
    setInboxShellRestored,
    restoredInboxState,
    notes,
    notesRef,
    vaultMarkdownRefs,
    editorWorkspaceTabsRef,
    activeEditorTabIdRef,
    activeTodayHubUriRef,
    setEditorWorkspaceTabs,
    setActiveEditorTabId,
    setActiveTodayHubUri,
    replaceHomeStatesByHub,
    mirrorShadowActiveHub,
    mirrorShadowActiveWorkspaceTabs,
    mirrorShadowActiveTab,
    mirrorShadowHomeSurface,
    syncShadowWorkspaceFromShellRestore,
    startNewEntry,
    selectNote,
    selectHomeCurrentNote,
  } = args;

  /** Last vault we applied the "shell not restored" reset for; avoids racing restore's `true`. */
  const inboxShellRestoredResetVaultRef = useRef<string | null>(null);
  const inboxRestoreEnabledPrevRef = useRef(inboxRestoreEnabled);

  useEffect(() => {
    if (!inboxRestoreEnabled) {
      queueMicrotask(() => {
        setInboxShellRestored(true);
      });
      inboxRestoreEnabledPrevRef.current = inboxRestoreEnabled;
      return;
    }
    if (!vaultRoot) {
      queueMicrotask(() => {
        setInboxShellRestored(false);
      });
      inboxShellRestoredResetVaultRef.current = null;
      inboxRestoreEnabledPrevRef.current = inboxRestoreEnabled;
      return;
    }
    const inboxRestoreJustEnabled =
      !inboxRestoreEnabledPrevRef.current && inboxRestoreEnabled;
    const vaultSwitched =
      inboxShellRestoredResetVaultRef.current != null &&
      inboxShellRestoredResetVaultRef.current !== vaultRoot;
    if (inboxRestoreJustEnabled || vaultSwitched) {
      queueMicrotask(() => {
        setInboxShellRestored(false);
      });
    }
    inboxShellRestoredResetVaultRef.current = vaultRoot;
    inboxRestoreEnabledPrevRef.current = inboxRestoreEnabled;
  }, [vaultRoot, inboxRestoreEnabled, setInboxShellRestored]);

  const applyRestoredEditorWorkspaceTabs = useCallback(
    (
      chosenTabsSource: ReadonlyArray<{id: string; entries: string[]; index: number}>
        | null
        | undefined,
      chosenActiveEditorTabId: string | null,
      filter: (raw: string) => boolean,
    ): string[] =>
      applyRestoredEditorWorkspaceTabsBridge(
        {
          editorWorkspaceTabsRef,
          activeEditorTabIdRef,
        },
        chosenTabsSource,
        chosenActiveEditorTabId,
        filter,
      ),
    [activeEditorTabIdRef, editorWorkspaceTabsRef],
  );

  const migrateLegacyOpenTabsIfNeeded = useCallback(
    (
      rawTabs: readonly string[] | null | undefined,
      filter: (raw: string) => boolean,
    ): string[] =>
      migrateLegacyOpenTabsIfNeededBridge(
        {
          editorWorkspaceTabsRef,
          activeEditorTabIdRef,
        },
        rawTabs,
        filter,
      ),
    [activeEditorTabIdRef, editorWorkspaceTabsRef],
  );

  const restoreInboxSelectionAfterShellRestore = useCallback(
    (root: string, restoredTabs: readonly string[], hubUrisLength: number) =>
      restoreInboxSelectionAfterShellRestoreBridge(
        {
          editorWorkspaceTabsRef,
          activeEditorTabIdRef,
          activeTodayHubUriRef,
          notesRef,
          getRestoredInboxState: () => restoredInboxState,
          startNewEntry,
          selectNote,
          selectHomeCurrentNote,
        },
        root,
        restoredTabs,
        hubUrisLength,
      ),
    [
      activeEditorTabIdRef,
      activeTodayHubUriRef,
      editorWorkspaceTabsRef,
      notesRef,
      restoredInboxState,
      selectHomeCurrentNote,
      selectNote,
      startNewEntry,
    ],
  );

  useEffect(() => {
    if (!vaultRoot) {
      return;
    }
    if (!inboxRestoreEnabled || inboxShellRestored) {
      return;
    }
    const root = normalizedVaultRootPath(vaultRoot);
    const restoredMatchesCurrentVault =
      restoredInboxState != null
      && typeof restoredInboxState.vaultRoot === 'string'
      && normalizedVaultRootPath(restoredInboxState.vaultRoot) === root;

    if (restoredMatchesCurrentVault) {
      const hubUris = restoredTodayHubWorkspaceUrisForRestore({
        currentHubUris: sortedTodayHubNoteUrisFromRefs(vaultMarkdownRefs),
        restored: restoredInboxState.todayHubWorkspaces,
        root,
      });
      const knownNoteUris = new Set(notes.map(n => n.uri));
      const filter = makeStoredTabFilter({root, knownNoteUris});

      const {resolvedActiveHub, chosenTabsSource, chosenActiveEditorTabId} =
        resolveActiveHubAndTabsSource({hubUris, restored: restoredInboxState, filter});

      let restoredTabs = applyRestoredEditorWorkspaceTabs(
        chosenTabsSource,
        chosenActiveEditorTabId,
        filter,
      );
      if (restoredTabs.length === 0 && editorWorkspaceTabsRef.current.length === 0) {
        restoredTabs = migrateLegacyOpenTabsIfNeeded(
          restoredInboxState.openTabUris,
          filter,
        );
      }

      let shellRestoreProjection: ShellRestoreProjectionSyncArgs | null = null;

      if (hubUris.length > 0) {
        const activeHubFinal = pickFinalActiveHub({
          resolvedActiveHub,
          hubUris,
          restored: restoredInboxState,
        });
        const homeHydrated = hydrateWorkspaceHomeStatesFromPersisted({
          hubUris,
          activeTodayHubUri: activeHubFinal,
          todayHubWorkspaces: restoredInboxState.todayHubWorkspaces as
            | Record<string, unknown>
            | null
            | undefined,
        });
        replaceRuntimeActiveHub(
          activeHubFinal,
          activeTodayHubUriRef,
          setActiveTodayHubUri,
        );
        replaceHomeStatesByHub(homeHydrated);
        setInboxShellRestored(true);
        shellRestoreProjection = {
          activeTodayHubUri: activeHubFinal,
          hubUris,
          todayHubWorkspaces: restoredInboxState.todayHubWorkspaces ?? null,
          homeStatesByHub: homeHydrated,
        };
      } else if (vaultMarkdownRefs.length > 0) {
        replaceRuntimeActiveHub(null, activeTodayHubUriRef, setActiveTodayHubUri);
        mirrorShadowActiveHub(null, 'restore active hub');
        setInboxShellRestored(true);
      } else {
        setInboxShellRestored(true);
      }

      runDeferredShellRestoreTabStateAndShadowSync(
        {
          editorWorkspaceTabsRef,
          activeEditorTabIdRef,
          setEditorWorkspaceTabs,
          setActiveEditorTabId,
          mirrorShadowActiveWorkspaceTabs,
          mirrorShadowActiveTab,
          mirrorShadowHomeSurface,
          syncShadowWorkspaceFromShellRestore,
        },
        shellRestoreProjection,
      );

      restoreInboxSelectionAfterShellRestore(root, restoredTabs, hubUris.length);
      return;
    }
    queueMicrotask(() => {
      setInboxShellRestored(true);
    });
  }, [
    activeEditorTabIdRef,
    activeTodayHubUriRef,
    applyRestoredEditorWorkspaceTabs,
    editorWorkspaceTabsRef,
    inboxRestoreEnabled,
    inboxShellRestored,
    migrateLegacyOpenTabsIfNeeded,
    mirrorShadowActiveHub,
    mirrorShadowActiveTab,
    mirrorShadowActiveWorkspaceTabs,
    mirrorShadowHomeSurface,
    notes,
    replaceHomeStatesByHub,
    restoreInboxSelectionAfterShellRestore,
    restoredInboxState,
    setActiveEditorTabId,
    setActiveTodayHubUri,
    setEditorWorkspaceTabs,
    setInboxShellRestored,
    syncShadowWorkspaceFromShellRestore,
    vaultMarkdownRefs,
    vaultRoot,
  ]);
}

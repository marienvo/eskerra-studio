import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
} from 'react';

import {
  markdownContainsTransientImageUrls,
  sortedTodayHubNoteUrisFromRefs,
  type SubtreeMarkdownPresenceCache,
  type VaultFilesystem,
  type VaultMarkdownRef,
} from '@eskerra/core';

import type {NoteMarkdownEditorHandle} from '../editor/noteEditor/NoteMarkdownEditor';
import {normalizeEditorDocUri} from '../lib/editorDocumentHistory';
import {tabsToStored, type EditorWorkspaceTab} from '../lib/editorWorkspaceTabs';
import type {TodayHubWorkspaceSnapshot} from '../lib/mainWindowUiStore';
import {persistTransientMarkdownImages} from '../lib/persistTransientMarkdownImages';
import {
  normalizeTodayHubRowForDisk,
  splitTodayRowIntoColumns,
  todayHubRowSectionsAllBlank,
  type TodayHubSettings,
  type TodayHubWorkspaceBridge,
} from '../lib/todayHub';
import {pickDefaultActiveTodayHubUri} from '../lib/todayHub/todayHubWorkspaceRestore';
import {deleteVaultMarkdownNote, saveNoteMarkdown} from '../lib/vaultBootstrap';
import {
  createWorkspaceHomeState,
  homeCurrentUri,
  pushHomeNavigate,
  type WorkspaceHomeState,
} from '../lib/workspaceHomeNavigation';
import {
  isOnWorkspaceHome,
  workspaceSelectorMainShowsActiveTabPill,
  workspaceSelectorSubLabelText,
} from '../lib/workspaceShellToday';
import {
  applyIncomingHubWorkspaceAction,
  normalizeWorkspaceUri,
  remapPrefixAction,
  removeUrisAction,
  syncHubWorkspacesToVaultTodayRefsAction,
  type WorkspaceModel,
} from '../lib/workspaceModel';
import {
  deriveModelDerivedPersistencePayload,
} from './workspacePersistenceBridge';
import {
  activeEditorWorkspaceTabsFromWorkspaceModel,
  activeSurfaceTabIdFromWorkspaceModel,
  editorWorkspaceTabsFromModelTabEntries,
  legacyEditorWorkspaceTabsSignature,
  tabsControllerEditorSurface,
  workspaceHomeStatesFromWorkspaceModel,
  workspaceHomeStatesSignature,
  workspaceStateForIncomingHubSwitch,
} from './workspaceRuntimeProjection';
import {restoreShadowWorkspaceModelFromInboxState} from './workspaceShellRestoreModel';
import {
  deriveTodayHubSelectorItems,
  deriveTodayHubSettings,
  deriveTodayHubShowCanvas,
} from './workspaceTodayHubDerived';
import {useWorkspaceTodayHubSwitch} from './workspaceTodayHubSwitch';
import {
  mergeInboxNoteBodyIntoCache,
  normalizeVaultMarkdownDiskRead,
  removeInboxNoteBodyFromCache,
} from './inboxNoteBodyCache';
import type {OpenMarkdownInEditorOptions} from './workspaceOpenMarkdownCommand';
import type {ShellRestoreProjectionSyncArgs} from './workspaceInboxShellRestoreBridge';
import type {DiskConflictState} from './workspaceFsWatchReconcile';

function workspaceHubUriEqual(a: string | null, b: string | null): boolean {
  if (a === b) {
    return true;
  }
  if (a == null || b == null) {
    return false;
  }
  return normalizeWorkspaceUri(a) === normalizeWorkspaceUri(b);
}

export type TodayHubOpenMarkdown = (
  uri: string,
  options?: OpenMarkdownInEditorOptions,
) => Promise<void>;

export type UseTodayHubsStateArgs = {
  fs: VaultFilesystem;
  vaultRoot: string | null;
  selectedUri: string | null;
  editorBody: string;
  composingNewEntry: boolean;
  inboxYamlFrontmatterInner: string | null;
  inboxEditorYamlLeadingBeforeFrontmatter: string;
  notes: readonly {lastModified: number | null; name: string; uri: string}[];
  vaultMarkdownRefs: readonly VaultMarkdownRef[];
  vaultMarkdownRefsReady: boolean;
  inboxShellRestored: boolean;
  workspaceShadowModel: WorkspaceModel;
  dispatchWorkspaceActionSync: (
    reason: string,
    reduce: (model: WorkspaceModel) => WorkspaceModel,
  ) => WorkspaceModel;
  replaceShadowHomeStateForHub: (
    hubUri: string,
    state: WorkspaceHomeState,
    reason: string,
  ) => void;
  mirrorShadowActiveHub: (hubUri: string | null, reason: string) => void;
  mirrorShadowHomeSurface: (reason: string) => void;
  mirrorShadowActiveTab: (tabId: string, reason: string) => void;
  mirrorShadowActiveWorkspaceTabs: (
    tabs: readonly EditorWorkspaceTab[],
    activeId: string | null,
    reason: string,
  ) => void;
  vaultRootRef: MutableRefObject<string | null>;
  showTodayHubCanvasRef: MutableRefObject<boolean>;
  todayHubBridgeRef: MutableRefObject<TodayHubWorkspaceBridge>;
  todayHubWikiNavParentRef: MutableRefObject<string | null>;
  todayHubCellEditorRef: MutableRefObject<NoteMarkdownEditorHandle | null>;
  todayHubRowLastPersistedRef: MutableRefObject<Map<string, string>>;
  todayHubSettingsRef: MutableRefObject<TodayHubSettings | null>;
  vaultMarkdownRefsRef: MutableRefObject<VaultMarkdownRef[]>;
  selectedUriRef: MutableRefObject<string | null>;
  composingNewEntryRef: MutableRefObject<boolean>;
  inboxYamlFrontmatterInnerRef: MutableRefObject<string | null>;
  inboxEditorYamlLeadingBeforeFrontmatterRef: MutableRefObject<string>;
  editorWorkspaceTabs: readonly EditorWorkspaceTab[];
  activeEditorTabId: string | null;
  editorWorkspaceTabsRef: MutableRefObject<EditorWorkspaceTab[]>;
  activeEditorTabIdRef: MutableRefObject<string | null>;
  replaceEditorWorkspaceTabs: (nextTabs: EditorWorkspaceTab[]) => void;
  setEditorWorkspaceTabs: Dispatch<SetStateAction<EditorWorkspaceTab[]>>;
  setActiveEditorTabId: Dispatch<SetStateAction<string | null>>;
  setComposingNewEntry: Dispatch<SetStateAction<boolean>>;
  setInboxYamlFrontmatterInner: Dispatch<SetStateAction<string | null>>;
  setInboxEditorYamlLeadingBeforeFrontmatter: Dispatch<SetStateAction<string>>;
  setEditorBody: Dispatch<SetStateAction<string>>;
  setInboxEditorResetNonce: Dispatch<SetStateAction<number>>;
  flushInboxSaveRef: MutableRefObject<() => Promise<void>>;
  saveChainRef: MutableRefObject<Promise<void>>;
  saveActiveRef: MutableRefObject<boolean>;
  inboxContentByUriRef: MutableRefObject<Record<string, string>>;
  setInboxContentByUri: Dispatch<SetStateAction<Record<string, string>>>;
  refreshNotes: (root: string) => Promise<void>;
  setFsRefreshNonce: Dispatch<SetStateAction<number>>;
  setErr: (value: string | null) => void;
  markVaultWriteSettled: () => void;
  subtreeMarkdownCache: SubtreeMarkdownPresenceCache;
  diskConflictRef: MutableRefObject<DiskConflictState | null>;
  openMarkdownInEditorRef: MutableRefObject<TodayHubOpenMarkdown>;
  activateOpenTabRef: MutableRefObject<(tabId: string) => void>;
  selectNoteRef: MutableRefObject<(uri: string) => void>;
};

export type UseTodayHubsStateResult = {
  activeTodayHubUriRef: MutableRefObject<string | null>;
  setActiveTodayHubUri: Dispatch<SetStateAction<string | null>>;
  homeStatesByHubRef: MutableRefObject<Record<string, WorkspaceHomeState>>;
  replaceHomeStatesByHub: (next: Record<string, WorkspaceHomeState>) => void;
  modelActiveTodayHubUri: string | null;
  modelActiveEditorTabId: string | null;
  modelEditorWorkspaceTabs: readonly EditorWorkspaceTab[];
  modelHomeStatesByHub: Record<string, WorkspaceHomeState>;
  modelDerivedPersistence: ReturnType<typeof deriveModelDerivedPersistencePayload>;
  todayHubWorkspacesForSwitch: Record<string, TodayHubWorkspaceSnapshot>;
  tabsControllerSurface: readonly [readonly EditorWorkspaceTab[], string | null];
  showTodayHubCanvas: boolean;
  showTodayHubCanvasRef: MutableRefObject<boolean>;
  todayHubSettings: TodayHubSettings | null;
  todayHubSettingsRef: MutableRefObject<TodayHubSettings | null>;
  todayHubBridgeRef: MutableRefObject<TodayHubWorkspaceBridge>;
  todayHubWikiNavParentRef: MutableRefObject<string | null>;
  todayHubCellEditorRef: RefObject<NoteMarkdownEditorHandle | null>;
  todayHubRowLastPersistedRef: MutableRefObject<Map<string, string>>;
  todayHubSelectorItems: readonly {todayNoteUri: string; label: string}[];
  workspaceSelectShowsActiveTabPill: boolean;
  workspaceSelectorSubLabel: string | undefined;
  projectHomeStatesFromModel: (nextModel: WorkspaceModel) => void;
  remapHomeStatesPrefix: (oldPrefix: string, newPrefix: string) => void;
  removeHomeHistoryUris: (shouldRemove: (normalizedUri: string) => boolean) => void;
  setHomeStateForHub: (hubUri: string, state: WorkspaceHomeState) => void;
  pushHomeHistoryForHub: (hubUri: string, targetUri: string) => void;
  prehydrateTodayHubRows: (uris: readonly string[]) => Promise<void>;
  persistTodayHubRow: (
    rowUri: string,
    merged: string,
    columnCount: number,
  ) => Promise<void>;
  todayHubCleanRowBlocked: (rowUri: string) => boolean;
  syncShadowWorkspaceFromShellRestore: (
    projection: ShellRestoreProjectionSyncArgs,
  ) => void;
  switchTodayHubWorkspace: (todayNoteUri: string) => Promise<void>;
  focusActiveTodayHubNote: () => void;
  selectHomeCurrentNote: (todayNoteUri: string) => Promise<void>;
  activateWorkspaceHomeSelector: () => void;
  openWorkspaceHomeCurrentInBackgroundTab: () => void;
};

export function useTodayHubsState(
  args: UseTodayHubsStateArgs,
): UseTodayHubsStateResult {
  const {
    fs,
    vaultRoot,
    selectedUri,
    editorBody,
    composingNewEntry,
    inboxYamlFrontmatterInner,
    inboxEditorYamlLeadingBeforeFrontmatter,
    notes,
    vaultMarkdownRefs,
    vaultMarkdownRefsReady,
    inboxShellRestored,
    workspaceShadowModel,
    dispatchWorkspaceActionSync,
    replaceShadowHomeStateForHub,
    mirrorShadowActiveHub,
    mirrorShadowHomeSurface,
    mirrorShadowActiveTab,
    mirrorShadowActiveWorkspaceTabs,
    vaultRootRef,
    showTodayHubCanvasRef,
    todayHubBridgeRef,
    todayHubWikiNavParentRef,
    todayHubCellEditorRef,
    todayHubRowLastPersistedRef,
    todayHubSettingsRef,
    vaultMarkdownRefsRef,
    selectedUriRef,
    composingNewEntryRef,
    inboxYamlFrontmatterInnerRef,
    inboxEditorYamlLeadingBeforeFrontmatterRef,
    editorWorkspaceTabs,
    activeEditorTabId,
    editorWorkspaceTabsRef,
    activeEditorTabIdRef,
    replaceEditorWorkspaceTabs,
    setEditorWorkspaceTabs,
    setActiveEditorTabId,
    setComposingNewEntry,
    setInboxYamlFrontmatterInner,
    setInboxEditorYamlLeadingBeforeFrontmatter,
    setEditorBody,
    setInboxEditorResetNonce,
    flushInboxSaveRef,
    saveChainRef,
    saveActiveRef,
    inboxContentByUriRef,
    setInboxContentByUri,
    refreshNotes,
    setFsRefreshNonce,
    setErr,
    markVaultWriteSettled,
    subtreeMarkdownCache,
    diskConflictRef,
    openMarkdownInEditorRef,
    activateOpenTabRef,
    selectNoteRef,
  } = args;

  const [activeTodayHubUri, setActiveTodayHubUri] = useState<string | null>(null);
  const [homeStatesByHub, setHomeStatesByHub] = useState<
    Record<string, WorkspaceHomeState>
  >({});
  const activeTodayHubUriRef = useRef<string | null>(null);
  const homeStatesByHubRef = useRef<Record<string, WorkspaceHomeState>>({});

  useLayoutEffect(() => {
    activeTodayHubUriRef.current = activeTodayHubUri;
  }, [activeTodayHubUri]);

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

  const todayHubSelectorItems = useMemo(
    () => deriveTodayHubSelectorItems(vaultMarkdownRefs, notes),
    [vaultMarkdownRefs, notes],
  );

  const workspaceModelHubUris = useMemo(
    () => sortedTodayHubNoteUrisFromRefs(vaultMarkdownRefs),
    [vaultMarkdownRefs],
  );

  const modelDerivedPersistence = useMemo(
    () => deriveModelDerivedPersistencePayload(workspaceShadowModel),
    [workspaceShadowModel],
  );

  const modelActiveTodayHubUri = workspaceShadowModel.activeHub;
  const modelActiveEditorTabId = useMemo(
    () => activeSurfaceTabIdFromWorkspaceModel(workspaceShadowModel),
    [workspaceShadowModel],
  );
  const modelEditorWorkspaceTabs = useMemo(
    () => activeEditorWorkspaceTabsFromWorkspaceModel(workspaceShadowModel),
    [workspaceShadowModel],
  );
  const tabsControllerSurface = useMemo(
    () =>
      tabsControllerEditorSurface(
        modelActiveTodayHubUri,
        modelEditorWorkspaceTabs,
        modelActiveEditorTabId,
        editorWorkspaceTabs,
        activeEditorTabId,
      ),
    [
      modelActiveTodayHubUri,
      modelEditorWorkspaceTabs,
      modelActiveEditorTabId,
      editorWorkspaceTabs,
      activeEditorTabId,
    ],
  );
  const modelHomeStatesByHub = useMemo(
    () => workspaceHomeStatesFromWorkspaceModel(workspaceShadowModel),
    [workspaceShadowModel],
  );
  const todayHubWorkspacesForSwitch = modelDerivedPersistence.todayHubWorkspaces as Record<
    string,
    TodayHubWorkspaceSnapshot
  >;

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
    replaceEditorWorkspaceTabs,
    replaceHomeStatesByHub,
    setActiveEditorTabId,
  ]);

  const workspaceSelectShowsActiveTabPill = useMemo(
    () =>
      workspaceSelectorMainShowsActiveTabPill({
        composingNewEntry,
        activeTodayHubUri: modelActiveTodayHubUri,
        activeEditorTabId: modelActiveEditorTabId,
        homeState:
          modelActiveTodayHubUri != null
            ? modelHomeStatesByHub[modelActiveTodayHubUri]
            : undefined,
      }),
    [
      composingNewEntry,
      modelActiveTodayHubUri,
      modelActiveEditorTabId,
      modelHomeStatesByHub,
    ],
  );

  const workspaceSelectorSubLabel = useMemo(
    () =>
      workspaceSelectorSubLabelText({
        activeTodayHubUri: modelActiveTodayHubUri,
        homeState:
          modelActiveTodayHubUri != null
            ? modelHomeStatesByHub[modelActiveTodayHubUri]
            : undefined,
      }),
    [modelActiveTodayHubUri, modelHomeStatesByHub],
  );

  const showTodayHubCanvas = useMemo(
    () => deriveTodayHubShowCanvas(vaultRoot, selectedUri, composingNewEntry),
    [vaultRoot, selectedUri, composingNewEntry],
  );

  useLayoutEffect(() => {
    showTodayHubCanvasRef.current = showTodayHubCanvas;
  }, [showTodayHubCanvas]);

  const todayHubSettings = useMemo(
    (): TodayHubSettings | null =>
      deriveTodayHubSettings({
        showTodayHubCanvas,
        selectedUri,
        editorBody,
        composingNewEntry,
        inboxYamlFrontmatterInner,
        inboxEditorYamlLeadingBeforeFrontmatter,
      }),
    [
      showTodayHubCanvas,
      selectedUri,
      editorBody,
      composingNewEntry,
      inboxYamlFrontmatterInner,
      inboxEditorYamlLeadingBeforeFrontmatter,
    ],
  );

  useLayoutEffect(() => {
    todayHubSettingsRef.current = todayHubSettings;
  }, [todayHubSettings]);

  const prehydrateTodayHubRows = useCallback(
    async (uris: readonly string[]) => {
      const root = vaultRootRef.current;
      if (!root) {
        return;
      }
      await saveChainRef.current.catch(() => undefined);
      const updates: Record<string, string> = {};
      for (const uri of uris) {
        const n = normalizeEditorDocUri(uri);
        if (inboxContentByUriRef.current[n] !== undefined) {
          continue;
        }
        try {
          if (!(await fs.exists(n))) {
            continue;
          }
          const raw = await fs.readFile(n, {encoding: 'utf8'});
          const body = normalizeVaultMarkdownDiskRead(raw);
          updates[n] = body;
          todayHubRowLastPersistedRef.current.set(n, body);
        } catch {
          // ignore transient FS errors during prehydrate
        }
      }
      if (Object.keys(updates).length > 0) {
        inboxContentByUriRef.current = {...inboxContentByUriRef.current, ...updates};
        setInboxContentByUri(prev => ({...prev, ...updates}));
      }
    },
    [fs, inboxContentByUriRef, saveChainRef, setInboxContentByUri, vaultRootRef],
  );

  const persistTodayHubRow = useCallback(
    async (rowUri: string, merged: string, columnCount: number) => {
      const root = vaultRootRef.current;
      if (!root) {
        return;
      }
      const norm = normalizeEditorDocUri(rowUri);
      const run = async (): Promise<void> => {
        setErr(null);
        try {
          const toPersist = normalizeTodayHubRowForDisk(merged, columnCount);
          const sections = splitTodayRowIntoColumns(toPersist, columnCount);
          if (todayHubRowSectionsAllBlank(sections)) {
            try {
              if (await fs.exists(norm)) {
                await deleteVaultMarkdownNote(root, norm, fs);
                markVaultWriteSettled();
                subtreeMarkdownCache.invalidateForMutation(root, norm, 'file');
              }
            } catch (e) {
              setErr(e instanceof Error ? e.message : String(e));
              return;
            }
            todayHubRowLastPersistedRef.current.delete(norm);
            const rm = removeInboxNoteBodyFromCache(
              inboxContentByUriRef.current,
              norm,
            );
            if (rm) {
              inboxContentByUriRef.current = rm;
              setInboxContentByUri(rm);
            }
            await refreshNotes(root);
            setFsRefreshNonce(n => n + 1);
            return;
          }
          const md = await persistTransientMarkdownImages(toPersist, root);
          if (markdownContainsTransientImageUrls(md)) {
            setErr(
              'Cannot save: some images are still temporary (blob or data URLs). Paste images again so they are stored under Assets/Attachments, or remove those image references.',
            );
            return;
          }
          await saveNoteMarkdown(norm, fs, md);
          markVaultWriteSettled();
          subtreeMarkdownCache.invalidateForMutation(root, norm, 'file');
          todayHubRowLastPersistedRef.current.set(norm, md);
          const nextCache = mergeInboxNoteBodyIntoCache(
            inboxContentByUriRef.current,
            norm,
            md,
          );
          if (nextCache) {
            inboxContentByUriRef.current = nextCache;
            setInboxContentByUri(prev =>
              mergeInboxNoteBodyIntoCache(prev, norm, md) ?? prev,
            );
          }
          await refreshNotes(root);
          setFsRefreshNonce(n => n + 1);
        } catch (e) {
          setErr(e instanceof Error ? e.message : String(e));
        }
      };
      saveActiveRef.current = true;
      const next = saveChainRef.current
        .then(() => run())
        .finally(() => {
          saveActiveRef.current = false;
        });
      saveChainRef.current = next.catch(() => undefined);
      await next;
    },
    [
      fs,
      inboxContentByUriRef,
      markVaultWriteSettled,
      refreshNotes,
      saveActiveRef,
      saveChainRef,
      setErr,
      setFsRefreshNonce,
      setInboxContentByUri,
      subtreeMarkdownCache,
      vaultRootRef,
    ],
  );

  const selectHomeCurrentNote = useCallback(
    async (todayNoteUri: string) => {
      const homeState =
        homeStatesByHubRef.current[todayNoteUri] ??
        createWorkspaceHomeState(todayNoteUri);
      const uri = homeCurrentUri(homeState) ?? todayNoteUri;
      await openMarkdownInEditorRef.current(uri, {home: true, skipHistory: true});
    },
    [openMarkdownInEditorRef],
  );

  const activateWorkspaceHomeSelector = useCallback(() => {
    const hub = activeTodayHubUriRef.current;
    if (!hub) {
      return;
    }
    if (activeEditorTabIdRef.current != null) {
      mirrorShadowHomeSurface('workspace selector home surface');
      void selectHomeCurrentNote(hub);
      return;
    }
    const home =
      homeStatesByHubRef.current[hub] ?? createWorkspaceHomeState(hub);
    if (home.history.index <= 0) {
      if (selectedUriRef.current == null) {
        void selectHomeCurrentNote(hub);
      }
      return;
    }
    const hubTodayUri = home.history.entries[0];
    if (hubTodayUri == null) {
      return;
    }
    const resetHome: WorkspaceHomeState = {
      ...home,
      history: {...home.history, index: 0},
    };
    setHomeStateForHub(hub, resetHome);
    void openMarkdownInEditorRef.current(hubTodayUri, {home: true, skipHistory: true});
  }, [
    activeEditorTabIdRef,
    mirrorShadowHomeSurface,
    openMarkdownInEditorRef,
    selectHomeCurrentNote,
    selectedUriRef,
    setHomeStateForHub,
  ]);

  const openWorkspaceHomeCurrentInBackgroundTab = useCallback(() => {
    const hub = activeTodayHubUriRef.current;
    if (!hub) {
      return;
    }
    const home =
      homeStatesByHubRef.current[hub] ?? createWorkspaceHomeState(hub);
    const uri = homeCurrentUri(home) ?? hub;
    void openMarkdownInEditorRef.current(uri, {
      newTab: true,
      activateNewTab: false,
      insertAfterActive: true,
    });
  }, [openMarkdownInEditorRef]);

  const syncWorkspaceModelForIncomingHub = useCallback(
    (payload: {
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
    }) => {
      dispatchWorkspaceActionSync('today hub switch', m => {
        const home = homeStatesByHubRef.current;
        let next = m;
        if (payload.outgoing) {
          const outgoingWs = workspaceStateForIncomingHubSwitch({
            hubUri: payload.outgoing.hubUri,
            nextTabs: payload.outgoing.nextTabs,
            nextActive: payload.outgoing.nextActive,
            snapshot: payload.outgoing.snapshot,
            homeStatesByHub: home,
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
            homeStatesByHub: home,
          }),
        );
      });
    },
    [dispatchWorkspaceActionSync],
  );

  const syncShadowWorkspaceFromShellRestore = useCallback(
    (projection: ShellRestoreProjectionSyncArgs) => {
      dispatchWorkspaceActionSync('restore shell workspace projection', () =>
        restoreShadowWorkspaceModelFromInboxState({
          hubUris: projection.hubUris,
          activeTodayHubUri: projection.activeTodayHubUri,
          todayHubWorkspaces: projection.todayHubWorkspaces,
          editorWorkspaceTabs: editorWorkspaceTabsRef.current,
          activeEditorTabId: activeEditorTabIdRef.current,
          homeStatesByHub: projection.homeStatesByHub,
        }),
      );
    },
    [activeEditorTabIdRef, dispatchWorkspaceActionSync, editorWorkspaceTabsRef],
  );

  const {switchTodayHubWorkspace, focusActiveTodayHubNote} =
    useWorkspaceTodayHubSwitch({
      state: {legacyTodayHubWorkspacesForSwitch: todayHubWorkspacesForSwitch},
      refs: {
        vaultMarkdownRefsRef,
        activeTodayHubUriRef,
        flushInboxSaveRef,
        composingNewEntryRef,
        inboxYamlFrontmatterInnerRef,
        inboxEditorYamlLeadingBeforeFrontmatterRef,
        editorWorkspaceTabsRef,
        activeEditorTabIdRef,
        homeStatesByHubRef,
      },
      setters: {
        setComposingNewEntry,
        setInboxYamlFrontmatterInner,
        setInboxEditorYamlLeadingBeforeFrontmatter,
        setEditorBody,
        setInboxEditorResetNonce,
        setEditorWorkspaceTabs,
        setActiveEditorTabId,
        setActiveTodayHubUri,
      },
      callbacks: {
        selectNote: uri => selectNoteRef.current(uri),
        selectHomeCurrentNote,
        activateOpenTab: tabId => activateOpenTabRef.current(tabId),
        activateWorkspaceHomeSelector,
        mirrorShadowActiveHub,
        mirrorShadowHomeSurface,
        mirrorShadowActiveTab,
        mirrorShadowActiveWorkspaceTabs,
        syncWorkspaceModelForIncomingHub,
      },
    });

  const todayHubCleanRowBlocked = useCallback((rowUri: string) => {
    const dc = diskConflictRef.current;
    return (
      !!dc &&
      normalizeEditorDocUri(dc.uri) === normalizeEditorDocUri(rowUri)
    );
  }, [diskConflictRef]);

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
      void switchTodayHubWorkspace(hubs[0]!);
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
  ]);

  return {
    activeTodayHubUriRef,
    setActiveTodayHubUri,
    homeStatesByHubRef,
    replaceHomeStatesByHub,
    modelActiveTodayHubUri,
    modelActiveEditorTabId,
    modelEditorWorkspaceTabs,
    modelHomeStatesByHub,
    modelDerivedPersistence,
    todayHubWorkspacesForSwitch,
    tabsControllerSurface,
    showTodayHubCanvas,
    showTodayHubCanvasRef,
    todayHubSettings,
    todayHubSettingsRef,
    todayHubBridgeRef,
    todayHubWikiNavParentRef,
    todayHubCellEditorRef,
    todayHubRowLastPersistedRef,
    todayHubSelectorItems,
    workspaceSelectShowsActiveTabPill,
    workspaceSelectorSubLabel,
    projectHomeStatesFromModel,
    remapHomeStatesPrefix,
    removeHomeHistoryUris,
    setHomeStateForHub,
    pushHomeHistoryForHub,
    prehydrateTodayHubRows,
    persistTodayHubRow,
    todayHubCleanRowBlocked,
    syncShadowWorkspaceFromShellRestore,
    switchTodayHubWorkspace,
    focusActiveTodayHubNote,
    selectHomeCurrentNote,
    activateWorkspaceHomeSelector,
    openWorkspaceHomeCurrentInBackgroundTab,
  };
}

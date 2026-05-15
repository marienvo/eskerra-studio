/**
 * Main-window vault workspace: orchestration hook (Tauri FS, editor tabs, Today hub, wiki rename).
 *
 * Ownership: wire platform I/O and React state here; prefer extracted modules for focused logic
 * (`workspaceFsWatchReconcile`, `workspaceEditorTabs`, `workspaceEditorHistoryNavigation`, `workspaceVaultTreeMutations`, `inboxShellRestoreHelpers`,
 * `workspaceShadowBridge`, `workspacePersistenceBridge`, `workspaceInboxShellRestoreBridge`,
 * `workspaceHomeHistoryShadowSync`).
 *
 * Remaining split candidates: wiki-link routing, rename-with-maintenance, and vault bootstrap
 * side-effects → `hooks/workspace*.ts` helpers with tests for pure branches.
 */
import {load} from '@tauri-apps/plugin-store';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react';

import {
  buildInboxMarkdownFromCompose,
  collectVaultMarkdownRefs,
  ensureDeviceInstanceId,
  markdownContainsTransientImageUrls,
  mergeYamlFrontmatterBody,
  fencedFrontmatterBlockToInner,
  innerToFencedFrontmatterBlock,
  normalizeVaultBaseUri,
  parseComposeInput,
  splitYamlFrontmatter,
  SubtreeMarkdownPresenceCache,
  isVaultPathUnderAutosyncBackup,
  trimTrailingSlashes,
  type EskerraSettings,
  type VaultFilesystem,
  type VaultMarkdownRef,
} from '@eskerra/core';

import type {NoteMarkdownEditorHandle} from '../editor/noteEditor/NoteMarkdownEditor';
import {persistTransientMarkdownImages} from '../lib/persistTransientMarkdownImages';
import {
  bootstrapVaultLayout,
  createInboxMarkdownNote,
  deleteVaultMarkdownNote,
  deleteVaultTreeDirectory,
  listInboxNotes,
  moveVaultTreeItemToDirectory,
  type MoveVaultTreeItemResult,
  readVaultLocalSettings,
  readVaultSettings,
  renameVaultTreeDirectory,
  saveNoteMarkdown,
  writeVaultLocalSettings,
} from '../lib/vaultBootstrap';
import {
  filterVaultTreeBulkMoveSources,
  planVaultTreeBulkTargets,
  type VaultTreeBulkItem,
} from '../lib/vaultTreeBulkPlan';
import {
  normalizeTodayHubRowForDisk,
  splitTodayRowIntoColumns,
  todayHubRowSectionsAllBlank,
  createIdleTodayHubWorkspaceBridge,
  type TodayHubSettings,
  type TodayHubWorkspaceBridge,
} from '../lib/todayHub';
import {vaultUriIsTodayMarkdownFile} from '../lib/vaultTreeLoadChildren';
import {
  getVaultSession,
  setVaultSession,
  startVaultWatch,
} from '../lib/tauriVault';
import {
  vaultFrontmatterIndexSchedule,
} from '../lib/tauriVaultFrontmatter';
import {vaultSearchIndexSchedule} from '../lib/tauriVaultSearch';
import {
  normalizeEditorDocUri,
  remapVaultUriPrefix,
} from '../lib/editorDocumentHistory';
import {
  type ClosedEditorTabRecord,
  hasReopenableClosedEditorTab,
  popNextReopenableClosedTabRecord,
} from '../lib/editorClosedTabStack';
import {
  createEditorWorkspaceTab,
  ensureActiveTabId,
  findTabById,
  findTabIdWithCurrentUri,
  firstSurvivorUriFromTabs,
  insertTabAfterActive,
  insertTabAtIndex,
  pickNeighborTabIdAfterRemovingTab,
  pushClosedWorkspaceTabsFromCloseAll,
  pushClosedWorkspaceTabsFromCloseOther,
  remapAllTabsUriPrefix,
  removeUriFromAllTabs,
  reorderEditorWorkspaceTabsInArray,
  tabCurrentUri,
  tabsToStored,
  type EditorWorkspaceTab,
} from '../lib/editorWorkspaceTabs';
import {
  deriveTodayHubShowCanvas,
  deriveTodayHubSettings,
  deriveTodayHubSelectorItems,
} from './workspaceTodayHubDerived';
import {useWorkspaceTodayHubSwitch} from './workspaceTodayHubSwitch';
import type {TodayHubWorkspaceSnapshot} from '../lib/mainWindowUiStore';
import {sortedTodayHubNoteUrisFromRefs} from '@eskerra/core';
import {pickDefaultActiveTodayHubUri} from '../lib/todayHub/todayHubWorkspaceRestore';
import {
  selectNoteActiveHubTodayOpen,
  isOnWorkspaceHome,
  workspaceSelectorMainShowsActiveTabPill,
  workspaceSelectorSubLabelText,
} from '../lib/workspaceShellToday';
import {
  createWorkspaceHomeState,
  homeCurrentUri,
  pushHomeNavigate,
  type WorkspaceHomeState,
} from '../lib/workspaceHomeNavigation';
import {hydrateWorkspaceHomeStatesFromPersisted} from '../lib/workspaceHomePersistence';
import {
  applyIncomingHubWorkspaceAction,
  syncHubWorkspacesToVaultTodayRefsAction,
  closeAllTabsAction,
  closeOtherTabsAction,
  closeTabAction,
  openTabBackgroundAction,
  remapPrefixAction,
  removeUrisAction,
  reorderTabsAction,
  normalizeWorkspaceUri,
  type OpenTabBackgroundOptions,
  type WorkspaceModel,
} from '../lib/workspaceModel';
import type {
  WorkspaceConflictController,
  WorkspaceFrontmatterController,
  WorkspaceLinkController,
  WorkspaceNotificationsState,
  WorkspacePersistenceController,
  WorkspaceSelectionController,
  WorkspaceTabsController,
  WorkspaceTodayHubController,
  WorkspaceTreeController,
} from './workspaceReturnShape';
import {
  makeStoredTabFilter,
  mergeStoredHubWorkspaces,
  pickFinalActiveHub,
  resolveActiveHubAndTabsSource,
  restoredTodayHubWorkspaceUrisForRestore,
} from './inboxShellRestoreHelpers';
import {
  applyRestoredEditorWorkspaceTabsBridge,
  migrateLegacyOpenTabsIfNeededBridge,
  restoreInboxSelectionAfterShellRestoreBridge,
  runDeferredShellRestoreTabStateAndShadowSync,
  type ShellRestoreProjectionSyncArgs,
} from './workspaceInboxShellRestoreBridge';
import {
  remapHomeStatesPrefixBridge,
  removeHomeHistoryUrisBridge,
} from './workspaceHomeHistoryShadowSync';
import {
  type DiskConflictSoftState,
  type DiskConflictState,
  type LastPersisted,
  fingerprintUtf16ForDebug,
} from './workspaceFsWatchReconcile';
import {
  applyForegroundOpenTabPlacement,
  decideHomeOpenMode,
} from './workspaceEditorTabs';
import {
  computeEditorHistoryCanGoBack,
  computeEditorHistoryCanGoForward,
  deriveActiveTabHistorySnapshot,
  moveHomeHistoryBridge,
  openCurrentHomeAfterComposingBridge,
  runEditorHistoryGoBack,
  runEditorHistoryGoForward,
} from './workspaceEditorHistoryNavigation';
import {bulkDeleteUriRemovalPredicate, pruneEditorTabsAfterBulkTreeDelete} from './workspaceVaultTreeMutations';
import {useWorkspaceBacklinks} from './workspaceBacklinks';
import {useWorkspaceLinkRouting} from './workspaceLinkRouting';
import {useWorkspacePersistence} from './workspacePersistence';
import {
  normalizeVaultWatchErrorReason,
  useWorkspaceVaultWatchEffects,
} from './workspaceVaultWatchEffects';
import {useWorkspaceController} from './useWorkspaceController';
import {
  deriveModelDerivedPersistencePayload,
} from './workspacePersistenceBridge';
import {
  createWorkspaceShadowMirrorCallbacks,
} from './workspaceShadowBridge';
import {
  activeEditorWorkspaceTabsFromWorkspaceModel,
  activeSurfaceTabIdFromWorkspaceModel,
  editorWorkspaceTabsFromModelTabEntries,
  legacyEditorWorkspaceTabsSignature,
  projectWorkspaceRuntimeToModel,
  resolveModelBackedLegacyTabStrip,
  tabsControllerEditorSurface,
  workspaceHomeStatesFromWorkspaceModel,
  workspaceHomeStatesSignature,
  workspaceStateForIncomingHubSwitch,
} from './workspaceRuntimeProjection';
import {
  assignLegacyRuntimeActiveHub,
  assignLegacyRuntimeActiveSurfaceTab,
  workspaceHubUriEqual,
} from './workspaceRuntimeActiveLegacyBridge';
import {assignLegacyEditorWorkspaceTabs} from './workspaceRuntimeTabsLegacyBridge';
import {
  useWorkspaceRenameMaintenance,
  type WorkspaceRenameMaintenanceCommitArgs,
  type WorkspaceRenameMaintenanceSnapshot,
} from './workspaceRenameMaintenance';
import {
  type InboxEditorShellScrollDirective,
  snapshotEditorShellScrollForOpenNote,
  remapEditorShellScrollMapExact,
  remapEditorShellScrollMapTreePrefix,
} from './workspaceEditorScrollMap';
import {cleanNoteMarkdownBody} from '../lib/cleanNoteMarkdown';
import {captureObservabilityMessage} from '../observability/captureObservabilityMessage';
import {
  clearInboxYamlFrontmatterEditorRefs,
  inboxEditorSliceToFullMarkdown,
} from '../lib/inboxYamlFrontmatterEditor';
import {
  loadVaultMarkdownBodiesWithSeed,
  mergeInboxNoteBodyIntoCache,
  resolveInboxCachedBodyForEditor,
  normalizeVaultMarkdownDiskRead,
  removeInboxNoteBodyFromCache,
} from './inboxNoteBodyCache';
import {resolveVaultLinkBaseMarkdownUri} from '../lib/resolveVaultLinkBaseMarkdownUri';

/** Canonical vault root string for comparing persisted shell snapshots to the active vault. */
function normalizedVaultRootPath(vaultRoot: string): string {
  return trimTrailingSlashes(normalizeVaultBaseUri(vaultRoot).replace(/\\/g, '/'));
}

const STORE_PATH = 'eskerra-desktop.json';
const STORE_KEY_VAULT = 'vaultRoot';

/** Debounce scan of the active note body for backlinks (full vault scan is too heavy per keystroke). */
const INBOX_BACKLINK_BODY_DEBOUNCE_MS = 200;

type NoteRow = {lastModified: number | null; name: string; uri: string};

function assignLegacyHomeStatesByHub(
  ref: {current: Record<string, WorkspaceHomeState>},
  setHomeStatesByHub: Dispatch<SetStateAction<Record<string, WorkspaceHomeState>>>,
  next: Record<string, WorkspaceHomeState>,
): void {
  ref.current = next;
  setHomeStatesByHub(next);
}

function assignInboxShellRestored(
  setInboxShellRestored: (next: boolean) => void,
  next: boolean,
): void {
  setInboxShellRestored(next);
}

type OpenMarkdownInEditorOptions = {
  skipHistory?: boolean;
  newTab?: boolean;
  /** When `newTab` is true: default `true` (focus new tab). */
  activateNewTab?: boolean;
  /**
   * When creating a new tab: insert at `activeIndex + 1` (or index `0` if no active tab)
   * instead of appending at the end.
   */
  insertAfterActive?: boolean;
  /**
   * When creating a new tab: insert at this index (clamped to strip length).
   * Takes precedence over `insertAfterActive`.
   */
  insertAtIndex?: number;
  /** Open this note on the active workspace Home surface without changing tabs. */
  home?: boolean;
  /** @deprecated Use `home`. */
  workspaceShell?: boolean;
  /** @deprecated Use `home`. */
  workspaceShellPreserveTabs?: boolean;
};

export type UseMainWindowWorkspaceResult = {
  vaultRoot: string | null;
  vaultSettings: EskerraSettings | null;
  setVaultSettings: Dispatch<SetStateAction<EskerraSettings | null>>;
  settingsName: string;
  busy: boolean;
  fsRefreshNonce: number;
  /** Increments only when files in `General/` change — used to scope podcast catalog rescans. */
  podcastFsNonce: number;
  deviceInstanceId: string;
  selectionController: WorkspaceSelectionController;
  notificationsState: WorkspaceNotificationsState;
  conflictController: WorkspaceConflictController;
  hydrateVault: (root: string) => Promise<void>;
  persistenceController: WorkspacePersistenceController;
  linkController: WorkspaceLinkController;
  treeController: WorkspaceTreeController;
  /** True once persisted inbox shell state has been considered for the current vault. */
  inboxShellRestored: boolean;
  /** True after the first vault bootstrap attempt from persisted session (success, empty, or error). */
  initialVaultHydrateAttemptDone: boolean;
  tabsController: WorkspaceTabsController;
  todayHubController: WorkspaceTodayHubController;
  frontmatterController: WorkspaceFrontmatterController;
  /** Test-only shadow model for the workspaceModel migration bridge. */
  workspaceShadowModelForTests?: WorkspaceModel;
};

export function useMainWindowWorkspace(options: {
  fs: VaultFilesystem;
  inboxEditorRef: RefObject<NoteMarkdownEditorHandle | null>;
  /** `.note-markdown-editor-scroll`: used to snapshot and restore scroll offsets per note URI. */
  inboxEditorShellScrollRef: RefObject<HTMLDivElement | null>;
  restoredInboxState: {
    vaultRoot: string;
    composingNewEntry: boolean;
    selectedUri: string | null;
    openTabUris?: readonly string[] | null;
    editorWorkspaceTabs?: ReadonlyArray<{
      id: string;
      entries: string[];
      index: number;
    }> | null;
    activeEditorTabId?: string | null;
    activeTodayHubUri?: string | null;
    todayHubWorkspaces?: Record<string, TodayHubWorkspaceSnapshot> | null;
  } | null;
  inboxRestoreEnabled: boolean;
}): UseMainWindowWorkspaceResult {
  const {
    fs,
    inboxEditorRef,
    inboxEditorShellScrollRef,
    restoredInboxState,
    inboxRestoreEnabled,
  } = options;
  const [vaultRoot, setVaultRoot] = useState<string | null>(null);
  const [vaultSettings, setVaultSettings] = useState<EskerraSettings | null>(null);
  const [settingsName, setSettingsName] = useState('Eskerra');
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [selectedUri, setSelectedUri] = useState<string | null>(null);
  const [editorBody, setEditorBody] = useState('');
  const [inboxEditorResetNonce, setInboxEditorResetNonce] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [diskConflict, setDiskConflict] = useState<DiskConflictState | null>(null);
  const diskConflictRef = useRef<DiskConflictState | null>(null);
  const [diskConflictSoft, setDiskConflictSoft] = useState<DiskConflictSoftState | null>(null);
  const diskConflictSoftRef = useRef<DiskConflictSoftState | null>(null);
  const lastInboxEditorActivityAtRef = useRef(0);
  const skipRecencyDeferForUriRef = useRef<Set<string>>(new Set());
  const diskConflictDeferTimerRef = useRef<number | null>(null);
  const [composingNewEntry, setComposingNewEntry] = useState(false);
  // showTodayHubCanvas derives from selection; see useMemo below.
  const [inboxContentByUri, setInboxContentByUri] = useState<Record<string, string>>({});
  const [vaultMarkdownRefs, setVaultMarkdownRefs] = useState<VaultMarkdownRef[]>([]);
  const [fsRefreshNonce, setFsRefreshNonce] = useState(0);
  const [podcastFsNonce, setPodcastFsNonce] = useState(0);
  const [vaultTreeSelectionClearNonce, setVaultTreeSelectionClearNonce] = useState(0);
  const [deviceInstanceId, setDeviceInstanceId] = useState('');
  const [initialVaultHydrateAttemptDone, setInitialVaultHydrateAttemptDone] =
    useState(false);
  const [inboxShellRestored, setInboxShellRestored] = useState(!inboxRestoreEnabled);
  const [editorWorkspaceTabs, setEditorWorkspaceTabs] = useState<
    EditorWorkspaceTab[]
  >([]);
  const [activeEditorTabId, setActiveEditorTabId] = useState<string | null>(
    null,
  );
  const [activeTodayHubUri, setActiveTodayHubUri] = useState<string | null>(
    null,
  );
  /**
   * Per-hub workspace snapshots for inactive hubs (last switch-out / restore).
   * `WorkspaceModel` is authoritative for active hub, active surface, tab strip, Home history,
   * and disk persistence. These legacy fields remain only as synchronous mirrors for command
   * paths that read refs before React commits.
   */
  const [homeStatesByHub, setHomeStatesByHub] = useState<
    Record<string, WorkspaceHomeState>
  >({});
  const [editorClosedStackVersion, setEditorClosedStackVersion] = useState(0);
  const [editorClosedTabsStackSnapshot, setEditorClosedTabsStackSnapshot] = useState<
    ClosedEditorTabRecord[]
  >([]);
  const [mergeView, setMergeView] = useState<
    | null
    | {kind: 'backup'; baseUri: string; backupUri: string}
    | {kind: 'diskConflict'; baseUri: string; diskMarkdown: string}
  >(null);
  const {
    model: workspaceShadowModel,
    dispatchWorkspaceAction,
    dispatchWorkspaceActionSync,
  } = useWorkspaceController();

  const {
    replaceShadowHomeStateForHub,
    mirrorShadowActiveHub,
    mirrorShadowHomeSurface,
    mirrorShadowActiveTab,
    mirrorShadowActiveWorkspaceTabs,
  } = useMemo(
    () => createWorkspaceShadowMirrorCallbacks(dispatchWorkspaceAction),
    [dispatchWorkspaceAction],
  );

  const subtreeMarkdownCache = useMemo(() => new SubtreeMarkdownPresenceCache(), []);
  const inboxBodyPrefetchGenRef = useRef(0);
  const vaultRefsBuildGenRef = useRef(0);
  const vaultMarkdownRefsRef = useRef<VaultMarkdownRef[]>([]);
  const vaultRootRef = useRef<string | null>(null);
  const selectedUriRef = useRef<string | null>(null);
  const composingNewEntryRef = useRef(false);
  const showTodayHubCanvasRef = useRef(false);
  const editorBodyRef = useRef('');
  const lastPersistedRef = useRef<LastPersisted | null>(null);
  const lastPersistedExternalMutationSeqRef = useRef(0);
  const eagerEditorLoadUriRef = useRef<string | null>(null);
  const suppressEditorOnChangeRef = useRef(false);
  /** YAML inner (between `---` fences); paired ref for autosave hot path. */
  const [inboxYamlFrontmatterInner, setInboxYamlFrontmatterInner] = useState<
    string | null
  >(null);
  const inboxYamlFrontmatterInnerRef = useRef<string | null>(null);
  /** Mirror of leading-before-frontmatter (paired with inner) for use in render-time memos. */
  const [inboxEditorYamlLeadingBeforeFrontmatter, setInboxEditorYamlLeadingBeforeFrontmatter] =
    useState('');
  const inboxEditorYamlLeadingBeforeFrontmatterRef = useRef('');
  const todayHubBridgeRef = useRef<TodayHubWorkspaceBridge>(
    createIdleTodayHubWorkspaceBridge(),
  );
  const todayHubWikiNavParentRef = useRef<string | null>(null);
  const todayHubCellEditorRef = useRef<NoteMarkdownEditorHandle | null>(null);
  const todayHubRowLastPersistedRef = useRef<Map<string, string>>(new Map());
  const todayHubSettingsRef = useRef<TodayHubSettings | null>(null);
  const submitNewEntryRef = useRef<() => Promise<void>>(async () => {});
  const inboxContentByUriRef = useRef<Record<string, string>>({});
  const editorWorkspaceTabsRef = useRef<EditorWorkspaceTab[]>([]);
  const activeEditorTabIdRef = useRef<string | null>(null);
  const activeTodayHubUriRef = useRef<string | null>(null);
  const homeStatesByHubRef = useRef<Record<string, WorkspaceHomeState>>({});
  /** User-initiated tab closes only (for Reopen closed tab). */
  const editorClosedTabsStackRef = useRef<ClosedEditorTabRecord[]>([]);
  const notesRef = useRef<NoteRow[]>([]);
  const editorShellScrollByUriRef = useRef(
    new Map<string, {top: number; left: number}>(),
  );
  const inboxEditorShellScrollDirectiveRef =
    useRef<InboxEditorShellScrollDirective | null>(null);
  /** Invalidates in-flight `openMarkdownInEditor` work when a newer open supersedes it. */
  const openMarkdownGenerationRef = useRef(0);

  useLayoutEffect(() => {
    inboxYamlFrontmatterInnerRef.current = inboxYamlFrontmatterInner;
  }, [inboxYamlFrontmatterInner]);

  useLayoutEffect(() => {
    inboxEditorYamlLeadingBeforeFrontmatterRef.current =
      inboxEditorYamlLeadingBeforeFrontmatter;
  }, [inboxEditorYamlLeadingBeforeFrontmatter]);

  const syncFrontmatterStateFromDisk = useCallback(
    (nextInner: string | null, leading: string) => {
      inboxYamlFrontmatterInnerRef.current = nextInner;
      setInboxYamlFrontmatterInner(nextInner);
      inboxEditorYamlLeadingBeforeFrontmatterRef.current = leading;
      setInboxEditorYamlLeadingBeforeFrontmatter(leading);
    },
    [],
  );

  const applyFrontmatterInnerChange = useCallback((nextInner: string | null) => {
    if (composingNewEntryRef.current) {
      return;
    }
    if (!selectedUriRef.current) {
      return;
    }
    inboxYamlFrontmatterInnerRef.current = nextInner;
    setInboxYamlFrontmatterInner(nextInner);
  }, []);

  useLayoutEffect(() => {
    diskConflictRef.current = diskConflict;
  }, [diskConflict]);

  useLayoutEffect(() => {
    diskConflictSoftRef.current = diskConflictSoft;
  }, [diskConflictSoft]);

  useLayoutEffect(() => {
    vaultRootRef.current = vaultRoot;
  }, [vaultRoot]);

  useLayoutEffect(() => {
    selectedUriRef.current = selectedUri;
  }, [selectedUri]);

  useLayoutEffect(() => {
    composingNewEntryRef.current = composingNewEntry;
  }, [composingNewEntry]);

  useLayoutEffect(() => {
    editorBodyRef.current = editorBody;
  }, [editorBody]);

  useLayoutEffect(() => {
    inboxContentByUriRef.current = inboxContentByUri;
  }, [inboxContentByUri]);

  const guardedSetEditorBody: typeof setEditorBody = useCallback(
    value => {
      if (suppressEditorOnChangeRef.current) return;
      lastInboxEditorActivityAtRef.current = Date.now();
      setEditorBody(value);
    },
    [],
  );

  const loadFullMarkdownIntoInboxEditor = useCallback(
    (
      full: string,
      uri: string | null,
      selection: 'start' | 'end' | 'preserve' = 'start',
    ) => {
      const composing = composingNewEntryRef.current;
      if (!uri || composing) {
        syncFrontmatterStateFromDisk(null, '');
        suppressEditorOnChangeRef.current = true;
        inboxEditorRef.current?.loadMarkdown(full, {selection});
        suppressEditorOnChangeRef.current = false;
        setEditorBody(full);
        editorBodyRef.current = full;
        return;
      }
      const {frontmatter, body, leadingBeforeFrontmatter} =
        splitYamlFrontmatter(full);
      const inner =
        frontmatter !== null
          ? fencedFrontmatterBlockToInner(frontmatter)
          : null;
      syncFrontmatterStateFromDisk(
        inner,
        frontmatter !== null ? leadingBeforeFrontmatter : '',
      );
      suppressEditorOnChangeRef.current = true;
      inboxEditorRef.current?.loadMarkdown(body, {selection});
      suppressEditorOnChangeRef.current = false;
      setEditorBody(body);
      editorBodyRef.current = body;
    },
    [inboxEditorRef, setEditorBody, syncFrontmatterStateFromDisk],
  );

  useLayoutEffect(() => {
    editorWorkspaceTabsRef.current = editorWorkspaceTabs;
  }, [editorWorkspaceTabs]);

  useLayoutEffect(() => {
    activeEditorTabIdRef.current = activeEditorTabId;
  }, [activeEditorTabId]);

  useLayoutEffect(() => {
    activeTodayHubUriRef.current = activeTodayHubUri;
  }, [activeTodayHubUri]);

  useLayoutEffect(() => {
    homeStatesByHubRef.current = homeStatesByHub;
  }, [homeStatesByHub]);

  const remapHomeStatesPrefix = useCallback(
    (oldPrefix: string, newPrefix: string) => {
      if (oldPrefix === newPrefix) {
        return;
      }
      remapHomeStatesPrefixBridge(
        {
          homeStatesByHubRef,
          setHomeStatesByHub,
        },
        oldPrefix,
        newPrefix,
      );
      dispatchWorkspaceActionSync(
        'remap vault uri prefix',
        m => remapPrefixAction(m, oldPrefix, newPrefix),
      );
    },
    [dispatchWorkspaceActionSync],
  );

  const removeHomeHistoryUris = useCallback(
    (shouldRemove: (normalizedUri: string) => boolean) => {
      removeHomeHistoryUrisBridge(
        {
          homeStatesByHubRef,
          setHomeStatesByHub,
        },
        shouldRemove,
      );
      dispatchWorkspaceActionSync(
        'remove uris',
        m => removeUrisAction(m, shouldRemove),
      );
    },
    [dispatchWorkspaceActionSync],
  );

  const setHomeStateForHub = useCallback(
    (hubUri: string, state: WorkspaceHomeState) => {
      const next = {
        ...homeStatesByHubRef.current,
        [hubUri]: state,
      };
      homeStatesByHubRef.current = next;
      setHomeStatesByHub(next);
      replaceShadowHomeStateForHub(hubUri, state, 'homeHistory set');
    },
    [replaceShadowHomeStateForHub],
  );

  const pushHomeHistoryForHub = useCallback(
    (hubUri: string, targetUri: string) => {
      const currentHome =
        homeStatesByHubRef.current[hubUri] ?? createWorkspaceHomeState(hubUri);
      setHomeStateForHub(hubUri, pushHomeNavigate(currentHome, targetUri));
    },
    [setHomeStateForHub],
  );

  const {
    selectedNoteBacklinkUris,
    inboxBacklinksDeferNonce,
    backlinksActiveBodyRef,
    setBacklinksActiveBody,
    scheduleBacklinksDeferOneFrameAfterLoad,
    clearInboxBacklinksDeferAfterLoad,
    clearBacklinkDiskBodyCache,
  } = useWorkspaceBacklinks({
    fs,
    vaultRoot,
    composingNewEntry,
    selectedUri,
    vaultMarkdownRefs,
    inboxContentByUri,
    selectedUriRef,
    vaultMarkdownRefsRef,
    inboxContentByUriRef,
  });

  useLayoutEffect(() => {
    notesRef.current = notes;
  }, [notes]);

  const bumpEditorClosedStack = useCallback(() => {
    setEditorClosedStackVersion(v => v + 1);
    setEditorClosedTabsStackSnapshot([...editorClosedTabsStackRef.current]);
  }, []);

  /* editorClosedStackVersion re-runs this when the ref-backed closed-tab stack mutates. */
  const canReopenClosedEditorTab = useMemo(() => {
    if (!vaultRoot) {
      return false;
    }
    const noteSet = new Set(notes.map(n => n.uri.replace(/\\/g, '/')));
    return hasReopenableClosedEditorTab(editorClosedTabsStackSnapshot, vaultRoot, noteSet);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- editorClosedStackVersion syncs ref stack mutations to UI
  }, [vaultRoot, notes, editorClosedStackVersion, editorClosedTabsStackSnapshot]);

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
    dispatchWorkspaceActionSync('sync today hub workspaces to vault refs', m =>
      syncHubWorkspacesToVaultTodayRefsAction(m, workspaceModelHubUris),
    );
  }, [
    inboxShellRestored,
    workspaceModelHubUris,
    dispatchWorkspaceActionSync,
  ]);

  useLayoutEffect(() => {
    if (!inboxShellRestored) {
      return;
    }
    if (!workspaceHubUriEqual(activeTodayHubUriRef.current, modelActiveTodayHubUri)) {
      assignLegacyRuntimeActiveHub(modelActiveTodayHubUri, {
        ref: activeTodayHubUriRef,
        setActiveTodayHubUri,
      });
    }
    if (modelActiveTodayHubUri != null) {
      const legacyTabsSig = legacyEditorWorkspaceTabsSignature(
        editorWorkspaceTabsRef.current,
      );
      const modelTabsSig = legacyEditorWorkspaceTabsSignature(modelEditorWorkspaceTabs);
      if (legacyTabsSig !== modelTabsSig) {
        assignLegacyEditorWorkspaceTabs({
          nextTabs: modelEditorWorkspaceTabs,
          editorWorkspaceTabsRef,
          setEditorWorkspaceTabs,
        });
      }
      if (activeEditorTabIdRef.current !== modelActiveEditorTabId) {
        assignLegacyRuntimeActiveSurfaceTab(modelActiveEditorTabId, {
          ref: activeEditorTabIdRef,
          setActiveEditorTabId,
        });
      }
    }
    if (
      workspaceHomeStatesSignature(homeStatesByHubRef.current) !==
      workspaceHomeStatesSignature(modelHomeStatesByHub)
    ) {
      homeStatesByHubRef.current = modelHomeStatesByHub;
      setHomeStatesByHub(modelHomeStatesByHub);
    }
  }, [
    inboxShellRestored,
    modelActiveTodayHubUri,
    modelActiveEditorTabId,
    modelEditorWorkspaceTabs,
    modelHomeStatesByHub,
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

  useEffect(() => {
    vaultMarkdownRefsRef.current = vaultMarkdownRefs;
  }, [vaultMarkdownRefs]);

  const showTodayHubCanvas = useMemo(
    () => deriveTodayHubShowCanvas(vaultRoot, selectedUri, composingNewEntry),
    [vaultRoot, selectedUri, composingNewEntry],
  );

  useLayoutEffect(() => {
    showTodayHubCanvasRef.current = showTodayHubCanvas;
  }, [showTodayHubCanvas]);

  // Use `inboxYamlFrontmatterInner` state in the merge (not only the ref) so deps match and Today hub
  // refreshes on frontmatter-only edits. Leading still comes from the ref (updated with inner on disk sync).
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

  const refreshNotes = useCallback(
    async (root: string) => {
      const gen = ++inboxBodyPrefetchGenRef.current;
      const list = await listInboxNotes(root, fs);
      if (gen !== inboxBodyPrefetchGenRef.current) {
        return;
      }
      setNotes(list);
    },
    [fs],
  );

  const [vaultWriteSettledNonce, setVaultWriteSettledNonce] = useState(0);
  const markVaultWriteSettled = useCallback(() => {
    setVaultWriteSettledNonce(n => n + 1);
  }, []);

  const {
    saveChainRef,
    saveActiveRef,
    autosaveSchedulerRef,
    flushInboxSaveRef,
    mergeInboxNoteBodyCacheRefAndState,
    enqueuePersistOutgoingNoteMarkdown,
    flushInboxSave,
    onInboxSaveShortcut,
  } = useWorkspacePersistence({
    fs,
    vaultRoot,
    selectedUri,
    composingNewEntry,
    editorBody,
    inboxYamlFrontmatterInner,
    diskConflict,
    vaultRootRef,
    selectedUriRef,
    composingNewEntryRef,
    diskConflictRef,
    inboxContentByUriRef,
    editorBodyRef,
    lastPersistedRef,
    lastPersistedExternalMutationSeqRef,
    inboxYamlFrontmatterInnerRef,
    inboxEditorYamlLeadingBeforeFrontmatterRef,
    inboxEditorRef,
    todayHubBridgeRef,
    submitNewEntryRef,
    setErr,
    setInboxContentByUri,
    refreshNotes,
    onVaultWriteSettled: markVaultWriteSettled,
    loadFullMarkdownIntoInboxEditor,
    scheduleBacklinksDeferOneFrameAfterLoad,
  });

  const getRenameMaintenanceSnapshot =
    useCallback(async (): Promise<WorkspaceRenameMaintenanceSnapshot> => {
      const wikiRefs = vaultMarkdownRefsRef.current.map(r => ({name: r.name, uri: r.uri}));
      const activeUri = selectedUriRef.current;
      const activeBody =
        activeUri != null
          ? inboxEditorSliceToFullMarkdown(
              inboxEditorRef.current?.getMarkdown() ?? editorBodyRef.current,
              activeUri,
              composingNewEntryRef.current,
              inboxYamlFrontmatterInnerRef.current,
              inboxEditorYamlLeadingBeforeFrontmatterRef.current,
            )
          : '';
      const expandedContent = await loadVaultMarkdownBodiesWithSeed(
        fs,
        wikiRefs,
        inboxContentByUriRef.current,
        activeUri,
        activeBody,
      );
      return {wikiRefs, activeUri, activeBody, expandedContent};
    }, [fs, inboxEditorRef]);

  const commitRenameMaintenanceResult = useCallback(
    ({
      oldUri,
      nextUri,
      rewritePlan,
      applyResult,
    }: WorkspaceRenameMaintenanceCommitArgs) => {
      const succeededWriteUris = new Set(applyResult.succeededUris);
      const plannedContentByWriteUri = new Map<string, string>();
      for (const update of rewritePlan.updates) {
        const writeUri = update.uri === oldUri ? nextUri : update.uri;
        plannedContentByWriteUri.set(writeUri, update.markdown);
      }
      setInboxContentByUri(prev => {
        const next = {...prev};
        if (nextUri !== oldUri && prev[oldUri] !== undefined) {
          next[nextUri] = prev[oldUri];
          delete next[oldUri];
        }
        for (const [writeUri, markdown] of plannedContentByWriteUri) {
          if (succeededWriteUris.has(writeUri)) {
            next[writeUri] = markdown;
          }
        }
        return next;
      });
      if (selectedUriRef.current === oldUri) {
        selectedUriRef.current = nextUri;
        setSelectedUri(nextUri);
        const previousPersisted = lastPersistedRef.current;
        if (previousPersisted && previousPersisted.uri === oldUri) {
          lastPersistedRef.current = {uri: nextUri, markdown: previousPersisted.markdown};
          lastPersistedExternalMutationSeqRef.current += 1;
        }
      }
      if (nextUri !== oldUri) {
        remapEditorShellScrollMapExact(editorShellScrollByUriRef.current, oldUri, nextUri);
        const remappedRenameTabs = remapAllTabsUriPrefix(
          editorWorkspaceTabsRef.current,
          oldUri,
          nextUri,
        );
        assignLegacyEditorWorkspaceTabs({
          nextTabs: remappedRenameTabs,
          editorWorkspaceTabsRef,
          setEditorWorkspaceTabs,
        });
        remapHomeStatesPrefix(oldUri, nextUri);
      }
    },
    [remapHomeStatesPrefix],
  );

  const {
    wikiRenameNotice,
    renameLinkProgress,
    pendingWikiLinkAmbiguityRename,
    renameNote,
    confirmPendingWikiLinkAmbiguityRename,
    cancelPendingWikiLinkAmbiguityRename,
    clearRenameNotice,
    resetRenameMaintenanceState,
  } = useWorkspaceRenameMaintenance({
    vaultRoot,
    fs,
    autosaveSchedulerRef,
    flushInboxSaveRef,
    getSnapshot: getRenameMaintenanceSnapshot,
    commitRenameResult: commitRenameMaintenanceResult,
    refreshNotes,
    subtreeMarkdownCache,
    setBusy,
    setErr,
    setFsRefreshNonce,
  });

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
    [fs, saveChainRef],
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
                subtreeMarkdownCache.invalidateForMutation(
                  root,
                  norm,
                  'file',
                );
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
    [fs, refreshNotes, subtreeMarkdownCache, saveActiveRef, saveChainRef, markVaultWriteSettled],
  );

  const resolveDiskConflictReloadFromDisk = useCallback(() => {
    const c = diskConflictRef.current;
    const uri = selectedUriRef.current;
    if (!c || !uri || normalizeEditorDocUri(c.uri) !== normalizeEditorDocUri(uri)) {
      return;
    }
    const md = c.diskMarkdown;
    loadFullMarkdownIntoInboxEditor(md, uri, 'start');
    scheduleBacklinksDeferOneFrameAfterLoad();
    lastPersistedRef.current = {uri: c.uri, markdown: md};
    lastPersistedExternalMutationSeqRef.current += 1;
    const nextCache = mergeInboxNoteBodyIntoCache(
      inboxContentByUriRef.current,
      c.uri,
      md,
    );
    if (nextCache) {
      inboxContentByUriRef.current = nextCache;
      setInboxContentByUri(prev =>
        mergeInboxNoteBodyIntoCache(prev, c.uri, md) ?? prev,
      );
    }
    setDiskConflict(null);
    diskConflictRef.current = null;
    setDiskConflictSoft(null);
    diskConflictSoftRef.current = null;
    setErr(null);
  }, [loadFullMarkdownIntoInboxEditor, scheduleBacklinksDeferOneFrameAfterLoad]);

  const resolveDiskConflictKeepLocal = useCallback(() => {
    const c = diskConflictRef.current;
    const uri = selectedUriRef.current;
    if (!c || !uri || normalizeEditorDocUri(c.uri) !== normalizeEditorDocUri(uri)) {
      return;
    }
    autosaveSchedulerRef.current.cancel();
    lastPersistedRef.current = {uri: c.uri, markdown: c.diskMarkdown};
    lastPersistedExternalMutationSeqRef.current += 1;
    setDiskConflict(null);
    diskConflictRef.current = null;
    setDiskConflictSoft(null);
    diskConflictSoftRef.current = null;
    setErr(null);
  }, [autosaveSchedulerRef]);

  const elevateDiskConflictSoftToBlocking = useCallback(() => {
    const s = diskConflictSoftRef.current;
    const uri = selectedUriRef.current;
    if (!s || !uri || normalizeEditorDocUri(s.uri) !== normalizeEditorDocUri(uri)) {
      return;
    }
    autosaveSchedulerRef.current.cancel();
    const hard: DiskConflictState = {uri: s.uri, diskMarkdown: s.diskMarkdown};
    setDiskConflict(hard);
    diskConflictRef.current = hard;
    setDiskConflictSoft(null);
    diskConflictSoftRef.current = null;
  }, [autosaveSchedulerRef]);

  const dismissDiskConflictSoft = useCallback(() => {
    setDiskConflictSoft(null);
    diskConflictSoftRef.current = null;
    skipRecencyDeferForUriRef.current.clear();
  }, []);

  const clearStaleDiskConflictsForOpen = useCallback((targetNorm: string) => {
    const prevConflict = diskConflictRef.current;
    if (prevConflict && normalizeEditorDocUri(prevConflict.uri) !== targetNorm) {
      setDiskConflict(null);
      diskConflictRef.current = null;
    }
    const prevSoft = diskConflictSoftRef.current;
    if (prevSoft && normalizeEditorDocUri(prevSoft.uri) !== targetNorm) {
      setDiskConflictSoft(null);
      diskConflictSoftRef.current = null;
    }
  }, []);

  const prepareInboxScrollDirectiveForOpen = useCallback(
    (targetNorm: string, skipHistory: boolean) => {
      if (skipHistory) {
        const saved =
          editorShellScrollByUriRef.current.get(targetNorm) ?? {top: 0, left: 0};
        inboxEditorShellScrollDirectiveRef.current = {
          kind: 'restore',
          top: saved.top,
          left: saved.left,
        };
        return;
      }
      inboxEditorShellScrollDirectiveRef.current = {kind: 'snapTop'};
    },
    [],
  );

  /** Snapshot the currently open note into the cache, and enqueue a deferred persist if dirty. */
  const snapshotAndPersistCurrentNoteBeforeOpen = useCallback(() => {
    const root = vaultRootRef.current;
    const curUri = selectedUriRef.current;
    if (curUri == null || composingNewEntryRef.current) {
      return;
    }
    const snapMdForSlice =
      inboxEditorRef.current?.getMarkdown() ?? editorBodyRef.current;
    const snapshot = inboxEditorSliceToFullMarkdown(
      snapMdForSlice,
      curUri,
      false,
      inboxYamlFrontmatterInnerRef.current,
      inboxEditorYamlLeadingBeforeFrontmatterRef.current,
    );
    mergeInboxNoteBodyCacheRefAndState(curUri, snapshot);
    const prev = lastPersistedRef.current;
    const needsPersist =
      root != null && !(prev && prev.uri === curUri && prev.markdown === snapshot);
    if (needsPersist) {
      enqueuePersistOutgoingNoteMarkdown(curUri, snapshot);
    }
  }, [
    inboxEditorRef,
    enqueuePersistOutgoingNoteMarkdown,
    mergeInboxNoteBodyCacheRefAndState,
  ]);

  const tryPrefetchTargetBody = useCallback(
    async (targetNorm: string, openGen: number): Promise<string | undefined> => {
      try {
        const raw = await fs.readFile(targetNorm, {encoding: 'utf8'});
        if (openGen !== openMarkdownGenerationRef.current) {
          return undefined;
        }
        return normalizeVaultMarkdownDiskRead(raw);
      } catch (e) {
        if (openGen !== openMarkdownGenerationRef.current) {
          return undefined;
        }
        setErr(e instanceof Error ? e.message : String(e));
        return undefined;
      }
    },
    [fs],
  );

  /**
   * After a foreground open has placed the tab, resolve the body to load (prefetched or cached),
   * load it into the inbox editor, and commit selection state.
   */
  const loadOpenedNoteBodyAndApplySelection = useCallback(
    (targetNorm: string, prefetchBody: string | undefined) => {
      if (prefetchBody !== undefined) {
        lastPersistedRef.current = {uri: targetNorm, markdown: prefetchBody};
        lastPersistedExternalMutationSeqRef.current += 1;
        inboxContentByUriRef.current = {
          ...inboxContentByUriRef.current,
          [targetNorm]: prefetchBody,
        };
      }
      const resolvedEditorBody =
        prefetchBody !== undefined
          ? prefetchBody
          : inboxContentByUriRef.current[targetNorm];
      if (resolvedEditorBody !== undefined) {
        lastPersistedRef.current = {uri: targetNorm, markdown: resolvedEditorBody};
        lastPersistedExternalMutationSeqRef.current += 1;
        eagerEditorLoadUriRef.current = targetNorm;
        backlinksActiveBodyRef.current = resolvedEditorBody;
        loadFullMarkdownIntoInboxEditor(resolvedEditorBody, targetNorm, 'start');
        scheduleBacklinksDeferOneFrameAfterLoad();
      }
      selectedUriRef.current = targetNorm;
      composingNewEntryRef.current = false;
      if (prefetchBody !== undefined) {
        setInboxContentByUri(prev => {
          if (prev[targetNorm] === prefetchBody) {
            return prev;
          }
          return {...prev, [targetNorm]: prefetchBody};
        });
      }
      if (resolvedEditorBody !== undefined) {
        setBacklinksActiveBody(resolvedEditorBody);
      }
      setComposingNewEntry(false);
      setSelectedUri(targetNorm);
    },
    [
      backlinksActiveBodyRef,
      loadFullMarkdownIntoInboxEditor,
      scheduleBacklinksDeferOneFrameAfterLoad,
      setBacklinksActiveBody,
    ],
  );

  const applyBackgroundNewTabOpen = useCallback(
    (
      targetNorm: string,
      options:
        | {insertAtIndex?: number; insertAfterActive?: boolean}
        | undefined,
      prefetchBody: string | undefined,
    ) => {
      const newTab = createEditorWorkspaceTab(targetNorm);
      const curTabs = editorWorkspaceTabsRef.current;
      const activeId = activeEditorTabIdRef.current;
      let nextTabsLegacy: EditorWorkspaceTab[];
      let tabOpts: OpenTabBackgroundOptions;
      if (
        typeof options?.insertAtIndex === 'number'
        && Number.isFinite(options.insertAtIndex)
      ) {
        nextTabsLegacy = insertTabAtIndex(curTabs, options.insertAtIndex, newTab);
        tabOpts = {
          placement: 'insertAtIndex',
          tabId: newTab.id,
          insertAtIndex: options.insertAtIndex,
        };
      } else if (options?.insertAfterActive) {
        nextTabsLegacy = insertTabAfterActive(curTabs, activeId, newTab);
        tabOpts = {
          placement: 'insertAfterTab',
          tabId: newTab.id,
          insertAfterTabId: activeId,
        };
      } else {
        nextTabsLegacy = [...curTabs, newTab];
        tabOpts = {tabId: newTab.id};
      }

      const nextModel = dispatchWorkspaceActionSync(
        'background new tab',
        m => openTabBackgroundAction(m, targetNorm, tabOpts),
      );
      const {nextTabs, mismatch: tabStripMismatch} = resolveModelBackedLegacyTabStrip(
        nextModel,
        nextTabsLegacy,
        'signature',
      );
      if (tabStripMismatch?.kind === 'signature') {
        const warn =
          typeof process !== 'undefined' && process.env.NODE_ENV !== 'production';
        if (warn) {
          const {legacySig, derivedSig} = tabStripMismatch;
          console.warn(
            '[workspaceModel] applyBackgroundNewTabOpen: model strip mismatch vs legacy placement; using legacy strip',
            {legacySig, derivedSig},
          );
        }
      }

      assignLegacyEditorWorkspaceTabs({
        nextTabs,
        editorWorkspaceTabsRef,
        setEditorWorkspaceTabs,
        mirror: {
          mirrorShadowActiveWorkspaceTabs,
          activeEditorTabId: activeEditorTabIdRef.current,
          reason: 'background open tab',
        },
      });
      if (prefetchBody !== undefined) {
        inboxContentByUriRef.current = {
          ...inboxContentByUriRef.current,
          [targetNorm]: prefetchBody,
        };
        setInboxContentByUri(prev => {
          if (prev[targetNorm] === prefetchBody) {
            return prev;
          }
          return {...prev, [targetNorm]: prefetchBody};
        });
      }
    },
    [dispatchWorkspaceActionSync, mirrorShadowActiveWorkspaceTabs],
  );

  const placeForegroundMarkdownOpen = useCallback(
    (
      uri: string,
      targetNorm: string,
      options: OpenMarkdownInEditorOptions | undefined,
    ): {nextTabs: EditorWorkspaceTab[]; nextActiveId: string | null} => {
      let nextTabs = editorWorkspaceTabsRef.current;
      let nextActiveId = activeEditorTabIdRef.current;
      const homeMode = decideHomeOpenMode({
        targetNorm,
        activeTodayHubUri: activeTodayHubUriRef.current,
        activeEditorTabId: activeEditorTabIdRef.current,
        options,
      });
      if (homeMode === 'home') {
        nextTabs = [...editorWorkspaceTabsRef.current];
        nextActiveId = null;
        const hubUri = activeTodayHubUriRef.current;
        if (hubUri && options?.skipHistory !== true) {
          pushHomeHistoryForHub(hubUri, targetNorm);
        }
        return {nextTabs, nextActiveId};
      }
      return applyForegroundOpenTabPlacement({
        uri,
        targetNorm,
        tabs: nextTabs,
        activeId: nextActiveId,
        options,
      });
    },
    [pushHomeHistoryForHub],
  );

  const openMarkdownInEditor = useCallback(
    async (
      uri: string,
      options?: OpenMarkdownInEditorOptions,
    ) => {
      const openGen = ++openMarkdownGenerationRef.current;
      const targetNorm = normalizeEditorDocUri(uri);
      setMergeView(null);
      autosaveSchedulerRef.current.cancel();
      const hubBridge = todayHubBridgeRef.current;
      const needHubFlush =
        hubBridge.getLiveRowUri() != null || hubBridge.hasPendingHubFlush();
      if (needHubFlush) {
        await hubBridge.flushPendingEdits().catch(() => undefined);
      }
      if (openGen !== openMarkdownGenerationRef.current) {
        return;
      }
      if (diskConflictDeferTimerRef.current != null) {
        window.clearTimeout(diskConflictDeferTimerRef.current);
        diskConflictDeferTimerRef.current = null;
      }
      snapshotEditorShellScrollForOpenNote(
        inboxEditorShellScrollRef.current,
        selectedUriRef.current,
        composingNewEntryRef.current,
        editorShellScrollByUriRef.current,
      );
      clearStaleDiskConflictsForOpen(targetNorm);
      const isBackgroundNewTab =
        options?.newTab === true && options?.activateNewTab === false;

      if (!isBackgroundNewTab) {
        prepareInboxScrollDirectiveForOpen(targetNorm, options?.skipHistory === true);
      }

      snapshotAndPersistCurrentNoteBeforeOpen();
      if (openGen !== openMarkdownGenerationRef.current) {
        return;
      }

      let prefetchBody: string | undefined;
      const root = vaultRootRef.current;
      if (root != null && inboxContentByUriRef.current[targetNorm] === undefined) {
        prefetchBody = await tryPrefetchTargetBody(targetNorm, openGen);
        if (openGen !== openMarkdownGenerationRef.current) {
          return;
        }
      }

      if (isBackgroundNewTab) {
        applyBackgroundNewTabOpen(targetNorm, options, prefetchBody);
        return;
      }

      const {nextTabs, nextActiveId} = placeForegroundMarkdownOpen(
        uri,
        targetNorm,
        options,
      );

      // Foreground open keeps tab strip + active surface mirrors inline with selection/load sequencing
      // (see loadOpenedNoteBodyAndApplySelection); do not centralize with assignLegacyEditorWorkspaceTabs here.
      editorWorkspaceTabsRef.current = nextTabs;
      activeEditorTabIdRef.current = nextActiveId;
      setEditorWorkspaceTabs(nextTabs);
      setActiveEditorTabId(nextActiveId);
      mirrorShadowActiveWorkspaceTabs(
        nextTabs,
        nextActiveId,
        'foreground open tabs',
      );
      if (nextActiveId == null) {
        mirrorShadowHomeSurface('foreground open home surface');
      } else {
        mirrorShadowActiveTab(nextActiveId, 'foreground open active tab');
      }

      loadOpenedNoteBodyAndApplySelection(targetNorm, prefetchBody);
    },
    [
      autosaveSchedulerRef,
      inboxEditorShellScrollRef,
      clearStaleDiskConflictsForOpen,
      prepareInboxScrollDirectiveForOpen,
      snapshotAndPersistCurrentNoteBeforeOpen,
      tryPrefetchTargetBody,
      applyBackgroundNewTabOpen,
      placeForegroundMarkdownOpen,
      mirrorShadowActiveWorkspaceTabs,
      mirrorShadowHomeSurface,
      mirrorShadowActiveTab,
      loadOpenedNoteBodyAndApplySelection,
    ],
  );

  const selectHomeCurrentNote = useCallback(
    async (todayNoteUri: string) => {
      const homeState =
        homeStatesByHubRef.current[todayNoteUri] ?? createWorkspaceHomeState(todayNoteUri);
      const uri = homeCurrentUri(homeState) ?? todayNoteUri;
      await openMarkdownInEditor(uri, {home: true, skipHistory: true});
    },
    [openMarkdownInEditor],
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
    void openMarkdownInEditor(hubTodayUri, {home: true, skipHistory: true});
  }, [
    openMarkdownInEditor,
    mirrorShadowHomeSurface,
    selectHomeCurrentNote,
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
    void openMarkdownInEditor(uri, {
      newTab: true,
      activateNewTab: false,
      insertAfterActive: true,
    });
  }, [openMarkdownInEditor]);

  const closeMergeView = useCallback(() => {
    setMergeView(null);
  }, []);

  const tryEnterBackupMergeView = useCallback(
    async (backupUri: string): Promise<boolean> => {
      if (!isVaultPathUnderAutosyncBackup(backupUri)) {
        return false;
      }
      const baseUri = resolveVaultLinkBaseMarkdownUri({
        composingNewEntry: composingNewEntryRef.current,
        showTodayHubCanvas: showTodayHubCanvasRef.current,
        todayHubWikiNavParentUri: todayHubWikiNavParentRef.current,
        selectedUri: selectedUriRef.current,
      });
      if (!baseUri) {
        return false;
      }
      const normBase = normalizeEditorDocUri(baseUri);
      const normBackup = normalizeEditorDocUri(backupUri);
      const cur = selectedUriRef.current
        ? normalizeEditorDocUri(selectedUriRef.current)
        : null;
      if (cur !== normBase) {
        await openMarkdownInEditor(normBase, {skipHistory: true});
      }
      setMergeView({kind: 'backup', baseUri: normBase, backupUri: normBackup});
      return true;
    },
    [openMarkdownInEditor],
  );

  const applyFullBackupFromMerge = useCallback(async () => {
    const mv = mergeView;
    if (!mv) {
      return;
    }
    if (mv.kind === 'diskConflict') {
      resolveDiskConflictReloadFromDisk();
      setMergeView(null);
      return;
    }
    const normBase = normalizeEditorDocUri(mv.baseUri);
    const dc = diskConflictRef.current;
    if (dc && normalizeEditorDocUri(dc.uri) === normBase) {
      setErr(
        'Resolve the disk conflict on this note before replacing it from a backup.',
      );
      return;
    }
    try {
      setErr(null);
      const raw = await fs.readFile(mv.backupUri, {encoding: 'utf8'});
      loadFullMarkdownIntoInboxEditor(raw, normBase, 'start');
      const body =
        inboxEditorRef.current?.getMarkdown() ?? editorBodyRef.current;
      const full = inboxEditorSliceToFullMarkdown(
        body,
        normBase,
        false,
        inboxYamlFrontmatterInnerRef.current,
        inboxEditorYamlLeadingBeforeFrontmatterRef.current,
      );
      const nextCache = mergeInboxNoteBodyIntoCache(
        inboxContentByUriRef.current,
        normBase,
        body,
      );
      if (nextCache) {
        inboxContentByUriRef.current = nextCache;
        setInboxContentByUri(
          prev => mergeInboxNoteBodyIntoCache(prev, normBase, body) ?? prev,
        );
      }
      backlinksActiveBodyRef.current = body;
      setBacklinksActiveBody(body);
      setMergeView(null);
      enqueuePersistOutgoingNoteMarkdown(normBase, full);
      scheduleBacklinksDeferOneFrameAfterLoad();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [
    mergeView,
    resolveDiskConflictReloadFromDisk,
    fs,
    loadFullMarkdownIntoInboxEditor,
    inboxEditorRef,
    enqueuePersistOutgoingNoteMarkdown,
    scheduleBacklinksDeferOneFrameAfterLoad,
    backlinksActiveBodyRef,
    setBacklinksActiveBody,
  ]);

  const keepMyEditsFromMerge = useCallback(() => {
    resolveDiskConflictKeepLocal();
    setMergeView(null);
  }, [resolveDiskConflictKeepLocal]);

  const enterDiskConflictMergeView = useCallback(() => {
    const uri = selectedUriRef.current;
    if (!uri) return;
    const normUri = normalizeEditorDocUri(uri);

    const dc = diskConflictRef.current;
    if (dc && normalizeEditorDocUri(dc.uri) === normUri) {
      setMergeView({kind: 'diskConflict', baseUri: normUri, diskMarkdown: dc.diskMarkdown});
      return;
    }

    const s = diskConflictSoftRef.current;
    if (s && normalizeEditorDocUri(s.uri) === normUri) {
      autosaveSchedulerRef.current.cancel();
      const hard: DiskConflictState = {uri: s.uri, diskMarkdown: s.diskMarkdown};
      setDiskConflict(hard);
      diskConflictRef.current = hard;
      setDiskConflictSoft(null);
      diskConflictSoftRef.current = null;
      setMergeView({kind: 'diskConflict', baseUri: normUri, diskMarkdown: s.diskMarkdown});
    }
  }, [autosaveSchedulerRef]);

  const applyMergedBodyFromMerge = useCallback(
    (body: string) => {
      const mv = mergeView;
      if (!mv) return;
      const normBase = normalizeEditorDocUri(mv.baseUri);

      if (mv.kind === 'diskConflict') {
        autosaveSchedulerRef.current.cancel();
        const dc = diskConflictRef.current;
        if (dc) {
          lastPersistedRef.current = {uri: dc.uri, markdown: dc.diskMarkdown};
          lastPersistedExternalMutationSeqRef.current += 1;
        }
        setDiskConflict(null);
        diskConflictRef.current = null;
        setDiskConflictSoft(null);
        diskConflictSoftRef.current = null;
      } else {
        const dc = diskConflictRef.current;
        if (dc && normalizeEditorDocUri(dc.uri) === normBase) {
          setErr('Resolve the disk conflict on this note before applying a merge.');
          return;
        }
      }

      suppressEditorOnChangeRef.current = true;
      inboxEditorRef.current?.loadMarkdown(body, {selection: 'preserve'});
      suppressEditorOnChangeRef.current = false;
      setEditorBody(body);
      editorBodyRef.current = body;

      const nextCache = mergeInboxNoteBodyIntoCache(
        inboxContentByUriRef.current,
        normBase,
        body,
      );
      if (nextCache) {
        inboxContentByUriRef.current = nextCache;
        setInboxContentByUri(prev => mergeInboxNoteBodyIntoCache(prev, normBase, body) ?? prev);
      }
      backlinksActiveBodyRef.current = body;
      setBacklinksActiveBody(body);
      setMergeView(null);

      const full = inboxEditorSliceToFullMarkdown(
        body,
        normBase,
        false,
        inboxYamlFrontmatterInnerRef.current,
        inboxEditorYamlLeadingBeforeFrontmatterRef.current,
      );
      enqueuePersistOutgoingNoteMarkdown(normBase, full);
      scheduleBacklinksDeferOneFrameAfterLoad();
    },
    [
      mergeView,
      inboxEditorRef,
      enqueuePersistOutgoingNoteMarkdown,
      scheduleBacklinksDeferOneFrameAfterLoad,
      autosaveSchedulerRef,
      backlinksActiveBodyRef,
      setBacklinksActiveBody,
    ],
  );

  const activateOpenTab = useCallback(
    (tabId: string) => {
      const tab = findTabById(editorWorkspaceTabsRef.current, tabId);
      const u = tab ? tabCurrentUri(tab) : null;
      if (!u) {
        return;
      }
      assignLegacyRuntimeActiveSurfaceTab(tabId, {
        ref: activeEditorTabIdRef,
        setActiveEditorTabId,
      });
      mirrorShadowActiveTab(tabId, 'activate open tab');
      void openMarkdownInEditor(u, {skipHistory: true});
    },
    [mirrorShadowActiveTab, openMarkdownInEditor],
  );

  const reorderEditorWorkspaceTabs = useCallback(
    (fromIndex: number, insertBeforeIndex: number) => {
      if (busy) {
        return;
      }
      const tabs = editorWorkspaceTabsRef.current;
      const preview = reorderEditorWorkspaceTabsInArray(tabs, fromIndex, insertBeforeIndex);
      let sameOrder = true;
      for (let i = 0; i < preview.length; i++) {
        if (preview[i]!.id !== tabs[i]!.id) {
          sameOrder = false;
          break;
        }
      }
      if (sameOrder) {
        return;
      }
      // Model-led: apply reorder on the shadow workspace, then sync legacy tab strip from TabEntry[].
      const nextModel = dispatchWorkspaceActionSync('reorder tabs', m =>
        reorderTabsAction(m, fromIndex, insertBeforeIndex),
      );
      const hub = nextModel.activeHub;
      if (hub == null) {
        return;
      }
      const ws = nextModel.workspaces[hub];
      if (ws == null) {
        return;
      }
      const nextTabs = editorWorkspaceTabsFromModelTabEntries(ws.tabs);
      assignLegacyEditorWorkspaceTabs({
        nextTabs,
        editorWorkspaceTabsRef,
        setEditorWorkspaceTabs,
      });
    },
    [busy, dispatchWorkspaceActionSync],
  );

  /** Reset the inbox editor body, frontmatter state, and any reset-nonce-driven CodeMirror reload. */
  const resetInboxEditorComposeState = useCallback(() => {
    clearInboxYamlFrontmatterEditorRefs({
      inner: inboxYamlFrontmatterInnerRef,
      leading: inboxEditorYamlLeadingBeforeFrontmatterRef,
      setInner: setInboxYamlFrontmatterInner,
      setLeading: setInboxEditorYamlLeadingBeforeFrontmatter,
    });
    setEditorBody('');
    setInboxEditorResetNonce(n => n + 1);
  }, []);

  /** Drop the active inbox selection entirely — clear refs, state, and editor. */
  const clearInboxSelection = useCallback(() => {
    selectedUriRef.current = null;
    composingNewEntryRef.current = false;
    lastPersistedRef.current = null;
    lastPersistedExternalMutationSeqRef.current += 1;
    setSelectedUri(null);
    setComposingNewEntry(false);
    resetInboxEditorComposeState();
  }, [resetInboxEditorComposeState]);

  const recordClosedTabAndPruneScroll = useCallback(
    (tabsBefore: readonly EditorWorkspaceTab[], tabId: string, tabClosing: EditorWorkspaceTab | undefined) => {
      const closedUri = tabClosing ? tabCurrentUri(tabClosing) : null;
      if (closedUri) {
        const closedIndex = tabsBefore.findIndex(t => t.id === tabId);
        editorClosedTabsStackRef.current.push({
          uri: closedUri,
          index: closedIndex >= 0 ? closedIndex : tabsBefore.length - 1,
        });
      }
      bumpEditorClosedStack();
      if (tabClosing) {
        for (const u of tabClosing.history.entries) {
          editorShellScrollByUriRef.current.delete(normalizeEditorDocUri(u));
        }
      }
    },
    [bumpEditorClosedStack],
  );

  const refocusAfterClosingActiveTab = useCallback(
    async (nextTabId: string | null, nextTabs: readonly EditorWorkspaceTab[]) => {
      if (nextTabId) {
        assignLegacyRuntimeActiveSurfaceTab(nextTabId, {
          ref: activeEditorTabIdRef,
          setActiveEditorTabId,
        });
        mirrorShadowActiveTab(nextTabId, 'close tab refocus neighbor');
      }
      const neighbor = nextTabId ? findTabById(nextTabs, nextTabId) : undefined;
      const nextUri = neighbor ? tabCurrentUri(neighbor) : null;
      if (nextUri) {
        await openMarkdownInEditor(nextUri, {skipHistory: true});
        return;
      }
      const shellHub = activeTodayHubUriRef.current;
      if (shellHub) {
        await selectHomeCurrentNote(shellHub);
        return;
      }
      if (!nextTabId) {
        assignLegacyRuntimeActiveSurfaceTab(null, {
          ref: activeEditorTabIdRef,
          setActiveEditorTabId,
        });
        mirrorShadowHomeSurface('close tab home surface');
      }
      clearInboxSelection();
    },
    [
      openMarkdownInEditor,
      clearInboxSelection,
      mirrorShadowActiveTab,
      mirrorShadowHomeSurface,
      selectHomeCurrentNote,
    ],
  );

  const closeEditorTab = useCallback(
    (tabId: string) => {
      void (async () => {
        const tabsBefore = editorWorkspaceTabsRef.current;
        const tabClosing = findTabById(tabsBefore, tabId);
        const wasActive = activeEditorTabIdRef.current === tabId;

        if (wasActive) {
          await flushInboxSaveRef.current();
        } else {
          await saveChainRef.current.catch(() => undefined);
        }

        recordClosedTabAndPruneScroll(tabsBefore, tabId, tabClosing);

        const nextTabId = pickNeighborTabIdAfterRemovingTab(tabsBefore, tabId);
        const nextTabsLegacy = tabsBefore.filter(t => t.id !== tabId);

        const nextModel = dispatchWorkspaceActionSync('close tab', m =>
          closeTabAction(m, tabId),
        );
        const {nextTabs, mismatch: tabStripMismatch} = resolveModelBackedLegacyTabStrip(
          nextModel,
          nextTabsLegacy,
          'ids',
        );
        if (tabStripMismatch?.kind === 'ids') {
          const warn =
            typeof process !== 'undefined' && process.env.NODE_ENV !== 'production';
          if (warn) {
            const {legacyIds, derivedIds} = tabStripMismatch;
            console.warn(
              '[workspaceModel] closeEditorTab: model strip mismatch vs legacy filter; using legacy strip',
              {tabId, legacyIds, derivedIds},
            );
          }
        }

        assignLegacyEditorWorkspaceTabs({
          nextTabs,
          editorWorkspaceTabsRef,
          setEditorWorkspaceTabs,
        });

        if (!wasActive) {
          return;
        }
        await refocusAfterClosingActiveTab(nextTabId, nextTabs);
      })();
    },
    [
      dispatchWorkspaceActionSync,
      flushInboxSaveRef,
      recordClosedTabAndPruneScroll,
      refocusAfterClosingActiveTab,
      saveChainRef,
    ],
  );

  const closeOtherEditorTabs = useCallback(
    (keepTabId: string) => {
      void (async () => {
        const prevTabs = [...editorWorkspaceTabsRef.current];
        const keepTab = findTabById(prevTabs, keepTabId);
        const keepUri = keepTab ? tabCurrentUri(keepTab) : null;
        if (keepUri == null) {
          return;
        }
        await saveChainRef.current.catch(() => undefined);
        if (activeEditorTabIdRef.current !== keepTabId) {
          assignLegacyRuntimeActiveSurfaceTab(keepTabId, {
            ref: activeEditorTabIdRef,
            setActiveEditorTabId,
          });
          mirrorShadowActiveTab(keepTabId, 'close other tabs activate kept tab');
          await openMarkdownInEditor(keepUri, {skipHistory: true});
        } else {
          await flushInboxSaveRef.current();
        }
        pushClosedWorkspaceTabsFromCloseOther(
          editorClosedTabsStackRef.current,
          prevTabs,
          keepTabId,
        );
        bumpEditorClosedStack();
        for (const t of prevTabs) {
          if (t.id === keepTabId) {
            continue;
          }
          for (const u of t.history.entries) {
            editorShellScrollByUriRef.current.delete(normalizeEditorDocUri(u));
          }
        }
        const nextModel = dispatchWorkspaceActionSync('close other tabs', m =>
          closeOtherTabsAction(m, keepTabId),
        );
        const hub = nextModel.activeHub;
        const derived =
          hub != null && nextModel.workspaces[hub] != null
            ? editorWorkspaceTabsFromModelTabEntries(nextModel.workspaces[hub].tabs)
            : null;
        const nextTabs =
          derived != null &&
          derived.length === 1 &&
          derived[0]!.id === keepTabId
            ? derived
            : prevTabs.filter(t => t.id === keepTabId);
        assignLegacyEditorWorkspaceTabs({
          nextTabs,
          editorWorkspaceTabsRef,
          setEditorWorkspaceTabs,
        });
      })();
    },
    [
      bumpEditorClosedStack,
      dispatchWorkspaceActionSync,
      flushInboxSaveRef,
      mirrorShadowActiveTab,
      openMarkdownInEditor,
      saveChainRef,
    ],
  );

  const closeAllEditorTabs = useCallback(() => {
    void (async () => {
      await flushInboxSaveRef.current();
      const tabs = [...editorWorkspaceTabsRef.current];
      if (tabs.length === 0) {
        return;
      }
      pushClosedWorkspaceTabsFromCloseAll(
        editorClosedTabsStackRef.current,
        tabs,
        activeEditorTabIdRef.current,
      );
      bumpEditorClosedStack();
      for (const t of tabs) {
        for (const u of t.history.entries) {
          editorShellScrollByUriRef.current.delete(normalizeEditorDocUri(u));
        }
      }
      const nextModel = dispatchWorkspaceActionSync('close all tabs', closeAllTabsAction);
      const hub = nextModel.activeHub;
      const nextTabs =
        hub != null && nextModel.workspaces[hub] != null
          ? editorWorkspaceTabsFromModelTabEntries(nextModel.workspaces[hub].tabs)
          : [];
      assignLegacyEditorWorkspaceTabs({
        nextTabs,
        editorWorkspaceTabsRef,
        setEditorWorkspaceTabs,
      });
      assignLegacyRuntimeActiveSurfaceTab(null, {
        ref: activeEditorTabIdRef,
        setActiveEditorTabId,
      });
      mirrorShadowHomeSurface('close all tabs home surface');
      const shellHubAll = activeTodayHubUriRef.current;
      if (shellHubAll) {
        await selectHomeCurrentNote(shellHubAll);
        return;
      }
      selectedUriRef.current = null;
      composingNewEntryRef.current = false;
      lastPersistedRef.current = null;
      lastPersistedExternalMutationSeqRef.current += 1;
      setSelectedUri(null);
      setComposingNewEntry(false);
      clearInboxYamlFrontmatterEditorRefs({
        inner: inboxYamlFrontmatterInnerRef,
        leading: inboxEditorYamlLeadingBeforeFrontmatterRef,
        setInner: setInboxYamlFrontmatterInner,
        setLeading: setInboxEditorYamlLeadingBeforeFrontmatter,
      });
      setEditorBody('');
      setInboxEditorResetNonce(n => n + 1);
    })();
  }, [
    bumpEditorClosedStack,
    dispatchWorkspaceActionSync,
    flushInboxSaveRef,
    mirrorShadowHomeSurface,
    selectHomeCurrentNote,
  ]);

  const reopenLastClosedEditorTab = useCallback(() => {
    void (async () => {
      const root = vaultRootRef.current;
      const stack = editorClosedTabsStackRef.current;
      const noteSet = new Set(
        notesRef.current.map(n => n.uri.replace(/\\/g, '/')),
      );
      const {record, popped} = popNextReopenableClosedTabRecord(stack, root, noteSet);
      if (popped > 0) {
        bumpEditorClosedStack();
      }
      if (record) {
        await openMarkdownInEditor(record.uri, {
          newTab: true,
          activateNewTab: true,
          insertAtIndex: record.index,
        });
      }
    })();
  }, [openMarkdownInEditor, bumpEditorClosedStack]);

  const hydrateVault = useCallback(
    async (root: string) => {
      await flushInboxSaveRef.current();
      editorShellScrollByUriRef.current = new Map();
      inboxEditorShellScrollDirectiveRef.current = null;
      setBusy(true);
      setErr(null);
      setDiskConflict(null);
      diskConflictRef.current = null;
      setDiskConflictSoft(null);
      diskConflictSoftRef.current = null;
      resetRenameMaintenanceState();
      subtreeMarkdownCache.invalidateAll();
      clearBacklinkDiskBodyCache();
      setVaultSettings(null);
      setInboxShellRestored(!inboxRestoreEnabled);
      try {
        await setVaultSession(root);
        await bootstrapVaultLayout(root, fs);
        const shared = await readVaultSettings(root, fs);
        setVaultSettings(shared);
        let local = await readVaultLocalSettings(root, fs);
        const ensuredLocal = ensureDeviceInstanceId(local);
        if (ensuredLocal.changed) {
          local = ensuredLocal.settings;
          await writeVaultLocalSettings(root, fs, local);
        }
        setDeviceInstanceId(local.deviceInstanceId);
        const label = local.displayName.trim();
        setSettingsName(label !== '' ? label : 'Eskerra');
        await refreshNotes(root);
        assignLegacyEditorWorkspaceTabs({
          nextTabs: [],
          editorWorkspaceTabsRef,
          setEditorWorkspaceTabs,
        });
        assignLegacyRuntimeActiveSurfaceTab(null, {
          ref: activeEditorTabIdRef,
          setActiveEditorTabId,
        });
        assignLegacyRuntimeActiveHub(null, {
          ref: activeTodayHubUriRef,
          setActiveTodayHubUri,
        });
        mirrorShadowActiveHub(null, 'hydrate reset active hub');
        editorClosedTabsStackRef.current = [];
        bumpEditorClosedStack();
        setSelectedUri(null);
        setComposingNewEntry(false);
        setMergeView(null);
        clearInboxYamlFrontmatterEditorRefs({
          inner: inboxYamlFrontmatterInnerRef,
          leading: inboxEditorYamlLeadingBeforeFrontmatterRef,
          setInner: setInboxYamlFrontmatterInner,
          setLeading: setInboxEditorYamlLeadingBeforeFrontmatter,
        });
        setEditorBody('');
        lastPersistedRef.current = null;
        lastPersistedExternalMutationSeqRef.current += 1;
        setInboxEditorResetNonce(n => n + 1);
        setVaultRoot(root);
        const store = await load(STORE_PATH);
        await store.set(STORE_KEY_VAULT, root);
        await store.save();
        try {
          await startVaultWatch();
        } catch (watchError) {
          const reason =
            watchError instanceof Error ? watchError.message : String(watchError);
          const normalizedReason = normalizeVaultWatchErrorReason(reason);
          captureObservabilityMessage({
            message: 'eskerra.desktop.vault_watch_start_failed',
            level: 'warning',
            extra: {
              reason,
              normalizedReason,
              vaultRootHash: fingerprintUtf16ForDebug(root),
            },
            tags: {
              obs_surface: 'vault_watch',
              watch_session_id: 'start',
              vault_root_hash: fingerprintUtf16ForDebug(root),
              backend: 'startup',
              reason: normalizedReason,
            },
            fingerprint: [
              'eskerra.desktop',
              'vault_watch_start_failed',
              normalizedReason,
            ],
          });
          throw watchError;
        }
        queueMicrotask(() => {
          vaultSearchIndexSchedule().catch(() => undefined);
          vaultFrontmatterIndexSchedule().catch(() => undefined);
        });
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [
      fs,
      refreshNotes,
      resetRenameMaintenanceState,
      clearBacklinkDiskBodyCache,
      bumpEditorClosedStack,
      subtreeMarkdownCache,
      mirrorShadowActiveHub,
      flushInboxSaveRef,
      inboxRestoreEnabled,
    ],
  );

  const hydrateVaultRef = useRef(hydrateVault);
  useLayoutEffect(() => {
    hydrateVaultRef.current = hydrateVault;
  }, [hydrateVault]);

  /** One-shot persisted vault bootstrap: `hydrateVault` identity changes after restore/deps updates and must not re-trigger a full hydrate (would clear tabs + shadow). */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const store = await load(STORE_PATH);
        const saved = await store.get<string>(STORE_KEY_VAULT);
        const fromStore = typeof saved === 'string' ? saved.trim() : '';
        const session = (await getVaultSession())?.trim() ?? '';
        const root = fromStore || session;
        if (root && !cancelled) {
          await hydrateVaultRef.current(root);
        }
      } catch {
        // first launch
      } finally {
        if (!cancelled) {
          setInitialVaultHydrateAttemptDone(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const syncWorkspaceModelRemoveOpenTabUri = useCallback(
    (markdownUri: string) => {
      const target = normalizeWorkspaceUri(markdownUri);
      removeHomeHistoryUrisBridge(
        {homeStatesByHubRef, setHomeStatesByHub},
        u => u === target,
      );
      dispatchWorkspaceActionSync('vault watch removed open note', m =>
        removeUrisAction(m, u => u === target),
      );
    },
    [
      dispatchWorkspaceActionSync,
      homeStatesByHubRef,
      setHomeStatesByHub,
    ],
  );

  useWorkspaceVaultWatchEffects({
    vaultRoot,
    fs,
    refreshNotes,
    inboxEditorRef,
    openMarkdownInEditor,
    loadFullMarkdownIntoInboxEditor,
    scheduleBacklinksDeferOneFrameAfterLoad,
    clearBacklinkDiskBodyCache,
    subtreeMarkdownCache,
    vaultRootRef,
    editorWorkspaceTabsRef,
    selectedUriRef,
    activeEditorTabIdRef,
    composingNewEntryRef,
    diskConflictRef,
    diskConflictSoftRef,
    inboxContentByUriRef,
    lastPersistedRef,
    lastPersistedExternalMutationSeqRef,
    editorBodyRef,
    inboxYamlFrontmatterInnerRef,
    inboxEditorYamlLeadingBeforeFrontmatterRef,
    editorShellScrollByUriRef,
    skipRecencyDeferForUriRef,
    diskConflictDeferTimerRef,
    lastInboxEditorActivityAtRef,
    autosaveSchedulerRef,
    todayHubRowLastPersistedRef,
    todayHubSettingsRef,
    todayHubBridgeRef,
    setEditorWorkspaceTabs,
    setActiveEditorTabId,
    setDiskConflict,
    setDiskConflictSoft,
    setInboxContentByUri,
    setSelectedUri,
    setComposingNewEntry,
    setEditorBody,
    setInboxEditorResetNonce,
    setInboxYamlFrontmatterInner,
    setInboxEditorYamlLeadingBeforeFrontmatter,
    setFsRefreshNonce,
    setPodcastFsNonce,
    setVaultSettings,
    syncWorkspaceModelRemoveOpenTabUri,
  });

  useEffect(() => {
    if (!vaultRoot) {
      queueMicrotask(() => {
        setVaultMarkdownRefs([]);
      });
      return;
    }
    const gen = ++vaultRefsBuildGenRef.current;
    const ac = new AbortController();
    void (async () => {
      try {
        const refs = await collectVaultMarkdownRefs(vaultRoot, fs, {signal: ac.signal});
        if (gen !== vaultRefsBuildGenRef.current) {
          return;
        }
        setVaultMarkdownRefs(refs);
      } catch (e) {
        if (ac.signal.aborted) {
          return;
        }
        console.warn('[vaultMarkdownRefs]', e);
      }
    })();
    return () => {
      ac.abort();
    };
  }, [vaultRoot, fs, fsRefreshNonce]);

  useLayoutEffect(() => {
    if (!vaultRoot || !selectedUri) {
      clearInboxBacklinksDeferAfterLoad();
      return;
    }
    if (eagerEditorLoadUriRef.current === selectedUri) {
      eagerEditorLoadUriRef.current = null;
      return;
    }
    const cached = inboxContentByUriRef.current[selectedUri];
    if (cached !== undefined) {
      const {markdown: body, healedCache} = resolveInboxCachedBodyForEditor(
        selectedUri,
        cached,
        lastPersistedRef.current,
      );
      if (healedCache) {
        const healed = mergeInboxNoteBodyIntoCache(
          inboxContentByUriRef.current,
          selectedUri,
          body,
        );
        if (healed) {
          inboxContentByUriRef.current = healed;
          setInboxContentByUri(prev =>
            mergeInboxNoteBodyIntoCache(prev, selectedUri, body) ?? prev,
          );
        }
      }
      lastPersistedRef.current = {uri: selectedUri, markdown: body};
      lastPersistedExternalMutationSeqRef.current += 1;
      loadFullMarkdownIntoInboxEditor(body, selectedUri, 'start');
      scheduleBacklinksDeferOneFrameAfterLoad();
    } else {
      clearInboxBacklinksDeferAfterLoad();
      clearInboxYamlFrontmatterEditorRefs({
        inner: inboxYamlFrontmatterInnerRef,
        leading: inboxEditorYamlLeadingBeforeFrontmatterRef,
        setInner: setInboxYamlFrontmatterInner,
        setLeading: setInboxEditorYamlLeadingBeforeFrontmatter,
      });
      setEditorBody('');
      lastPersistedRef.current = null;
      lastPersistedExternalMutationSeqRef.current += 1;
    }
  }, [
    vaultRoot,
    selectedUri,
    inboxEditorRef,
    clearInboxBacklinksDeferAfterLoad,
    loadFullMarkdownIntoInboxEditor,
    scheduleBacklinksDeferOneFrameAfterLoad,
  ]);

  /**
   * Clear the open note in CodeMirror when the shell has no cached body yet.
   * Runs after `NoteMarkdownEditor`'s mount effect creates the view (parent layout is too early).
   */
  useEffect(() => {
    if (!vaultRoot || !selectedUri) {
      return;
    }
    if (inboxContentByUriRef.current[selectedUri] !== undefined) {
      return;
    }
    inboxYamlFrontmatterInnerRef.current = null;
    inboxEditorYamlLeadingBeforeFrontmatterRef.current = '';
    queueMicrotask(() => {
      setInboxYamlFrontmatterInner(null);
      setInboxEditorYamlLeadingBeforeFrontmatter('');
    });
    inboxEditorRef.current?.loadMarkdown('', {selection: 'start'});
    scheduleBacklinksDeferOneFrameAfterLoad();
  }, [vaultRoot, selectedUri, inboxEditorRef, scheduleBacklinksDeferOneFrameAfterLoad]);


  useLayoutEffect(() => {
    if (composingNewEntry || !selectedUri) {
      if (backlinksActiveBodyRef.current !== '') {
        queueMicrotask(() => {
          setBacklinksActiveBody('');
        });
      }
      return;
    }
    const snap = inboxContentByUriRef.current[selectedUri] ?? '';
    if (backlinksActiveBodyRef.current === snap) {
      return;
    }
    queueMicrotask(() => {
      setBacklinksActiveBody(snap);
    });
  }, [
    backlinksActiveBodyRef,
    composingNewEntry,
    selectedUri,
    setBacklinksActiveBody,
    vaultRoot,
  ]);

  useEffect(() => {
    if (composingNewEntry || !selectedUri) {
      return;
    }
    const id = window.setTimeout(() => {
      const liveFull = inboxEditorSliceToFullMarkdown(
        editorBody,
        selectedUri,
        composingNewEntry,
        inboxYamlFrontmatterInnerRef.current,
        inboxEditorYamlLeadingBeforeFrontmatterRef.current,
      );
      if (backlinksActiveBodyRef.current === liveFull) {
        return;
      }
      setBacklinksActiveBody(liveFull);
    }, INBOX_BACKLINK_BODY_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [
    backlinksActiveBodyRef,
    composingNewEntry,
    editorBody,
    inboxYamlFrontmatterInner,
    selectedUri,
    setBacklinksActiveBody,
  ]);

  useEffect(() => {
    if (!vaultRoot || !selectedUri) {
      return;
    }
    if (inboxContentByUriRef.current[selectedUri] !== undefined) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const raw = await fs.readFile(selectedUri, {encoding: 'utf8'});
        if (!cancelled) {
          const normalized = normalizeVaultMarkdownDiskRead(raw);
          lastPersistedRef.current = {uri: selectedUri, markdown: normalized};
          lastPersistedExternalMutationSeqRef.current += 1;
          setInboxContentByUri(prev => {
            if (prev[selectedUri] === normalized) {
              return prev;
            }
            return {...prev, [selectedUri]: normalized};
          });
          const currentFull = inboxEditorSliceToFullMarkdown(
            editorBodyRef.current,
            selectedUri,
            composingNewEntryRef.current,
            inboxYamlFrontmatterInnerRef.current,
            inboxEditorYamlLeadingBeforeFrontmatterRef.current,
          );
          if (normalized !== currentFull) {
            loadFullMarkdownIntoInboxEditor(normalized, selectedUri, 'start');
            scheduleBacklinksDeferOneFrameAfterLoad();
          }
        }
      } catch (e) {
        if (!cancelled) {
          setErr(e instanceof Error ? e.message : String(e));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    vaultRoot,
    selectedUri,
    fs,
    inboxEditorRef,
    loadFullMarkdownIntoInboxEditor,
    scheduleBacklinksDeferOneFrameAfterLoad,
  ]);

  const addNote = useCallback(
    async (title: string, body: string) => {
      if (!vaultRoot) {
        return;
      }
      setBusy(true);
      setErr(null);
      try {
        const created = await createInboxMarkdownNote(vaultRoot, fs, title, body);
        markVaultWriteSettled();
        subtreeMarkdownCache.invalidateForMutation(
          vaultRoot,
          created.uri,
          'file',
        );
        await refreshNotes(vaultRoot);
        setFsRefreshNonce(n => n + 1);
        await openMarkdownInEditor(created.uri);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [vaultRoot, fs, refreshNotes, openMarkdownInEditor, subtreeMarkdownCache, markVaultWriteSettled],
  );

  const startNewEntry = useCallback(() => {
    void (async () => {
      await flushInboxSaveRef.current();
      setErr(null);
      setDiskConflict(null);
      diskConflictRef.current = null;
      setDiskConflictSoft(null);
      diskConflictSoftRef.current = null;
      inboxEditorShellScrollDirectiveRef.current = {kind: 'snapTop'};
      setComposingNewEntry(true);
      setSelectedUri(null);
      lastPersistedRef.current = null;
      lastPersistedExternalMutationSeqRef.current += 1;
      resetInboxEditorComposeState();
    })();
  }, [flushInboxSaveRef, resetInboxEditorComposeState]);

  const cancelNewEntry = useCallback(() => {
    void (async () => {
      await flushInboxSaveRef.current();
      setComposingNewEntry(false);
      resetInboxEditorComposeState();
    })();
  }, [flushInboxSaveRef, resetInboxEditorComposeState]);

  /** Pick where to refocus after the active tab is closed: surviving tab → workspace shell hub → empty. */
  const refocusAfterActiveTabRemoved = useCallback(
    async (
      closedNorm: string,
      nextTabs: readonly EditorWorkspaceTab[],
      nextActive: string | null,
    ) => {
      const activeTab = nextActive ? findTabById(nextTabs, nextActive) : undefined;
      const nextAfterRemove =
        (activeTab ? tabCurrentUri(activeTab) : null)
        ?? firstSurvivorUriFromTabs(nextTabs);
      if (nextAfterRemove) {
        await openMarkdownInEditor(nextAfterRemove, {skipHistory: true});
        return;
      }
      const shellHub = activeTodayHubUriRef.current;
      if (shellHub && shellHub !== closedNorm) {
        await selectHomeCurrentNote(shellHub);
        return;
      }
      clearInboxSelection();
    },
    [openMarkdownInEditor, clearInboxSelection, selectHomeCurrentNote],
  );

  const selectNote = useCallback(
    (uri: string) => {
      const existingId = findTabIdWithCurrentUri(editorWorkspaceTabsRef.current, uri);
      if (existingId != null) {
        activateOpenTab(existingId);
        return;
      }
      const norm = normalizeEditorDocUri(uri) ?? '';
      const hubTodayOpen = selectNoteActiveHubTodayOpen({
        uri,
        activeTodayHubUri: activeTodayHubUriRef.current,
        uriIsTodayMarkdownFile: vaultUriIsTodayMarkdownFile(norm),
        editorWorkspaceTabCount: editorWorkspaceTabsRef.current.length,
      });
      if (hubTodayOpen === 'home') {
        void openMarkdownInEditor(uri, {home: true});
        return;
      }
      if (
        isOnWorkspaceHome({
          composingNewEntry: composingNewEntryRef.current,
          activeTodayHubUri: activeTodayHubUriRef.current,
          selectedUri: selectedUriRef.current,
          activeEditorTabId: activeEditorTabIdRef.current,
        })
      ) {
        void openMarkdownInEditor(uri, {home: true});
        return;
      }
      void openMarkdownInEditor(uri);
    },
    [activateOpenTab, openMarkdownInEditor],
  );

  const selectNoteInNewActiveTab = useCallback(
    (uri: string, opts?: {insertAfterActive?: boolean}) => {
      const existingId = findTabIdWithCurrentUri(editorWorkspaceTabsRef.current, uri);
      if (existingId != null) {
        activateOpenTab(existingId);
        return;
      }
      void openMarkdownInEditor(uri, {
        newTab: true,
        activateNewTab: true,
        insertAfterActive: opts?.insertAfterActive === true,
      });
    },
    [activateOpenTab, openMarkdownInEditor],
  );

  const syncWorkspaceModelForIncomingHub = useCallback(
    (payload: {
      hubUri: string;
      nextTabs: readonly EditorWorkspaceTab[];
      nextActive: string | null;
      snapshot: TodayHubWorkspaceSnapshot | undefined;
    }) => {
      dispatchWorkspaceActionSync('incoming workspace switch', m =>
        applyIncomingHubWorkspaceAction(
          m,
          payload.hubUri,
          workspaceStateForIncomingHubSwitch({
            hubUri: payload.hubUri,
            nextTabs: payload.nextTabs,
            nextActive: payload.nextActive,
            snapshot: payload.snapshot,
            homeStatesByHub: homeStatesByHubRef.current,
          }),
        ),
      );
    },
    [dispatchWorkspaceActionSync],
  );

  const syncShadowWorkspaceFromShellRestore = useCallback(
    (projection: ShellRestoreProjectionSyncArgs) => {
      dispatchWorkspaceActionSync('restore shell workspace projection', () =>
        projectWorkspaceRuntimeToModel({
          activeTodayHubUri: projection.activeTodayHubUri,
          editorWorkspaceTabs: editorWorkspaceTabsRef.current,
          activeEditorTabId: activeEditorTabIdRef.current,
          legacyHubWorkspaceSnapshots: projection.legacyHubWorkspaceSnapshots,
          homeStatesByHub: projection.homeStatesByHub,
          hubUris: projection.hubUris,
        }),
      );
    },
    [dispatchWorkspaceActionSync],
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
        selectNote,
        selectHomeCurrentNote,
        activateOpenTab,
        activateWorkspaceHomeSelector,
        mirrorShadowActiveHub,
        mirrorShadowHomeSurface,
        mirrorShadowActiveTab,
        mirrorShadowActiveWorkspaceTabs,
        syncWorkspaceModelForIncomingHub,
      },
    });

  const submitNewEntry = useCallback(async () => {
    if (!vaultRoot) {
      return;
    }
    setErr(null);
    const rawBody = inboxEditorRef.current?.getMarkdown() ?? editorBody;
    let body = rawBody;
    try {
      body = await persistTransientMarkdownImages(body, vaultRoot);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      return;
    }
    if (markdownContainsTransientImageUrls(body)) {
      setErr(
        'Cannot create this note: some images are still temporary (blob or data URLs). Paste images again so they are stored under Assets/Attachments, or remove those image references.',
      );
      return;
    }
    if (body !== rawBody) {
      inboxEditorRef.current?.loadMarkdown(body, {selection: 'preserve'});
      scheduleBacklinksDeferOneFrameAfterLoad();
      setEditorBody(body);
    }
    const {titleLine, bodyAfterBlank} = parseComposeInput(body);
    if (!titleLine.trim()) {
      setErr('First line is required.');
      return;
    }
    const fullMarkdown = buildInboxMarkdownFromCompose(titleLine, bodyAfterBlank);
    await addNote(titleLine, fullMarkdown);
  }, [
    addNote,
    editorBody,
    inboxEditorRef,
    vaultRoot,
    scheduleBacklinksDeferOneFrameAfterLoad,
  ]);

  useLayoutEffect(() => {
    submitNewEntryRef.current = submitNewEntry;
  }, [submitNewEntry]);

  const todayHubCleanRowBlocked = useCallback((rowUri: string) => {
    const dc = diskConflictRef.current;
    return (
      !!dc &&
      normalizeEditorDocUri(dc.uri) === normalizeEditorDocUri(rowUri)
    );
  }, []);

  const onCleanNoteInbox = useCallback(() => {
    const uri = selectedUriRef.current;
    if (!uri || composingNewEntryRef.current) {
      return;
    }
    const dc = diskConflictRef.current;
    if (dc && normalizeEditorDocUri(dc.uri) === normalizeEditorDocUri(uri)) {
      return;
    }
    const slice =
      inboxEditorRef.current?.getMarkdown() ?? editorBodyRef.current;
    const cleanedSlice = cleanNoteMarkdownBody(slice, uri);
    if (cleanedSlice !== slice) {
      const innerFm = inboxYamlFrontmatterInnerRef.current;
      const full = mergeYamlFrontmatterBody(
        innerFm == null ? null : innerToFencedFrontmatterBlock(innerFm),
        cleanedSlice,
        inboxEditorYamlLeadingBeforeFrontmatterRef.current,
      );
      loadFullMarkdownIntoInboxEditor(full, uri, 'preserve');
      scheduleBacklinksDeferOneFrameAfterLoad();
      const norm = normalizeEditorDocUri(uri);
      const nextCache = mergeInboxNoteBodyIntoCache(
        inboxContentByUriRef.current,
        norm,
        full,
      );
      if (nextCache) {
        inboxContentByUriRef.current = nextCache;
        setInboxContentByUri(prev =>
          mergeInboxNoteBodyIntoCache(prev, norm, full) ?? prev,
        );
      }
    }

    const runHubClean = async () => {
      if (!showTodayHubCanvasRef.current || composingNewEntryRef.current) {
        return;
      }
      const hubTodayUri = selectedUriRef.current;
      if (!hubTodayUri) {
        return;
      }
      const block = diskConflictRef.current;
      if (
        block &&
        normalizeEditorDocUri(block.uri) === normalizeEditorDocUri(hubTodayUri)
      ) {
        return;
      }
      await todayHubBridgeRef.current.flushPendingEdits().catch(() => undefined);
      await todayHubBridgeRef.current.cleanHubPageDayColumns().catch(() => undefined);
    };
    void runHubClean();
  }, [
    inboxEditorRef,
    loadFullMarkdownIntoInboxEditor,
    scheduleBacklinksDeferOneFrameAfterLoad,
    setInboxContentByUri,
  ]);

  const deleteNote = useCallback(
    async (uri: string) => {
      if (!vaultRoot) {
        return;
      }
      autosaveSchedulerRef.current.cancel();
      await saveChainRef.current.catch(() => undefined);

      const norm = normalizeEditorDocUri(uri);
      const wasOpen = selectedUriRef.current === norm;
      const nextTabs = removeUriFromAllTabs(
        editorWorkspaceTabsRef.current,
        u => u === norm,
      );
      const nextActive = ensureActiveTabId(
        nextTabs,
        activeEditorTabIdRef.current,
      );
      editorWorkspaceTabsRef.current = nextTabs;
      setEditorWorkspaceTabs(nextTabs);
      activeEditorTabIdRef.current = nextActive;
      setActiveEditorTabId(nextActive);
      if (nextActive == null) {
        mirrorShadowHomeSurface('delete note home surface');
      } else {
        mirrorShadowActiveTab(nextActive, 'delete note active tab');
      }
      removeHomeHistoryUris(u => u === norm);
      editorShellScrollByUriRef.current.delete(norm);

      if (wasOpen) {
        await refocusAfterActiveTabRemoved(norm, nextTabs, nextActive);
      }

      setBusy(true);
      setErr(null);
      try {
        await deleteVaultMarkdownNote(vaultRoot, uri, fs);
        subtreeMarkdownCache.invalidateForMutation(vaultRoot, uri, 'file');
        setInboxContentByUri(prev => {
          const next = {...prev};
          delete next[uri];
          return next;
        });
        markVaultWriteSettled();
        await refreshNotes(vaultRoot);
        setFsRefreshNonce(n => n + 1);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [
      vaultRoot,
      fs,
      refreshNotes,
      subtreeMarkdownCache,
      autosaveSchedulerRef,
      refocusAfterActiveTabRemoved,
      removeHomeHistoryUris,
      mirrorShadowActiveTab,
      mirrorShadowHomeSurface,
      saveChainRef,
      markVaultWriteSettled,
    ],
  );

  const linkController = useWorkspaceLinkRouting({
    vaultRoot,
    fs,
    flushInboxSaveRef,
    vaultMarkdownRefsRef,
    selectedUriRef,
    composingNewEntryRef,
    showTodayHubCanvasRef,
    todayHubWikiNavParentRef,
    todayHubCellEditorRef,
    activeTodayHubUriRef,
    activeEditorTabIdRef,
    editorWorkspaceTabsRef,
    inboxEditorRef,
    openMarkdownInEditor,
    activateOpenTab,
    tryEnterBackupMergeView,
    refreshNotes,
    setErr,
    setFsRefreshNonce,
    subtreeMarkdownCache,
  });

  const deleteFolder = useCallback(
    async (directoryUri: string) => {
      if (!vaultRoot) {
        return;
      }
      autosaveSchedulerRef.current.cancel();
      const normDir = trimTrailingSlashes(directoryUri.replace(/\\/g, '/'));
      const selected = selectedUriRef.current?.replace(/\\/g, '/');
      const clearsSelection =
        selected != null
        && (selected === normDir || selected.startsWith(`${normDir}/`));
      if (clearsSelection) {
        selectedUriRef.current = null;
        composingNewEntryRef.current = false;
        lastPersistedRef.current = null;
        lastPersistedExternalMutationSeqRef.current += 1;
        setSelectedUri(null);
        setComposingNewEntry(false);
        clearInboxYamlFrontmatterEditorRefs({
          inner: inboxYamlFrontmatterInnerRef,
          leading: inboxEditorYamlLeadingBeforeFrontmatterRef,
          setInner: setInboxYamlFrontmatterInner,
          setLeading: setInboxEditorYamlLeadingBeforeFrontmatter,
        });
        setEditorBody('');
        setInboxEditorResetNonce(n => n + 1);
      }
      await saveChainRef.current.catch(() => undefined);
      setBusy(true);
      setErr(null);
      try {
        await deleteVaultTreeDirectory(vaultRoot, directoryUri, fs);
        subtreeMarkdownCache.invalidateForMutation(
          vaultRoot,
          directoryUri,
          'directory',
        );
        setInboxContentByUri(prev => {
          const norm = normDir;
          const next = {...prev};
          for (const k of Object.keys(next)) {
            const kn = k.replace(/\\/g, '/');
            if (kn === norm || kn.startsWith(`${norm}/`)) {
              delete next[k];
            }
          }
          return next;
        });
        const tabPred = (u: string) => {
          const f = normDir;
          return u === f || u.startsWith(`${f}/`);
        };
        const newTabs = removeUriFromAllTabs(
          editorWorkspaceTabsRef.current,
          tabPred,
        );
        const nextActive = ensureActiveTabId(
          newTabs,
          activeEditorTabIdRef.current,
        );
        editorWorkspaceTabsRef.current = newTabs;
        setEditorWorkspaceTabs(newTabs);
        activeEditorTabIdRef.current = nextActive;
        setActiveEditorTabId(nextActive);
        if (nextActive == null) {
          mirrorShadowHomeSurface('delete folder home surface');
        } else {
          mirrorShadowActiveTab(nextActive, 'delete folder active tab');
        }
        removeHomeHistoryUris(tabPred);
        if (clearsSelection) {
          const activeTab = nextActive
            ? findTabById(newTabs, nextActive)
            : undefined;
          const nextUri =
            (activeTab ? tabCurrentUri(activeTab) : null)
            ?? firstSurvivorUriFromTabs(newTabs);
          if (nextUri) {
            await openMarkdownInEditor(nextUri, {skipHistory: true});
          }
        }
        markVaultWriteSettled();
        await refreshNotes(vaultRoot);
        setFsRefreshNonce(n => n + 1);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [
      vaultRoot,
      fs,
      refreshNotes,
      openMarkdownInEditor,
      subtreeMarkdownCache,
      autosaveSchedulerRef,
      removeHomeHistoryUris,
      mirrorShadowActiveTab,
      mirrorShadowHomeSurface,
      saveChainRef,
      markVaultWriteSettled,
    ],
  );

  const renameFolder = useCallback(
    async (directoryUri: string, nextDisplayName: string) => {
      if (!vaultRoot) {
        return;
      }
      autosaveSchedulerRef.current.cancel();
      await flushInboxSaveRef.current();
      setBusy(true);
      setErr(null);
      clearRenameNotice();
      try {
        const oldUri = trimTrailingSlashes(directoryUri.replace(/\\/g, '/'));
        const nextUri = await renameVaultTreeDirectory(
          vaultRoot,
          directoryUri,
          nextDisplayName,
          fs,
        );
        const normalizedNext = nextUri.replace(/\\/g, '/');
        subtreeMarkdownCache.invalidateForMutation(
          vaultRoot,
          oldUri,
          'directory',
        );
        subtreeMarkdownCache.invalidateForMutation(
          vaultRoot,
          normalizedNext,
          'directory',
        );
        setInboxContentByUri(prev => {
          const next = {...prev};
          for (const k of Object.keys(prev)) {
            const mapped = remapVaultUriPrefix(k, oldUri, normalizedNext);
            if (mapped && mapped !== k && prev[k] !== undefined) {
              next[mapped] = prev[k]!;
              delete next[k];
            }
          }
          return next;
        });
        remapEditorShellScrollMapTreePrefix(
          editorShellScrollByUriRef.current,
          oldUri,
          normalizedNext,
        );
        {
          let nextSel: string | null = selectedUriRef.current;
          if (nextSel) {
            const mappedSel = remapVaultUriPrefix(
              nextSel.replace(/\\/g, '/'),
              oldUri,
              normalizedNext,
            );
            nextSel = mappedSel ?? nextSel;
          }
          selectedUriRef.current = nextSel;
          setSelectedUri(nextSel);
        }
        const lp = lastPersistedRef.current;
        if (lp) {
          const mappedLp = remapVaultUriPrefix(lp.uri, oldUri, normalizedNext);
          if (mappedLp) {
            lastPersistedRef.current = {...lp, uri: mappedLp};
            lastPersistedExternalMutationSeqRef.current += 1;
          }
        }
        const remappedTabs = remapAllTabsUriPrefix(
          editorWorkspaceTabsRef.current,
          oldUri,
          normalizedNext,
        );
        assignLegacyEditorWorkspaceTabs({
          nextTabs: remappedTabs,
          editorWorkspaceTabsRef,
          setEditorWorkspaceTabs,
        });
        remapHomeStatesPrefix(oldUri, normalizedNext);
        markVaultWriteSettled();
        await refreshNotes(vaultRoot);
        setFsRefreshNonce(n => n + 1);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [
      vaultRoot,
      fs,
      refreshNotes,
      clearRenameNotice,
      subtreeMarkdownCache,
      remapHomeStatesPrefix,
      autosaveSchedulerRef,
      flushInboxSaveRef,
      markVaultWriteSettled,
    ],
  );

  const commitMovedArticleResult = useCallback(
    (previousUri: string, nextUri: string) => {
      setInboxContentByUri(prev => {
        if (prev[previousUri] === undefined) {
          return prev;
        }
        const next = {...prev};
        next[nextUri] = next[previousUri]!;
        delete next[previousUri];
        return next;
      });
      remapEditorShellScrollMapExact(
        editorShellScrollByUriRef.current,
        previousUri,
        nextUri,
      );
      if (selectedUriRef.current !== previousUri) {
        return;
      }
      selectedUriRef.current = nextUri;
      setSelectedUri(nextUri);
      const lp = lastPersistedRef.current;
      if (lp && lp.uri === previousUri) {
        lastPersistedRef.current = {...lp, uri: nextUri};
        lastPersistedExternalMutationSeqRef.current += 1;
      }
    },
    [],
  );

  const commitMovedDirectoryResult = useCallback(
    (oldUri: string, newUri: string) => {
      setInboxContentByUri(prev => {
        const next = {...prev};
        for (const k of Object.keys(prev)) {
          const mapped = remapVaultUriPrefix(k, oldUri, newUri);
          if (mapped && mapped !== k && prev[k] !== undefined) {
            next[mapped] = prev[k]!;
            delete next[k];
          }
        }
        return next;
      });
      remapEditorShellScrollMapTreePrefix(
        editorShellScrollByUriRef.current,
        oldUri,
        newUri,
      );
      let nextSel: string | null = selectedUriRef.current;
      if (nextSel) {
        const mappedSel = remapVaultUriPrefix(
          nextSel.replace(/\\/g, '/'),
          oldUri,
          newUri,
        );
        nextSel = mappedSel ?? nextSel;
      }
      selectedUriRef.current = nextSel;
      setSelectedUri(nextSel);
      const lp = lastPersistedRef.current;
      if (lp) {
        const mappedLp = remapVaultUriPrefix(lp.uri, oldUri, newUri);
        if (mappedLp) {
          lastPersistedRef.current = {...lp, uri: mappedLp};
          lastPersistedExternalMutationSeqRef.current += 1;
        }
      }
    },
    [],
  );

  const commitMoveVaultTreeResult = useCallback(
    (result: MoveVaultTreeItemResult) => {
      if (!vaultRoot || result.previousUri === result.nextUri) {
        return;
      }
      const invKind = result.movedKind === 'article' ? 'file' : 'directory';
      subtreeMarkdownCache.invalidateForMutation(vaultRoot, result.previousUri, invKind);
      subtreeMarkdownCache.invalidateForMutation(vaultRoot, result.nextUri, invKind);

      if (result.movedKind === 'article') {
        commitMovedArticleResult(result.previousUri, result.nextUri);
      } else {
        commitMovedDirectoryResult(result.previousUri, result.nextUri);
      }
      const remappedMoveTabs = remapAllTabsUriPrefix(
        editorWorkspaceTabsRef.current,
        result.previousUri,
        result.nextUri,
      );
      assignLegacyEditorWorkspaceTabs({
        nextTabs: remappedMoveTabs,
        editorWorkspaceTabsRef,
        setEditorWorkspaceTabs,
      });
      remapHomeStatesPrefix(result.previousUri, result.nextUri);
    },
    [
      vaultRoot,
      subtreeMarkdownCache,
      commitMovedArticleResult,
      commitMovedDirectoryResult,
      remapHomeStatesPrefix,
    ],
  );

  const moveVaultTreeItem = useCallback(
    async (
      sourceUri: string,
      sourceKind: 'folder' | 'article',
      targetDirectoryUri: string,
    ) => {
      if (!vaultRoot) {
        return;
      }
      autosaveSchedulerRef.current.cancel();
      await flushInboxSaveRef.current();
      setBusy(true);
      setErr(null);
      try {
        const result = await moveVaultTreeItemToDirectory(vaultRoot, fs, {
          sourceUri,
          sourceKind,
          targetDirectoryUri,
        });
        commitMoveVaultTreeResult(result);
        markVaultWriteSettled();
        await refreshNotes(vaultRoot);
        setFsRefreshNonce(n => n + 1);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [
      vaultRoot,
      fs,
      refreshNotes,
      commitMoveVaultTreeResult,
      autosaveSchedulerRef,
      flushInboxSaveRef,
      markVaultWriteSettled,
    ],
  );

  const bulkDeleteRemoveVaultEntry = useCallback(
    async (entry: VaultTreeBulkItem, root: string) => {
      if (entry.kind === 'article') {
        await deleteVaultMarkdownNote(root, entry.uri, fs);
        subtreeMarkdownCache.invalidateForMutation(root, entry.uri, 'file');
        setInboxContentByUri(prev => {
          if (prev[entry.uri] === undefined) {
            return prev;
          }
          const next = {...prev};
          delete next[entry.uri];
          return next;
        });
        return;
      }
      const normDir = trimTrailingSlashes(entry.uri.replace(/\\/g, '/'));
      await deleteVaultTreeDirectory(root, entry.uri, fs);
      subtreeMarkdownCache.invalidateForMutation(root, entry.uri, 'directory');
      setInboxContentByUri(prev => {
        const next = {...prev};
        for (const k of Object.keys(next)) {
          const kn = k.replace(/\\/g, '/');
          if (kn === normDir || kn.startsWith(`${normDir}/`)) {
            delete next[k];
          }
        }
        return next;
      });
    },
    [fs, subtreeMarkdownCache],
  );

  const bulkDeletePruneTabsAndScroll = useCallback(
    (plan: readonly VaultTreeBulkItem[]) => {
      const sm = editorShellScrollByUriRef.current;
      const {newTabs, nextActive, scrollKeysToRemove} =
        pruneEditorTabsAfterBulkTreeDelete({
          editorWorkspaceTabs: editorWorkspaceTabsRef.current,
          activeEditorTabId: activeEditorTabIdRef.current,
          plan,
          scrollMapKeys: sm.keys(),
        });
      editorWorkspaceTabsRef.current = newTabs;
      setEditorWorkspaceTabs(newTabs);
      activeEditorTabIdRef.current = nextActive;
      setActiveEditorTabId(nextActive);
      if (nextActive == null) {
        mirrorShadowHomeSurface('bulk delete home surface');
      } else {
        mirrorShadowActiveTab(nextActive, 'bulk delete active tab');
      }
      removeHomeHistoryUris(bulkDeleteUriRemovalPredicate(plan));
      for (const key of scrollKeysToRemove) {
        sm.delete(key);
      }
      return {newTabs, nextActive};
    },
    [removeHomeHistoryUris, mirrorShadowActiveTab, mirrorShadowHomeSurface],
  );

  const bulkDeleteVaultTreeItems = useCallback(
    async (items: VaultTreeBulkItem[]) => {
      if (!vaultRoot) {
        return;
      }
      const rootId = trimTrailingSlashes(normalizeVaultBaseUri(vaultRoot).replace(/\\/g, '/'));
      const plan = planVaultTreeBulkTargets(items, rootId);
      if (plan.length === 0) {
        return;
      }
      autosaveSchedulerRef.current.cancel();
      const normSel = selectedUriRef.current?.replace(/\\/g, '/');
      const shouldClearEditor =
        normSel != null
        && plan.some(entry => {
          const d = trimTrailingSlashes(entry.uri.replace(/\\/g, '/'));
          if (entry.kind === 'folder' || entry.kind === 'todayHub') {
            return normSel === d || normSel.startsWith(`${d}/`);
          }
          return normSel === d;
        });
      if (shouldClearEditor) {
        clearInboxSelection();
      }
      await saveChainRef.current.catch(() => undefined);
      setBusy(true);
      setErr(null);
      try {
        for (const entry of plan) {
          await bulkDeleteRemoveVaultEntry(entry, vaultRoot);
        }
        const {newTabs, nextActive} = bulkDeletePruneTabsAndScroll(plan);
        if (shouldClearEditor) {
          const activeTab = nextActive ? findTabById(newTabs, nextActive) : undefined;
          const nextUri =
            (activeTab ? tabCurrentUri(activeTab) : null)
            ?? firstSurvivorUriFromTabs(newTabs);
          if (nextUri) {
            await openMarkdownInEditor(nextUri, {skipHistory: true});
          }
        }
        markVaultWriteSettled();
        await refreshNotes(vaultRoot);
        setFsRefreshNonce(n => n + 1);
        setVaultTreeSelectionClearNonce(n => n + 1);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [
      vaultRoot,
      refreshNotes,
      openMarkdownInEditor,
      bulkDeleteRemoveVaultEntry,
      bulkDeletePruneTabsAndScroll,
      clearInboxSelection,
      autosaveSchedulerRef,
      saveChainRef,
      markVaultWriteSettled,
    ],
  );

  const bulkMoveVaultTreeItems = useCallback(
    async (items: VaultTreeBulkItem[], targetDirectoryUri: string) => {
      if (!vaultRoot) {
        return;
      }
      const rootId = trimTrailingSlashes(normalizeVaultBaseUri(vaultRoot).replace(/\\/g, '/'));
      const plan = filterVaultTreeBulkMoveSources(items, targetDirectoryUri, rootId);
      if (plan.length === 0) {
        return;
      }
      autosaveSchedulerRef.current.cancel();
      await flushInboxSaveRef.current();
      setBusy(true);
      setErr(null);
      try {
        for (const entry of plan) {
          const result = await moveVaultTreeItemToDirectory(vaultRoot, fs, {
            sourceUri: entry.uri,
            sourceKind: entry.kind === 'article' ? 'article' : 'folder',
            targetDirectoryUri,
          });
          commitMoveVaultTreeResult(result);
        }
        markVaultWriteSettled();
        await refreshNotes(vaultRoot);
        setFsRefreshNonce(n => n + 1);
        setVaultTreeSelectionClearNonce(n => n + 1);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [
      vaultRoot,
      fs,
      refreshNotes,
      commitMoveVaultTreeResult,
      autosaveSchedulerRef,
      flushInboxSaveRef,
      markVaultWriteSettled,
    ],
  );

  const activeTabHistory = useMemo(
    () =>
      deriveActiveTabHistorySnapshot({
        editorWorkspaceTabs: tabsControllerSurface[0],
        activeEditorTabId: tabsControllerSurface[1],
      }),
    [tabsControllerSurface],
  );

  const activeHomeState = useMemo(
    () => {
      if (modelActiveEditorTabId != null || modelActiveTodayHubUri == null) {
        return null;
      }
      return (
        modelHomeStatesByHub[modelActiveTodayHubUri] ??
        createWorkspaceHomeState(modelActiveTodayHubUri)
      );
    },
    [modelActiveEditorTabId, modelActiveTodayHubUri, modelHomeStatesByHub],
  );

  const editorHistoryCanGoBack = useMemo(
    () =>
      computeEditorHistoryCanGoBack({
        composingNewEntry,
        activeHomeState,
        activeTabHistory,
      }),
    [composingNewEntry, activeHomeState, activeTabHistory],
  );

  const editorHistoryCanGoForward = useMemo(
    () =>
      computeEditorHistoryCanGoForward({
        busy,
        composingNewEntry,
        activeHomeState,
        activeTabHistory,
      }),
    [busy, composingNewEntry, activeHomeState, activeTabHistory],
  );

  const openCurrentHomeAfterComposing = useCallback(
    async (state: WorkspaceHomeState): Promise<boolean> =>
      openCurrentHomeAfterComposingBridge(
        {
          setComposingNewEntry,
          clearFrontmatterRefs: () =>
            clearInboxYamlFrontmatterEditorRefs({
              inner: inboxYamlFrontmatterInnerRef,
              leading: inboxEditorYamlLeadingBeforeFrontmatterRef,
              setInner: setInboxYamlFrontmatterInner,
              setLeading: setInboxEditorYamlLeadingBeforeFrontmatter,
            }),
          setEditorBody,
          setInboxEditorResetNonce,
          openMarkdownInEditor,
        },
        state,
      ),
    [openMarkdownInEditor],
  );

  const moveHomeHistory = useCallback(
    async (
      hubUri: string,
      state: WorkspaceHomeState,
      move: (state: WorkspaceHomeState) => WorkspaceHomeState,
    ): Promise<boolean> =>
      moveHomeHistoryBridge(
        {setHomeStateForHub, openMarkdownInEditor},
        hubUri,
        state,
        move,
      ),
    [openMarkdownInEditor, setHomeStateForHub],
  );

  const editorHistoryGoBack = useCallback(() => {
    void runEditorHistoryGoBack({
      activeTodayHubUriRef,
      activeEditorTabIdRef,
      homeStatesByHubRef,
      editorWorkspaceTabsRef,
      composingNewEntryRef,
      flushInboxSave: () => flushInboxSaveRef.current(),
      dispatchWorkspaceActionSync,
      openMarkdownInEditor,
      openCurrentHomeAfterComposing,
      moveHomeHistory,
      setComposingNewEntry,
      setEditorBody,
      setInboxEditorResetNonce,
      setEditorWorkspaceTabs,
      clearFrontmatterRefs: () =>
        clearInboxYamlFrontmatterEditorRefs({
          inner: inboxYamlFrontmatterInnerRef,
          leading: inboxEditorYamlLeadingBeforeFrontmatterRef,
          setInner: setInboxYamlFrontmatterInner,
          setLeading: setInboxEditorYamlLeadingBeforeFrontmatter,
        }),
    });
  }, [
    dispatchWorkspaceActionSync,
    flushInboxSaveRef,
    openMarkdownInEditor,
    openCurrentHomeAfterComposing,
    moveHomeHistory,
  ]);

  const editorHistoryGoForward = useCallback(() => {
    void runEditorHistoryGoForward({
      activeTodayHubUriRef,
      activeEditorTabIdRef,
      homeStatesByHubRef,
      editorWorkspaceTabsRef,
      composingNewEntryRef,
      flushInboxSave: () => flushInboxSaveRef.current(),
      dispatchWorkspaceActionSync,
      openMarkdownInEditor,
      moveHomeHistory,
      setEditorWorkspaceTabs,
    });
  }, [
    dispatchWorkspaceActionSync,
    flushInboxSaveRef,
    openMarkdownInEditor,
    moveHomeHistory,
  ]);

  /** Last vault we applied the "shell not restored" reset for; avoids racing restore's `true`. */
  const inboxShellRestoredResetVaultRef = useRef<string | null>(null);
  const inboxRestoreEnabledPrevRef = useRef(inboxRestoreEnabled);

  useEffect(() => {
    if (!inboxRestoreEnabled) {
      queueMicrotask(() => {
        assignInboxShellRestored(setInboxShellRestored, true);
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
  }, [vaultRoot, inboxRestoreEnabled]);

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
    [],
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
    [],
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
    [restoredInboxState, startNewEntry, selectNote, selectHomeCurrentNote],
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
      restoredInboxState != null &&
      typeof restoredInboxState.vaultRoot === 'string' &&
      normalizedVaultRootPath(restoredInboxState.vaultRoot) === root;

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
        const mergedWs = mergeStoredHubWorkspaces({
          hubUris,
          restored: restoredInboxState,
          filter,
          activeHub: activeHubFinal,
          activeHubTabs: editorWorkspaceTabsRef.current,
          activeHubActiveTabId: activeEditorTabIdRef.current,
        });
        const homeHydrated = hydrateWorkspaceHomeStatesFromPersisted({
          hubUris,
          activeTodayHubUri: activeHubFinal,
          todayHubWorkspaces: restoredInboxState.todayHubWorkspaces as
            | Record<string, unknown>
            | null
            | undefined,
        });
        assignLegacyRuntimeActiveHub(activeHubFinal, {
          ref: activeTodayHubUriRef,
          setActiveTodayHubUri,
        });
        assignLegacyHomeStatesByHub(
          homeStatesByHubRef,
          setHomeStatesByHub,
          homeHydrated,
        );
        assignInboxShellRestored(setInboxShellRestored, true);
        shellRestoreProjection = {
          activeTodayHubUri: activeHubFinal,
          hubUris,
          legacyHubWorkspaceSnapshots: mergedWs,
          homeStatesByHub: homeHydrated,
        };
      } else if (vaultMarkdownRefs.length > 0) {
        assignLegacyRuntimeActiveHub(null, {
          ref: activeTodayHubUriRef,
          setActiveTodayHubUri,
        });
        mirrorShadowActiveHub(null, 'restore active hub');
        assignInboxShellRestored(setInboxShellRestored, true);
      } else {
        assignInboxShellRestored(setInboxShellRestored, true);
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
      assignInboxShellRestored(setInboxShellRestored, true);
    });
  }, [
    vaultRoot,
    inboxRestoreEnabled,
    inboxShellRestored,
    restoredInboxState,
    notes,
    vaultMarkdownRefs,
    applyRestoredEditorWorkspaceTabs,
    migrateLegacyOpenTabsIfNeeded,
    mirrorShadowActiveHub,
    mirrorShadowActiveTab,
    mirrorShadowActiveWorkspaceTabs,
    mirrorShadowHomeSurface,
    restoreInboxSelectionAfterShellRestore,
    syncShadowWorkspaceFromShellRestore,
  ]);

  useEffect(() => {
    if (!vaultRoot || !inboxShellRestored || vaultMarkdownRefs.length === 0) {
      return;
    }
    const root = normalizedVaultRootPath(vaultRoot);
    const restoredMatchesCurrentVault =
      restoredInboxState != null &&
      typeof restoredInboxState.vaultRoot === 'string' &&
      normalizedVaultRootPath(restoredInboxState.vaultRoot) === root;
    if (restoredMatchesCurrentVault) {
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
    assignLegacyRuntimeActiveHub(pick, {
      ref: activeTodayHubUriRef,
      setActiveTodayHubUri,
    });
    mirrorShadowActiveHub(pick, 'default active hub');
  }, [
    vaultRoot,
    inboxShellRestored,
    vaultMarkdownRefs,
    modelActiveTodayHubUri,
    mirrorShadowActiveHub,
    switchTodayHubWorkspace,
    restoredInboxState,
  ]);

  return {
    vaultRoot,
    vaultSettings,
    setVaultSettings,
    settingsName,
    busy,
    fsRefreshNonce,
    podcastFsNonce,
    deviceInstanceId,
    selectionController: {
      notes,
      selectedUri,
      editorBody,
      setEditorBody: guardedSetEditorBody,
      inboxEditorResetNonce,
      composingNewEntry,
      startNewEntry,
      cancelNewEntry,
      selectNote,
      selectNoteInNewActiveTab,
      submitNewEntry,
      inboxContentByUri,
      vaultMarkdownRefs,
      selectedNoteBacklinkUris,
      inboxEditorShellScrollDirectiveRef,
      inboxBacklinksDeferNonce,
    },
    notificationsState: {
      err, setErr, wikiRenameNotice, renameLinkProgress, pendingWikiLinkAmbiguityRename,
      confirmPendingWikiLinkAmbiguityRename, cancelPendingWikiLinkAmbiguityRename,
    },
    conflictController: {
      diskConflict,
      resolveDiskConflictReloadFromDisk,
      resolveDiskConflictKeepLocal,
      diskConflictSoft,
      elevateDiskConflictSoftToBlocking,
      dismissDiskConflictSoft,
      mergeView,
      closeMergeView,
      applyFullBackupFromMerge,
      keepMyEditsFromMerge,
      enterDiskConflictMergeView,
      applyMergedBodyFromMerge,
    },
    hydrateVault,
    persistenceController: {
      onInboxSaveShortcut,
      onCleanNoteInbox,
      flushInboxSave,
      saveSettledNonce: vaultWriteSettledNonce,
    },
    linkController,
    treeController: {
      deleteNote,
      renameNote,
      subtreeMarkdownCache,
      deleteFolder,
      renameFolder,
      moveVaultTreeItem,
      bulkDeleteVaultTreeItems,
      bulkMoveVaultTreeItems,
      vaultTreeSelectionClearNonce,
    },
    inboxShellRestored,
    initialVaultHydrateAttemptDone,
    tabsController: {
      editorHistoryCanGoBack, editorHistoryCanGoForward, editorHistoryGoBack, editorHistoryGoForward,
      editorWorkspaceTabs: tabsControllerSurface[0],
      activeEditorTabId: tabsControllerSurface[1],
      activateOpenTab, closeEditorTab, reorderEditorWorkspaceTabs,
      closeOtherEditorTabs, closeAllEditorTabs, reopenLastClosedEditorTab, canReopenClosedEditorTab,
    },
    todayHubController: {
      showTodayHubCanvas,
      todayHubSettings,
      todayHubBridgeRef,
      todayHubWikiNavParentRef,
      todayHubCellEditorRef,
      prehydrateTodayHubRows,
      persistTodayHubRow,
      todayHubCleanRowBlocked,
      todayHubSelectorItems,
      activeTodayHubUri: modelActiveTodayHubUri,
      persistenceActiveTodayHubUri: modelDerivedPersistence.activeTodayHubUri,
      persistenceTodayHubWorkspaces: modelDerivedPersistence.todayHubWorkspaces as Record<
        string,
        TodayHubWorkspaceSnapshot
      >,
      legacyTodayHubWorkspacesForSwitch: todayHubWorkspacesForSwitch,
      // serializeWorkspaceModelToPersistence always writes a non-null homeHistory,
      // so the null branch of TodayHubWorkspaceSnapshotPersisted.homeHistory never fires here.
      todayHubWorkspacesForSave: modelDerivedPersistence.todayHubWorkspaces as Record<
        string,
        TodayHubWorkspaceSnapshot
      >,
      switchTodayHubWorkspace,
      focusActiveTodayHubNote,
      workspaceSelectorSubLabel,
      openWorkspaceHomeCurrentInBackgroundTab,
      workspaceSelectShowsActiveTabPill,
    },
    frontmatterController: {
      inboxYamlFrontmatterInner,
      applyFrontmatterInnerChange,
      syncFrontmatterStateFromDisk,
    },
    workspaceShadowModelForTests:
      import.meta.env.MODE === 'test' ? workspaceShadowModel : undefined,
  };
}

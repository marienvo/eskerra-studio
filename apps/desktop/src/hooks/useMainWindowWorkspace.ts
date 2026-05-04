/**
 * Main-window vault workspace: orchestration hook (Tauri FS, editor tabs, Today hub, wiki rename).
 *
 * Ownership: wire platform I/O and React state here; prefer extracted modules for focused logic
 * (`workspaceFsWatchReconcile`, `workspaceEditorTabs`, `workspaceVaultTreeMutations`, `inboxShellRestoreHelpers`).
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
  parseTodayHubFrontmatter,
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
  isEditorClosedTabReopenable,
} from '../lib/editorClosedTabStack';
import {
  createEditorWorkspaceTab,
  ensureActiveTabId,
  findTabById,
  findTabIdWithCurrentUri,
  firstSurvivorUriFromTabs,
  insertTabAfterActive,
  insertTabAtIndex,
  migrateOpenTabUrisToWorkspaceTabs,
  pickNeighborTabIdAfterRemovingTab,
  pushClosedWorkspaceTabsFromCloseAll,
  pushClosedWorkspaceTabsFromCloseOther,
  remapAllTabsUriPrefix,
  removeUriFromAllTabs,
  reorderEditorWorkspaceTabsInArray,
  tabCurrentUri,
  tabsFromStored,
  tabsToStored,
  type EditorWorkspaceTab,
} from '../lib/editorWorkspaceTabs';
import {editorOpenTabPillLabel} from '../lib/editorOpenTabPillLabel';
import type {TodayHubWorkspaceSnapshot} from '../lib/mainWindowUiStore';
import {sortedTodayHubNoteUrisFromRefs} from '@eskerra/core';
import {pickDefaultActiveTodayHubUri} from '../lib/todayHubWorkspaceRestore';
import {
  selectNoteActiveHubTodayOpen,
  workspaceSelectShowsActiveTabPillState,
} from '../lib/workspaceShellToday';
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
  buildRestoredEditorWorkspace,
  isUriValidVaultMarkdown,
  makeStoredTabFilter,
  mergeStoredHubWorkspaces,
  pickFinalActiveHub,
  resolveActiveHubAndTabsSource,
} from './inboxShellRestoreHelpers';
import {
  type DiskConflictSoftState,
  type DiskConflictState,
  type LastPersisted,
  fingerprintUtf16ForDebug,
} from './workspaceFsWatchReconcile';
import {
  applyForegroundOpenTabPlacement,
  cloneEditorWorkspaceTabs,
  decideWorkspaceShellMode,
} from './workspaceEditorTabs';
import {pruneEditorTabsAfterBulkTreeDelete} from './workspaceVaultTreeMutations';
import {useWorkspaceBacklinks} from './workspaceBacklinks';
import {useWorkspaceLinkRouting} from './workspaceLinkRouting';
import {useWorkspacePersistence} from './workspacePersistence';
import {
  normalizeVaultWatchErrorReason,
  useWorkspaceVaultWatchEffects,
} from './workspaceVaultWatchEffects';
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

const STORE_PATH = 'eskerra-desktop.json';
const STORE_KEY_VAULT = 'vaultRoot';

/** Debounce scan of the active note body for backlinks (full vault scan is too heavy per keystroke). */
const INBOX_BACKLINK_BODY_DEBOUNCE_MS = 200;

type NoteRow = {lastModified: number | null; name: string; uri: string};

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
  const [inboxShellRestored, setInboxShellRestored] = useState(true);
  const [editorWorkspaceTabs, setEditorWorkspaceTabs] = useState<
    EditorWorkspaceTab[]
  >([]);
  const [activeEditorTabId, setActiveEditorTabId] = useState<string | null>(
    null,
  );
  const [activeTodayHubUri, setActiveTodayHubUri] = useState<string | null>(
    null,
  );
  const [todayHubWorkspacesForSave, setTodayHubWorkspacesForSave] = useState<
    Record<string, TodayHubWorkspaceSnapshot>
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
    const root = vaultRoot;
    if (!root) {
      return false;
    }
    const noteSet = new Set(
      notes.map(n => n.uri.replace(/\\/g, '/')),
    );
    const stack = editorClosedTabsStackSnapshot;
    for (let i = stack.length - 1; i >= 0; i--) {
      if (
        isEditorClosedTabReopenable(stack[i]!.uri, root, noteSet)
      ) {
        return true;
      }
    }
    return false;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- editorClosedStackVersion syncs ref stack mutations to UI
  }, [vaultRoot, notes, editorClosedStackVersion, editorClosedTabsStackSnapshot]);

  const todayHubSelectorItems = useMemo(() => {
    const hubs = sortedTodayHubNoteUrisFromRefs(vaultMarkdownRefs);
    return hubs.map(todayNoteUri => ({
      todayNoteUri,
      label: editorOpenTabPillLabel(notes, todayNoteUri),
    }));
  }, [vaultMarkdownRefs, notes]);

  const todayHubWorkspacesPersistFiltered = useMemo(() => {
    const hubs = new Set(sortedTodayHubNoteUrisFromRefs(vaultMarkdownRefs));
    const out: Record<string, TodayHubWorkspaceSnapshot> = {};
    for (const [k, v] of Object.entries(todayHubWorkspacesForSave)) {
      if (hubs.has(k)) {
        out[k] = v;
      }
    }
    return out;
  }, [todayHubWorkspacesForSave, vaultMarkdownRefs]);

  const workspaceSelectShowsActiveTabPill = useMemo(
    () =>
      workspaceSelectShowsActiveTabPillState({
        composingNewEntry,
        activeTodayHubUri,
        selectedUri,
        editorWorkspaceTabs,
      }),
    [composingNewEntry, activeTodayHubUri, selectedUri, editorWorkspaceTabs],
  );

  useEffect(() => {
    vaultMarkdownRefsRef.current = vaultMarkdownRefs;
  }, [vaultMarkdownRefs]);

  const showTodayHubCanvas = useMemo(() => {
    if (!vaultRoot || !selectedUri || composingNewEntry) {
      return false;
    }
    const normRoot = trimTrailingSlashes(normalizeVaultBaseUri(vaultRoot).replace(/\\/g, '/'));
    const normSel = selectedUri.replace(/\\/g, '/');
    if (!normSel.startsWith(`${normRoot}/`)) {
      return false;
    }
    return vaultUriIsTodayMarkdownFile(normSel);
  }, [vaultRoot, selectedUri, composingNewEntry]);

  useLayoutEffect(() => {
    showTodayHubCanvasRef.current = showTodayHubCanvas;
  }, [showTodayHubCanvas]);

  // Use `inboxYamlFrontmatterInner` state in the merge (not only the ref) so deps match and Today hub
  // refreshes on frontmatter-only edits. Leading still comes from the ref (updated with inner on disk sync).
  const todayHubSettings = useMemo((): TodayHubSettings | null => {
    if (!showTodayHubCanvas || !selectedUri) {
      return null;
    }
    const full = inboxEditorSliceToFullMarkdown(
      editorBody,
      selectedUri,
      composingNewEntry,
      inboxYamlFrontmatterInner,
      inboxEditorYamlLeadingBeforeFrontmatter,
    );
    return parseTodayHubFrontmatter(full);
  }, [
    showTodayHubCanvas,
    selectedUri,
    editorBody,
    composingNewEntry,
    inboxYamlFrontmatterInner,
    inboxEditorYamlLeadingBeforeFrontmatter,
  ]);

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
        editorWorkspaceTabsRef.current = remappedRenameTabs;
        setEditorWorkspaceTabs(remappedRenameTabs);
      }
    },
    [],
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
    [fs],
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
    [fs, refreshNotes, subtreeMarkdownCache],
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
  }, []);

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
  }, []);

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
    [loadFullMarkdownIntoInboxEditor, scheduleBacklinksDeferOneFrameAfterLoad],
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
      let nextTabs: EditorWorkspaceTab[];
      if (
        typeof options?.insertAtIndex === 'number'
        && Number.isFinite(options.insertAtIndex)
      ) {
        nextTabs = insertTabAtIndex(curTabs, options.insertAtIndex, newTab);
      } else if (options?.insertAfterActive) {
        nextTabs = insertTabAfterActive(curTabs, activeId, newTab);
      } else {
        nextTabs = [...curTabs, newTab];
      }
      editorWorkspaceTabsRef.current = nextTabs;
      setEditorWorkspaceTabs(nextTabs);
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
    [],
  );

  const openMarkdownInEditor = useCallback(
    async (
      uri: string,
      options?: {
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
        /**
         * Clear editor tabs for the active hub and open this note without a tab pill.
         * Only honored for the active workspace `Today.md` (`activeTodayHubUri`).
         */
        workspaceShell?: boolean;
        /**
         * Keep tab rows but set `activeEditorTabId` to null while opening the active hub Today
         * (implicit “home” surface; no tab pill active). Mutually exclusive with `workspaceShell`.
         */
        workspaceShellPreserveTabs?: boolean;
      },
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

      let nextTabs = editorWorkspaceTabsRef.current;
      let nextActiveId = activeEditorTabIdRef.current;
      const shellMode = decideWorkspaceShellMode({
        targetNorm,
        activeTodayHubUri: activeTodayHubUriRef.current,
        options,
      });
      if (shellMode === 'shell') {
        nextTabs = [];
        nextActiveId = null;
      } else if (shellMode === 'preserveTabs') {
        nextTabs = [...editorWorkspaceTabsRef.current];
        nextActiveId = null;
      } else {
        const placement = applyForegroundOpenTabPlacement({
          uri,
          targetNorm,
          tabs: nextTabs,
          activeId: nextActiveId,
          options,
        });
        nextTabs = placement.nextTabs;
        nextActiveId = placement.nextActiveId;
      }

      editorWorkspaceTabsRef.current = nextTabs;
      activeEditorTabIdRef.current = nextActiveId;
      setEditorWorkspaceTabs(nextTabs);
      setActiveEditorTabId(nextActiveId);

      loadOpenedNoteBodyAndApplySelection(targetNorm, prefetchBody);
    },
    [
      inboxEditorShellScrollRef,
      clearStaleDiskConflictsForOpen,
      prepareInboxScrollDirectiveForOpen,
      snapshotAndPersistCurrentNoteBeforeOpen,
      tryPrefetchTargetBody,
      applyBackgroundNewTabOpen,
      loadOpenedNoteBodyAndApplySelection,
    ],
  );

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
  }, []);

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
    ],
  );

  const activateOpenTab = useCallback(
    (tabId: string) => {
      const tab = findTabById(editorWorkspaceTabsRef.current, tabId);
      const u = tab ? tabCurrentUri(tab) : null;
      if (!u) {
        return;
      }
      activeEditorTabIdRef.current = tabId;
      setActiveEditorTabId(tabId);
      void openMarkdownInEditor(u, {skipHistory: true});
    },
    [openMarkdownInEditor],
  );

  const reorderEditorWorkspaceTabs = useCallback(
    (fromIndex: number, insertBeforeIndex: number) => {
      if (busy) {
        return;
      }
      const tabs = editorWorkspaceTabsRef.current;
      const next = reorderEditorWorkspaceTabsInArray(tabs, fromIndex, insertBeforeIndex);
      let sameOrder = true;
      for (let i = 0; i < next.length; i++) {
        if (next[i]!.id !== tabs[i]!.id) {
          sameOrder = false;
          break;
        }
      }
      if (sameOrder) {
        return;
      }
      editorWorkspaceTabsRef.current = next;
      setEditorWorkspaceTabs(next);
    },
    [busy],
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
        activeEditorTabIdRef.current = nextTabId;
        setActiveEditorTabId(nextTabId);
      }
      const neighbor = nextTabId ? findTabById(nextTabs, nextTabId) : undefined;
      const nextUri = neighbor ? tabCurrentUri(neighbor) : null;
      if (nextUri) {
        await openMarkdownInEditor(nextUri, {skipHistory: true});
        return;
      }
      const shellHub = activeTodayHubUriRef.current;
      if (shellHub) {
        await openMarkdownInEditor(shellHub, {workspaceShell: true});
        return;
      }
      if (!nextTabId) {
        activeEditorTabIdRef.current = null;
        setActiveEditorTabId(null);
      }
      clearInboxSelection();
    },
    [openMarkdownInEditor, clearInboxSelection],
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
        const nextTabs = tabsBefore.filter(t => t.id !== tabId);
        editorWorkspaceTabsRef.current = nextTabs;
        setEditorWorkspaceTabs(nextTabs);

        if (!wasActive) {
          return;
        }
        await refocusAfterClosingActiveTab(nextTabId, nextTabs);
      })();
    },
    [recordClosedTabAndPruneScroll, refocusAfterClosingActiveTab],
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
          activeEditorTabIdRef.current = keepTabId;
          setActiveEditorTabId(keepTabId);
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
        const next = prevTabs.filter(t => t.id === keepTabId);
        editorWorkspaceTabsRef.current = next;
        setEditorWorkspaceTabs(next);
      })();
    },
    [openMarkdownInEditor, bumpEditorClosedStack],
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
      editorWorkspaceTabsRef.current = [];
      setEditorWorkspaceTabs([]);
      activeEditorTabIdRef.current = null;
      setActiveEditorTabId(null);
      const shellHubAll = activeTodayHubUriRef.current;
      if (shellHubAll) {
        await openMarkdownInEditor(shellHubAll, {workspaceShell: true});
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
  }, [bumpEditorClosedStack, openMarkdownInEditor]);

  const reopenLastClosedEditorTab = useCallback(() => {
    void (async () => {
      const root = vaultRootRef.current;
      const stack = editorClosedTabsStackRef.current;
      while (stack.length > 0) {
        const rec = stack.pop()!;
        bumpEditorClosedStack();
        const noteSet = new Set(
          notesRef.current.map(n => n.uri.replace(/\\/g, '/')),
        );
        if (isEditorClosedTabReopenable(rec.uri, root, noteSet)) {
          await openMarkdownInEditor(rec.uri, {
            newTab: true,
            activateNewTab: true,
            insertAtIndex: rec.index,
          });
          return;
        }
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
        editorWorkspaceTabsRef.current = [];
        setEditorWorkspaceTabs([]);
        activeEditorTabIdRef.current = null;
        setActiveEditorTabId(null);
        activeTodayHubUriRef.current = null;
        setActiveTodayHubUri(null);
        setTodayHubWorkspacesForSave({});
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
    ],
  );

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
          await hydrateVault(root);
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
  }, [hydrateVault]);

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
  }, [selectedUri, composingNewEntry, vaultRoot]);

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
  }, [editorBody, selectedUri, composingNewEntry, inboxYamlFrontmatterInner]);

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
    [vaultRoot, fs, refreshNotes, openMarkdownInEditor, subtreeMarkdownCache],
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
  }, [resetInboxEditorComposeState]);

  const cancelNewEntry = useCallback(() => {
    void (async () => {
      await flushInboxSaveRef.current();
      setComposingNewEntry(false);
      resetInboxEditorComposeState();
    })();
  }, [resetInboxEditorComposeState]);

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
        await openMarkdownInEditor(shellHub, {workspaceShell: true});
        return;
      }
      clearInboxSelection();
    },
    [openMarkdownInEditor, clearInboxSelection],
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
      if (hubTodayOpen === 'workspaceShell') {
        void openMarkdownInEditor(uri, {workspaceShell: true});
        return;
      }
      if (hubTodayOpen === 'workspaceHomePreserveTabs') {
        void openMarkdownInEditor(uri, {workspaceShellPreserveTabs: true});
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

  const switchTodayHubWorkspace = useCallback(
    async (todayNoteUri: string) => {
      const norm = normalizeEditorDocUri(todayNoteUri);
      if (!norm) {
        return;
      }
      const hubs = sortedTodayHubNoteUrisFromRefs(vaultMarkdownRefsRef.current);
      if (!hubs.includes(norm)) {
        return;
      }
      if (norm === activeTodayHubUriRef.current) {
        selectNote(norm);
        return;
      }

      await flushInboxSaveRef.current();
      if (composingNewEntryRef.current) {
        composingNewEntryRef.current = false;
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

      const old = activeTodayHubUriRef.current;
      let snapForTarget: TodayHubWorkspaceSnapshot | undefined;
      setTodayHubWorkspacesForSave(prev => {
        const next: Record<string, TodayHubWorkspaceSnapshot> = {...prev};
        if (old != null && old !== norm) {
          next[old] = {
            editorWorkspaceTabs: tabsToStored(editorWorkspaceTabsRef.current),
            activeEditorTabId: activeEditorTabIdRef.current,
          };
        }
        snapForTarget = next[norm];
        return next;
      });

      const snapTabs = snapForTarget?.editorWorkspaceTabs;
      let nextTabs: EditorWorkspaceTab[];
      let nextActive: string | null;
      if (snapTabs != null && snapTabs.length > 0) {
        nextTabs = cloneEditorWorkspaceTabs(tabsFromStored(snapTabs));
        nextActive = ensureActiveTabId(
          nextTabs,
          snapForTarget?.activeEditorTabId ?? null,
        );
      } else {
        nextTabs = [];
        nextActive = null;
      }

      editorWorkspaceTabsRef.current = nextTabs;
      activeEditorTabIdRef.current = nextActive;
      setEditorWorkspaceTabs(nextTabs);
      setActiveEditorTabId(nextActive);
      activeTodayHubUriRef.current = norm;
      setActiveTodayHubUri(norm);
      // Do not `selectNote(norm)` when B has restored tabs: that would navigate the
      // active tab to B's Today and overwrite e.g. a tab that was still showing A's hub note.
      if (nextTabs.length === 0) {
        selectNote(norm);
      } else if (nextActive) {
        activateOpenTab(nextActive);
      } else {
        selectNote(norm);
      }
    },
    [selectNote, activateOpenTab],
  );

  const focusActiveTodayHubNote = useCallback(() => {
    const u = activeTodayHubUriRef.current;
    if (u) {
      selectNote(u);
    }
  }, [selectNote]);

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
      refocusAfterActiveTabRemoved,
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
        await refreshNotes(vaultRoot);
        setFsRefreshNonce(n => n + 1);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [vaultRoot, fs, refreshNotes, openMarkdownInEditor, subtreeMarkdownCache],
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
        editorWorkspaceTabsRef.current = remappedTabs;
        setEditorWorkspaceTabs(remappedTabs);
        await refreshNotes(vaultRoot);
        setFsRefreshNonce(n => n + 1);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [vaultRoot, fs, refreshNotes, clearRenameNotice, subtreeMarkdownCache],
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
      editorWorkspaceTabsRef.current = remappedMoveTabs;
      setEditorWorkspaceTabs(remappedMoveTabs);
    },
    [vaultRoot, subtreeMarkdownCache, commitMovedArticleResult, commitMovedDirectoryResult],
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
        await refreshNotes(vaultRoot);
        setFsRefreshNonce(n => n + 1);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [vaultRoot, fs, refreshNotes, commitMoveVaultTreeResult],
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
      for (const key of scrollKeysToRemove) {
        sm.delete(key);
      }
      return {newTabs, nextActive};
    },
    [],
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
        await refreshNotes(vaultRoot);
        setFsRefreshNonce(n => n + 1);
        setVaultTreeSelectionClearNonce(n => n + 1);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [vaultRoot, fs, refreshNotes, commitMoveVaultTreeResult],
  );

  const activeTabHistory = useMemo(() => {
    const tab = activeEditorTabId
      ? findTabById(editorWorkspaceTabs, activeEditorTabId)
      : undefined;
    return tab?.history ?? {entries: [], index: -1};
  }, [activeEditorTabId, editorWorkspaceTabs]);

  const editorHistoryCanGoBack = useMemo(() => {
    const {entries, index} = activeTabHistory;
    if (entries.length === 0) {
      return false;
    }
    if (composingNewEntry) {
      return index >= 0;
    }
    return index > 0;
  }, [composingNewEntry, activeTabHistory]);

  const editorHistoryCanGoForward = useMemo(() => {
    const {entries, index} = activeTabHistory;
    if (busy || composingNewEntry) {
      return false;
    }
    return index >= 0 && index < entries.length - 1;
  }, [busy, composingNewEntry, activeTabHistory]);

  const editorHistoryGoBack = useCallback(() => {
    void (async () => {
      await flushInboxSaveRef.current();
      const id = activeEditorTabIdRef.current;
      const tabs = editorWorkspaceTabsRef.current;
      const tab = id ? findTabById(tabs, id) : undefined;
      const snap = tab?.history ?? {entries: [], index: -1};
      if (composingNewEntryRef.current) {
        if (snap.entries.length === 0 || snap.index < 0) {
          return;
        }
        const uri = snap.entries[snap.index]!;
        setComposingNewEntry(false);
        clearInboxYamlFrontmatterEditorRefs({
          inner: inboxYamlFrontmatterInnerRef,
          leading: inboxEditorYamlLeadingBeforeFrontmatterRef,
          setInner: setInboxYamlFrontmatterInner,
          setLeading: setInboxEditorYamlLeadingBeforeFrontmatter,
        });
        setEditorBody('');
        setInboxEditorResetNonce(n => n + 1);
        await openMarkdownInEditor(uri, {skipHistory: true});
        return;
      }
      if (snap.index <= 0) {
        return;
      }
      const nextIndex = snap.index - 1;
      const uri = snap.entries[nextIndex]!;
      const nextTabs = tabs.map(t =>
        t.id === id
          ? {...t, history: {...t.history, index: nextIndex}}
          : t,
      );
      editorWorkspaceTabsRef.current = nextTabs;
      setEditorWorkspaceTabs(nextTabs);
      await openMarkdownInEditor(uri, {skipHistory: true});
    })();
  }, [openMarkdownInEditor]);

  const editorHistoryGoForward = useCallback(() => {
    void (async () => {
      if (composingNewEntryRef.current) {
        return;
      }
      await flushInboxSaveRef.current();
      const id = activeEditorTabIdRef.current;
      const tabs = editorWorkspaceTabsRef.current;
      const tab = id ? findTabById(tabs, id) : undefined;
      const snap = tab?.history ?? {entries: [], index: -1};
      if (snap.index < 0 || snap.index >= snap.entries.length - 1) {
        return;
      }
      const nextIndex = snap.index + 1;
      const uri = snap.entries[nextIndex]!;
      const nextTabs = tabs.map(t =>
        t.id === id
          ? {...t, history: {...t.history, index: nextIndex}}
          : t,
      );
      editorWorkspaceTabsRef.current = nextTabs;
      setEditorWorkspaceTabs(nextTabs);
      await openMarkdownInEditor(uri, {skipHistory: true});
    })();
  }, [openMarkdownInEditor]);

  useEffect(() => {
    if (!vaultRoot) {
      queueMicrotask(() => {
        setInboxShellRestored(true);
      });
      return;
    }
    queueMicrotask(() => {
      setInboxShellRestored(false);
    });
  }, [vaultRoot]);

  const applyRestoredEditorWorkspaceTabs = useCallback(
    (
      chosenTabsSource: ReadonlyArray<{id: string; entries: string[]; index: number}>
        | null
        | undefined,
      chosenActiveEditorTabId: string | null,
      filter: (raw: string) => boolean,
    ): string[] => {
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
      queueMicrotask(() => {
        setEditorWorkspaceTabs(built.tabs);
        setActiveEditorTabId(built.activeEditorTabId);
      });
      return built.uris;
    },
    [],
  );

  const migrateLegacyOpenTabsIfNeeded = useCallback(
    (
      rawTabs: readonly string[] | null | undefined,
      filter: (raw: string) => boolean,
    ): string[] => {
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
      });
      return migrated
        .map(t => tabCurrentUri(t))
        .filter((u): u is string => u != null);
    },
    [],
  );

  const restoreInboxSelectionAfterShellRestore = useCallback(
    (root: string, restoredTabs: readonly string[], hubUrisLength: number) => {
      const knownNoteUris = new Set(notesRef.current.map(n => n.uri));
      if (restoredInboxState!.composingNewEntry) {
        startNewEntry();
        return;
      }
      if (restoredInboxState!.selectedUri) {
        const selectedOk = isUriValidVaultMarkdown({
          uri: restoredInboxState!.selectedUri,
          root,
          knownNoteUris,
        });
        if (selectedOk) {
          selectNote(restoredInboxState!.selectedUri);
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
    },
    [restoredInboxState, startNewEntry, selectNote],
  );

  useEffect(() => {
    if (!vaultRoot) {
      return;
    }
    if (!inboxRestoreEnabled || inboxShellRestored) {
      return;
    }
    if (restoredInboxState && restoredInboxState.vaultRoot === vaultRoot) {
      const root = trimTrailingSlashes(normalizeVaultBaseUri(vaultRoot).replace(/\\/g, '/'));
      const hubUris = sortedTodayHubNoteUrisFromRefs(vaultMarkdownRefs);
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
        activeTodayHubUriRef.current = activeHubFinal;
        queueMicrotask(() => {
          setTodayHubWorkspacesForSave(mergedWs);
          setActiveTodayHubUri(activeHubFinal);
        });
      } else if (vaultMarkdownRefs.length > 0) {
        activeTodayHubUriRef.current = null;
        queueMicrotask(() => {
          setTodayHubWorkspacesForSave({});
          setActiveTodayHubUri(null);
        });
      }

      restoreInboxSelectionAfterShellRestore(root, restoredTabs, hubUris.length);
    }
    queueMicrotask(() => {
      setInboxShellRestored(true);
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
    restoreInboxSelectionAfterShellRestore,
  ]);

  useEffect(() => {
    if (!vaultRoot || !inboxShellRestored || vaultMarkdownRefs.length === 0) {
      return;
    }
    const hubs = sortedTodayHubNoteUrisFromRefs(vaultMarkdownRefs);
    if (hubs.length === 0) {
      return;
    }
    const cur = activeTodayHubUri;
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
    setTodayHubWorkspacesForSave(prev => ({
      ...prev,
      [pick]: {
        editorWorkspaceTabs: tabsToStored(editorWorkspaceTabsRef.current),
        activeEditorTabId: activeEditorTabIdRef.current,
      },
    }));
  }, [
    vaultRoot,
    inboxShellRestored,
    vaultMarkdownRefs,
    activeTodayHubUri,
    switchTodayHubWorkspace,
  ]);

  useEffect(() => {
    if (!activeTodayHubUri || !inboxShellRestored) {
      return;
    }
    queueMicrotask(() => {
      setTodayHubWorkspacesForSave(prev => ({
        ...prev,
        [activeTodayHubUri]: {
          editorWorkspaceTabs: tabsToStored(editorWorkspaceTabs),
          activeEditorTabId,
        },
      }));
    });
  }, [
    editorWorkspaceTabs,
    activeEditorTabId,
    activeTodayHubUri,
    inboxShellRestored,
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
      editorWorkspaceTabs, activeEditorTabId, activateOpenTab, closeEditorTab, reorderEditorWorkspaceTabs,
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
      activeTodayHubUri,
      todayHubWorkspacesForSave: todayHubWorkspacesPersistFiltered,
      switchTodayHubWorkspace,
      focusActiveTodayHubNote,
      workspaceSelectShowsActiveTabPill,
    },
    frontmatterController: {
      inboxYamlFrontmatterInner,
      applyFrontmatterInnerChange,
      syncFrontmatterStateFromDisk,
    },
  };
}

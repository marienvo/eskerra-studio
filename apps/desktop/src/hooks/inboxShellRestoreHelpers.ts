/**
 * Inbox / editor shell restore: merge persisted tabs and Today hub workspaces (pure helpers).
 *
 * Ownership: restore-time tab filtering and hub selection; runtime FS reconcile lives in `workspaceFsWatchReconcile`.
 */
import {
  tabsFromStored,
  tabsToStored,
  ensureActiveTabId,
  tabCurrentUri,
} from '../lib/editorWorkspaceTabs';
import type {EditorWorkspaceTab} from '../lib/editorWorkspaceTabs';
import type {TodayHubWorkspaceSnapshot} from '../lib/mainWindowUiStore';
import {vaultUriIsTodayMarkdownFile} from '../lib/vaultTreeLoadChildren';
import {parseWorkspaceModelFromPersistence} from '../lib/workspaceModel/persistence';
import {pickDefaultActiveTodayHubUri} from '../lib/todayHubWorkspaceRestore';

export type StoredWorkspaceRow = {id: string; entries: string[]; index: number};

export type RestoredInboxState = {
  vaultRoot: string;
  composingNewEntry: boolean;
  selectedUri: string | null;
  openTabUris?: readonly string[] | null;
  editorWorkspaceTabs?: ReadonlyArray<StoredWorkspaceRow> | null;
  activeEditorTabId?: string | null;
  activeTodayHubUri?: string | null;
  todayHubWorkspaces?: Record<string, TodayHubWorkspaceSnapshot> | null;
};

function normalizeVaultPath(raw: string): string {
  return raw.replace(/\\/g, '/');
}

function normalizeHubKey(raw: string): string {
  return normalizeVaultPath(raw).replace(/\/+/g, '/').trim();
}

export function makeStoredTabFilter(args: {
  root: string;
  knownNoteUris: ReadonlySet<string>;
}): (raw: string) => boolean {
  const {root, knownNoteUris} = args;
  return (raw: string) => {
    const uri = normalizeVaultPath(raw);
    const inVault = uri === root || uri.startsWith(`${root}/`);
    if (!inVault) return false;
    return knownNoteUris.has(uri) || uri.toLowerCase().endsWith('.md');
  };
}

function sanitizeStoredEntries(
  entries: readonly string[],
  filter: (raw: string) => boolean,
): string[] {
  const out: string[] = [];
  for (const e of entries) {
    const u = normalizeVaultPath(e);
    if (filter(u)) {
      out.push(u);
    }
  }
  return out;
}

function sanitizeStoredWorkspaceRow(
  t: StoredWorkspaceRow,
  filter: (raw: string) => boolean,
): StoredWorkspaceRow | null {
  const entries = sanitizeStoredEntries(t.entries, filter);
  if (entries.length === 0) {
    return null;
  }
  let index =
    typeof t.index === 'number' && Number.isFinite(t.index)
      ? Math.floor(t.index)
      : 0;
  if (index < 0 || index >= entries.length) {
    index = entries.length - 1;
  }
  const id = typeof t.id === 'string' ? t.id.trim() : '';
  if (!id) {
    return null;
  }
  return {id, entries, index};
}

export function sanitizeStoredWorkspaceRows(
  tabs: ReadonlyArray<StoredWorkspaceRow> | null | undefined,
  filter: (raw: string) => boolean,
): StoredWorkspaceRow[] | null {
  if (tabs == null) return null;
  if (tabs.length === 0) return [];
  const out: StoredWorkspaceRow[] = [];
  for (const t of tabs) {
    const sanitized = sanitizeStoredWorkspaceRow(t, filter);
    if (sanitized) {
      out.push(sanitized);
    }
  }
  return out;
}

function dropHubTodayEchoRows(
  hubUri: string,
  rows: readonly StoredWorkspaceRow[],
): StoredWorkspaceRow[] {
  const hub = normalizeHubKey(hubUri);
  return rows.filter(row => {
    const current = row.entries[row.index];
    return current == null || normalizeHubKey(current) !== hub;
  });
}

function readActiveTabId(raw: unknown): string | null {
  if (raw === null) return null;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

function pickActiveHubFromState(args: {
  hubUris: string[];
  restored: RestoredInboxState;
}): string | null {
  const {hubUris, restored} = args;
  const ws = restored.todayHubWorkspaces;
  if (!ws || Object.keys(ws).length === 0) {
    return pickDefaultActiveTodayHubUri({
      hubUris,
      selectedUri: restored.selectedUri,
      editorWorkspaceTabs: restored.editorWorkspaceTabs,
      openTabUris: restored.openTabUris,
    });
  }
  const rawActive =
    typeof restored.activeTodayHubUri === 'string'
      ? normalizeHubKey(restored.activeTodayHubUri)
      : null;
  if (rawActive && hubUris.includes(rawActive)) {
    return rawActive;
  }
  return pickDefaultActiveTodayHubUri({
    hubUris,
    selectedUri: restored.selectedUri,
    editorWorkspaceTabs: restored.editorWorkspaceTabs,
    openTabUris: restored.openTabUris,
  });
}

export type ChosenActiveHubResolution = {
  resolvedActiveHub: string | null;
  chosenTabsSource: ReadonlyArray<StoredWorkspaceRow> | null | undefined;
  chosenActiveEditorTabId: string | null;
};

/**
 * For an active hub picked from restored state, prefer the hub's own workspace tab snapshot
 * (per-hub state) over the top-level `editorWorkspaceTabs` field.
 */
export function resolveActiveHubAndTabsSource(args: {
  hubUris: string[];
  restored: RestoredInboxState;
  filter: (raw: string) => boolean;
}): ChosenActiveHubResolution {
  const {hubUris, restored, filter} = args;
  const result: ChosenActiveHubResolution = {
    resolvedActiveHub: null,
    chosenTabsSource: restored.editorWorkspaceTabs,
    chosenActiveEditorTabId: restored.activeEditorTabId ?? null,
  };
  if (hubUris.length === 0) {
    return result;
  }
  const resolved = pickActiveHubFromState({hubUris, restored});
  result.resolvedActiveHub = resolved;
  const ws = restored.todayHubWorkspaces;
  if (!ws || !resolved) {
    return result;
  }
  const snap = ws[resolved];
  if (!snap) {
    return result;
  }
  const fromSnap = sanitizeStoredWorkspaceRows(snap.editorWorkspaceTabs, filter);
  if (fromSnap == null) {
    return result;
  }
  result.chosenTabsSource = dropHubTodayEchoRows(resolved, fromSnap);
  result.chosenActiveEditorTabId = readActiveTabId(snap.activeEditorTabId);
  return result;
}

export type RestoredEditorWorkspace = {
  tabs: EditorWorkspaceTab[];
  activeEditorTabId: string | null;
  uris: string[];
};

export function buildRestoredEditorWorkspace(args: {
  chosenTabsSource: ReadonlyArray<StoredWorkspaceRow> | null | undefined;
  chosenActiveEditorTabId: string | null;
  filter: (raw: string) => boolean;
}): RestoredEditorWorkspace | null {
  const {chosenTabsSource, chosenActiveEditorTabId, filter} = args;
  if (chosenTabsSource == null) {
    return null;
  }
  if (chosenTabsSource.length === 0) {
    return {tabs: [], activeEditorTabId: null, uris: []};
  }
  const sanitized = sanitizeStoredWorkspaceRows(chosenTabsSource, filter);
  if (sanitized == null || sanitized.length === 0) {
    return null;
  }
  const tabs = tabsFromStored(sanitized);
  let nextActive = readActiveTabId(chosenActiveEditorTabId);
  if (nextActive && !tabs.some(t => t.id === nextActive)) {
    nextActive = ensureActiveTabId(tabs, nextActive);
  }
  const uris = tabs
    .map(tabCurrentUri)
    .filter((u): u is string => u != null);
  return {tabs, activeEditorTabId: nextActive, uris};
}

function attachPersistedHomeHistoryToMergedHubSnapshots(args: {
  hubUris: string[];
  activeHub: string;
  ws: RestoredInboxState['todayHubWorkspaces'];
  mergedWs: Record<string, TodayHubWorkspaceSnapshot>;
}): void {
  const {hubUris, activeHub, ws, mergedWs} = args;
  if (!ws || hubUris.length === 0) {
    return;
  }
  const parsed = parseWorkspaceModelFromPersistence({
    hubUris,
    activeTodayHubUri: activeHub,
    todayHubWorkspaces: ws as Record<string, unknown>,
  });
  for (const hub of hubUris) {
    const stack = parsed.workspaces[hub]?.homeHistory;
    if (!stack || stack.entries.length === 0) {
      continue;
    }
    const cur = mergedWs[hub];
    if (!cur) {
      continue;
    }
    mergedWs[hub] = {
      ...cur,
      homeHistory: {
        entries: [...stack.entries],
        index: stack.index,
      },
    };
  }
}

export function mergeStoredHubWorkspaces(args: {
  hubUris: string[];
  restored: RestoredInboxState;
  filter: (raw: string) => boolean;
  activeHub: string;
  activeHubTabs: readonly EditorWorkspaceTab[];
  activeHubActiveTabId: string | null;
}): Record<string, TodayHubWorkspaceSnapshot> {
  const {hubUris, restored, filter, activeHub, activeHubTabs, activeHubActiveTabId} = args;
  const mergedWs: Record<string, TodayHubWorkspaceSnapshot> = {};
  const ws = restored.todayHubWorkspaces;
  if (ws) {
    for (const [rawKey, snap] of Object.entries(ws)) {
      const h = normalizeHubKey(rawKey);
      if (!h || !hubUris.includes(h)) {
        continue;
      }
      const rows = sanitizeStoredWorkspaceRows(snap.editorWorkspaceTabs, filter);
      if (rows == null) {
        continue;
      }
      const filteredRows = dropHubTodayEchoRows(h, rows);
      const activeId = readActiveTabId(snap.activeEditorTabId);
      const filteredTabs = tabsFromStored(filteredRows);
      mergedWs[h] = {
        editorWorkspaceTabs: filteredRows,
        activeEditorTabId:
          activeId == null || filteredRows.some(row => row.id === activeId)
            ? activeId
            : ensureActiveTabId(filteredTabs, activeId),
      };
    }
  }
  mergedWs[activeHub] = {
    editorWorkspaceTabs: tabsToStored(activeHubTabs),
    activeEditorTabId: activeHubActiveTabId,
  };
  attachPersistedHomeHistoryToMergedHubSnapshots({hubUris, activeHub, ws, mergedWs});
  return mergedWs;
}

export function pickFinalActiveHub(args: {
  resolvedActiveHub: string | null;
  hubUris: string[];
  restored: RestoredInboxState;
}): string {
  const {resolvedActiveHub, hubUris, restored} = args;
  return (
    resolvedActiveHub
    ?? pickDefaultActiveTodayHubUri({
      hubUris,
      selectedUri: restored.selectedUri,
      editorWorkspaceTabs: restored.editorWorkspaceTabs,
      openTabUris: restored.openTabUris,
    })
    ?? hubUris[0]!
  );
}

export function isUriValidVaultMarkdown(args: {
  uri: string;
  root: string;
  knownNoteUris: ReadonlySet<string>;
}): boolean {
  const {uri, root, knownNoteUris} = args;
  const u = normalizeVaultPath(uri);
  const inVault = u === root || u.startsWith(`${root}/`);
  return inVault && (knownNoteUris.has(u) || u.toLowerCase().endsWith('.md'));
}

/**
 * Merge refs-derived hub URIs with persisted hub keys so restore sees inactive hubs before refs refresh.
 */
export function restoredTodayHubWorkspaceUrisForRestore(args: {
  currentHubUris: readonly string[];
  restored: Record<string, TodayHubWorkspaceSnapshot> | null | undefined;
  root: string;
}): string[] {
  const out = [...args.currentHubUris];
  const seen = new Set(out);
  const root = args.root.replace(/\\/g, '/');
  for (const raw of Object.keys(args.restored ?? {})) {
    const hub = raw.replace(/\\/g, '/').replace(/\/+/g, '/').trim();
    if (!hub || seen.has(hub)) {
      continue;
    }
    if ((hub === root || hub.startsWith(`${root}/`)) && vaultUriIsTodayMarkdownFile(hub)) {
      seen.add(hub);
      out.push(hub);
    }
  }
  return out.sort((a, b) => a.localeCompare(b));
}

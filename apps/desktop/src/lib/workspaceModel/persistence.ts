/**
 * Pure serialization between {@link WorkspaceModel} and persisted inbox workspace fields
 * (`todayHubWorkspaces`, optional legacy top-level tab rows).
 *
 * ## No active hub (`hubUris.length === 0`)
 * `parseWorkspaceModelFromPersistence` returns `{ activeHub: null, workspaces: {} }` and
 * ignores `todayHubWorkspaces`, top-level `editorWorkspaceTabs`, and `openTabUris` (no hub
 * key exists to attach per-hub snapshots to).
 *
 * ## Legacy top-level `editorWorkspaceTabs` / `activeEditorTabId`
 * `serializeWorkspaceModelToPersistence` does not write top-level fields for models produced
 * here (`activeHub === null` implies empty `workspaces`). Top-level is read only during parse
 * when the active hub's per-hub snapshot object is absent (`hubSnapshotAbsent`).
 *
 * ## `activeEditorTabId` when the JSON property is missing
 * If the key is **absent** and there is at least one tab, the active surface defaults to the
 * **first tab** (legacy builds that omitted the field). If the key is present and **null**,
 * the active surface is always **Home**, even when tabs exist.
 */

import type {EditorWorkspaceTab} from '../editorWorkspaceTabs';
import {
  ensureActiveTabId,
  migrateOpenTabUrisToWorkspaceTabs,
  tabCurrentUri,
  tabsFromStored,
} from '../editorWorkspaceTabs';
import {normalizeEditorDocUri} from '../editorDocumentHistory';
import {pickDefaultActiveTodayHubUri} from '../todayHub/todayHubWorkspaceRestore';
import type {HistoryStack, WorkspaceModel, WorkspaceState, TabEntry} from './types';
import {createDefaultWorkspaceState, normalizeWorkspaceUri} from './types';

/** Serialized tab row (matches `StoredEditorWorkspaceTab` on disk). */
export type PersistedStoredEditorWorkspaceTab = {
  id: string;
  entries: string[];
  index: number;
};

export type PersistedEditorDocumentHistoryState = {
  entries: string[];
  index: number;
};

/** Per-hub snapshot written under `todayHubWorkspaces[hub]`. */
export type TodayHubWorkspaceSnapshotPersisted = {
  editorWorkspaceTabs: PersistedStoredEditorWorkspaceTab[];
  activeEditorTabId?: string | null;
  homeHistory?: PersistedEditorDocumentHistoryState | null;
};

export type SerializedWorkspacePersistence = {
  activeTodayHubUri: string | null;
  /** Hub keys are normalized; use `sortedNormalizedHubs` when building for deterministic order. */
  todayHubWorkspaces: Record<string, TodayHubWorkspaceSnapshotPersisted>;
};

export type ParseWorkspacePersistenceArgs = {
  hubUris: readonly string[];
  activeTodayHubUri?: string | null;
  todayHubWorkspaces?: Record<string, unknown> | null;
  editorWorkspaceTabs?: unknown;
  activeEditorTabId?: unknown;
  openTabUris?: readonly unknown[] | null;
  selectedUri?: string | null;
};

function normalizeVaultSlashes(uri: string): string {
  return uri.replace(/\\/g, '/').replace(/\/+/g, '/').trim();
}

export function sortedNormalizedHubs(hubUris: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of hubUris) {
    const h = normalizeWorkspaceUri(raw);
    if (h && !seen.has(h)) {
      seen.add(h);
      out.push(h);
    }
  }
  out.sort((a, b) => a.localeCompare(b));
  return out;
}

function normalizedEntryStrings(rawEntries: unknown): string[] {
  if (!Array.isArray(rawEntries)) {
    return [];
  }
  const entries: string[] = [];
  for (const e of rawEntries) {
    if (typeof e === 'string') {
      const u = normalizeVaultSlashes(e);
      if (u) {
        entries.push(u);
      }
    }
  }
  return entries;
}

function parseSingleLooseStoredTab(raw: unknown): PersistedStoredEditorWorkspaceTab | undefined {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }
  const t = raw as Record<string, unknown>;
  const id = typeof t.id === 'string' ? t.id.trim() : '';
  if (!id) {
    return undefined;
  }
  const entries = normalizedEntryStrings(t.entries);
  if (entries.length === 0) {
    return undefined;
  }
  let index =
    typeof t.index === 'number' && Number.isFinite(t.index) ? Math.floor(t.index) : 0;
  if (index < 0 || index >= entries.length) {
    index = entries.length - 1;
  }
  return {id, entries, index};
}

function parseLooseStoredTabs(raw: unknown): PersistedStoredEditorWorkspaceTab[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: PersistedStoredEditorWorkspaceTab[] = [];
  for (const row of raw) {
    const tab = parseSingleLooseStoredTab(row);
    if (tab) {
      out.push(tab);
    }
  }
  return out;
}

function readActiveEditorTabIdLoose(raw: unknown): string | null {
  if (raw === null) {
    return null;
  }
  if (typeof raw === 'string') {
    const id = raw.trim();
    return id === '' ? null : id;
  }
  return null;
}

function dropHubTodayEchoTabs(hub: string, tabs: readonly EditorWorkspaceTab[]): EditorWorkspaceTab[] {
  const hubNorm = normalizeWorkspaceUri(hub);
  return tabs.filter(t => {
    const cur = tabCurrentUri(t);
    if (cur == null) {
      return true;
    }
    return normalizeEditorDocUri(cur) !== hubNorm;
  });
}

function parseHomeHistoryForHub(hub: string, rawSnap: Record<string, unknown>): HistoryStack {
  const hubNorm = normalizeWorkspaceUri(hub);
  const raw = rawSnap.homeHistory;
  if (raw === null || raw === undefined || typeof raw !== 'object' || Array.isArray(raw)) {
    return {entries: [hubNorm], index: 0};
  }
  const o = raw as Record<string, unknown>;
  const entries = normalizedEntryStrings(o.entries);
  if (entries.length === 0 || normalizeWorkspaceUri(entries[0]!) !== hubNorm) {
    return {entries: [hubNorm], index: 0};
  }
  let index = typeof o.index === 'number' && Number.isFinite(o.index) ? Math.floor(o.index) : 0;
  if (index < 0 || index >= entries.length) {
    index = entries.length - 1;
  }
  return {entries, index};
}

function workspaceTabsToTabEntries(tabs: readonly EditorWorkspaceTab[]): WorkspaceState['tabs'] {
  return tabs.map(t => ({
    id: t.id,
    history: {entries: [...t.history.entries], index: t.history.index},
  }));
}

/**
 * - `activeEditorTabId` key **missing** → first tab if any, else Home.
 * - key present, value **null** → Home (even when tabs exist).
 * - non-null string → clamp with `ensureActiveTabId`.
 */
function activeSurfaceFromSnapshotFields(
  tabs: readonly EditorWorkspaceTab[],
  rawSnap: Record<string, unknown>,
): WorkspaceState['active'] {
  if (!('activeEditorTabId' in rawSnap)) {
    if (tabs.length === 0) {
      return {kind: 'home'};
    }
    return {kind: 'tab', id: tabs[0]!.id};
  }
  const stored = readActiveEditorTabIdLoose(rawSnap.activeEditorTabId);
  if (stored === null) {
    return {kind: 'home'};
  }
  const clamped = ensureActiveTabId(tabs, stored);
  if (clamped == null) {
    return {kind: 'home'};
  }
  return {kind: 'tab', id: clamped};
}

function parseWorkspaceStateFromSnapshot(hub: string, rawSnap: Record<string, unknown>): WorkspaceState {
  const rows = parseLooseStoredTabs(rawSnap.editorWorkspaceTabs);
  const tabs = dropHubTodayEchoTabs(hub, tabsFromStored(rows));
  const homeHistory = parseHomeHistoryForHub(hub, rawSnap);
  const active = activeSurfaceFromSnapshotFields(tabs, rawSnap);
  return {tabs: workspaceTabsToTabEntries(tabs), homeHistory, active};
}

function hubSnapshotAbsent(
  todayHubWorkspaces: Record<string, unknown> | null | undefined,
  hub: string,
): boolean {
  if (todayHubWorkspaces == null || typeof todayHubWorkspaces !== 'object') {
    return true;
  }
  if (!(hub in todayHubWorkspaces)) {
    return true;
  }
  const v = todayHubWorkspaces[hub];
  return v === null || typeof v !== 'object' || Array.isArray(v);
}

function asRecordOrNull(v: unknown): Record<string, unknown> | null {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) {
    return null;
  }
  return v as Record<string, unknown>;
}

function resolveActiveHubUri(args: ParseWorkspacePersistenceArgs, hubs: readonly string[]): string | null {
  if (hubs.length === 0) {
    return null;
  }
  const raw = args.activeTodayHubUri;
  if (typeof raw === 'string') {
    const n = normalizeWorkspaceUri(raw);
    if (hubs.some(h => h === n)) {
      return n;
    }
  }
  const topTabs = parseLooseStoredTabs(args.editorWorkspaceTabs);
  const openUris = Array.isArray(args.openTabUris)
    ? args.openTabUris.filter((x): x is string => typeof x === 'string').map(s => s.trim())
    : null;
  return pickDefaultActiveTodayHubUri({
    hubUris: hubs,
    selectedUri: args.selectedUri ?? null,
    editorWorkspaceTabs: topTabs.length > 0 ? topTabs : null,
    openTabUris: openUris && openUris.length > 0 ? openUris : null,
  });
}

function openTabUrisToStrings(raw: readonly unknown[] | null | undefined): string[] | null {
  if (!raw || raw.length === 0) {
    return null;
  }
  const out: string[] = [];
  for (const x of raw) {
    if (typeof x === 'string') {
      const t = x.trim();
      if (t) {
        out.push(t);
      }
    }
  }
  return out.length > 0 ? out : null;
}

function applyLegacyTopLevelMigration(
  args: ParseWorkspacePersistenceArgs,
  map: Record<string, unknown> | null | undefined,
  resolvedActive: string,
  workspaces: Record<string, WorkspaceState>,
): void {
  const topRows = parseLooseStoredTabs(args.editorWorkspaceTabs);
  if (
    !hubSnapshotAbsent(map, resolvedActive)
    || (topRows.length === 0 && (openTabUrisToStrings(args.openTabUris ?? null)?.length ?? 0) === 0)
  ) {
    return;
  }
  let tabs = dropHubTodayEchoTabs(resolvedActive, tabsFromStored(topRows));
  if (tabs.length === 0) {
    const ots = openTabUrisToStrings(args.openTabUris ?? null);
    if (ots) {
      tabs = dropHubTodayEchoTabs(resolvedActive, migrateOpenTabUrisToWorkspaceTabs(ots));
    }
  }
  const homeHistory = parseHomeHistoryForHub(resolvedActive, {});
  const syntheticSnap: Record<string, unknown> = {
    editorWorkspaceTabs: topRows,
  };
  if (Object.prototype.hasOwnProperty.call(args, 'activeEditorTabId')) {
    syntheticSnap.activeEditorTabId = args.activeEditorTabId;
  }
  const active = activeSurfaceFromSnapshotFields(tabs, syntheticSnap);
  workspaces[resolvedActive] = {
    tabs: workspaceTabsToTabEntries(tabs),
    homeHistory,
    active,
  };
}

function tabEntriesToStoredTabs(tabs: readonly TabEntry[]): PersistedStoredEditorWorkspaceTab[] {
  return tabs.map(t => ({
    id: t.id,
    entries: [...t.history.entries],
    index: t.history.index,
  }));
}

export function parseWorkspaceModelFromPersistence(args: ParseWorkspacePersistenceArgs): WorkspaceModel {
  const hubs = sortedNormalizedHubs(args.hubUris);
  if (hubs.length === 0) {
    return {activeHub: null, workspaces: {}};
  }

  const map = args.todayHubWorkspaces;
  const workspaces: Record<string, WorkspaceState> = {};

  for (const hub of hubs) {
    const rawSnap = map == null ? undefined : map[hub];
    const rec = asRecordOrNull(rawSnap);
    if (rec) {
      workspaces[hub] = parseWorkspaceStateFromSnapshot(hub, rec);
    } else {
      workspaces[hub] = createDefaultWorkspaceState(hub);
    }
  }

  const resolvedActive = resolveActiveHubUri(args, hubs);
  if (resolvedActive != null) {
    applyLegacyTopLevelMigration(args, map, resolvedActive, workspaces);
  }

  const activeHub = resolvedActive ?? hubs[0] ?? null;
  return {activeHub, workspaces};
}

export function serializeWorkspaceModelToPersistence(m: WorkspaceModel): SerializedWorkspacePersistence {
  const hubs = sortedNormalizedHubs(Object.keys(m.workspaces));
  const todayHubWorkspaces: Record<string, TodayHubWorkspaceSnapshotPersisted> = {};
  for (const hub of hubs) {
    const ws = m.workspaces[hub];
    if (!ws) {
      continue;
    }
    todayHubWorkspaces[hub] = {
      editorWorkspaceTabs: tabEntriesToStoredTabs(ws.tabs),
      activeEditorTabId: ws.active.kind === 'tab' ? ws.active.id : null,
      homeHistory: {
        entries: [...ws.homeHistory.entries],
        index: ws.homeHistory.index,
      },
    };
  }
  return {
    activeTodayHubUri: m.activeHub,
    todayHubWorkspaces,
  };
}

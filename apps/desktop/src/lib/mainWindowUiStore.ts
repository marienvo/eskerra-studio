import {load} from '@tauri-apps/plugin-store';
import {sortedTodayHubNoteUrisFromRefs} from '@eskerra/core';

import type {EditorDocumentHistoryState} from './editorDocumentHistory';
import {
  tabCurrentUri,
  tabsToStored,
  type EditorWorkspaceTab,
} from './editorWorkspaceTabs';
import {parseTodayHubSnapshotHomeHistoryForStore} from './workspaceHomePersistence';

export const MAIN_WINDOW_UI_STORE_PATH = 'eskerra-desktop.json';
export const MAIN_WINDOW_UI_KEY = 'mainWindowUiV1';

/** @deprecated Legacy field; migrated to `vaultPaneVisible` / `episodesPaneVisible` on load. */
export type MainTabId = 'podcasts' | 'inbox';

/** Serialized shape of IDE-style editor tabs (matches inbox-level fields). */
export type StoredEditorWorkspaceTab = {
  id: string;
  entries: string[];
  index: number;
};

/** Per Today hub (`…/Today.md` URI): remembered tab bar for that workspace. */
export type TodayHubWorkspaceSnapshot = {
  editorWorkspaceTabs: StoredEditorWorkspaceTab[];
  activeEditorTabId?: string | null;
  /** Home stack for this hub; optional for snapshots written before desktop builds that persist it. */
  homeHistory?: EditorDocumentHistoryState;
};

export type RestoredInboxState = {
  vaultRoot: string;
  composingNewEntry: boolean;
  composeDraftMarkdown?: string;
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
};

export type StoredMainWindowInbox = {
  composingNewEntry: boolean;
  composeDraftMarkdown?: string;
  selectedUri: string | null;
  /**
   * Flat list of open note URIs for legacy restore and for hub-less vaults (no indexed
   * `Today.md`): written together with `editorWorkspaceTabs` when applicable so
   * `migrateLegacyOpenTabsIfNeeded` can recover tabs if rows are missing.
   */
  openTabUris?: string[];
  /**
   * Tab strip at inbox root. For vaults with indexed Today hubs, canonical state is under
   * `todayHubWorkspaces[hub]`; when there are no Today hub notes in the vault index, current
   * desktop builds also write this field so shell restore can rebuild the strip.
   */
  editorWorkspaceTabs?: StoredEditorWorkspaceTab[];
  /**
   * Active tab id for `editorWorkspaceTabs` when persisting a hub-less vault; per-hub
   * snapshots use `todayHubWorkspaces[hub].activeEditorTabId` when hubs exist.
   */
  activeEditorTabId?: string | null;
  /** Canonical `Today.md` URI for the hub workspace driving the tab bar. */
  activeTodayHubUri?: string | null;
  /**
   * Canonical per-hub workspace snapshots (tabs + active tab id + homeHistory).
   * When no `Today.md` hubs exist yet, this may be `{}`.
   */
  todayHubWorkspaces?: Record<string, TodayHubWorkspaceSnapshot>;
};

export type StoredMainWindowUi = {
  vaultRoot: string;
  /** When true, the vault tree column is shown to the left of the editor. */
  vaultPaneVisible: boolean;
  /** When true, the episodes list column is shown (left of the editor, or between vault and editor). */
  episodesPaneVisible: boolean;
  /** When true, the Inbox file tree is shown below the editor (right column). */
  inboxPaneVisible: boolean;
  /** Notifications pane open (list is always session-only). */
  notificationsPanelVisible: boolean;
  inbox: StoredMainWindowInbox;
};

/** Refs entry shape accepted by {@link sortedTodayHubNoteUrisFromRefs}. */
export type VaultMarkdownRefLike = {uri: string; name: string};

/**
 * Builds the inbox slice written by {@link saveMainWindowUi}. When the vault index has no
 * `Today.md` hub notes, also writes top-level tab fields so hub-less shell restore can read
 * the tab strip (restore path with no hub URIs).
 */
export function buildStoredMainWindowInboxForPersist(args: {
  composingNewEntry: boolean;
  composeDraftMarkdown: string;
  selectedUri: string | null;
  activeTodayHubUri: string | null;
  todayHubWorkspaces: Record<string, TodayHubWorkspaceSnapshot>;
  vaultMarkdownRefs: readonly VaultMarkdownRefLike[];
  editorWorkspaceTabs: readonly EditorWorkspaceTab[];
  activeEditorTabId: string | null;
}): StoredMainWindowInbox {
  const base: StoredMainWindowInbox = {
    composingNewEntry: args.composingNewEntry,
    composeDraftMarkdown: args.composeDraftMarkdown,
    selectedUri: args.selectedUri,
    activeTodayHubUri: args.activeTodayHubUri,
    todayHubWorkspaces: args.todayHubWorkspaces,
  };
  if (sortedTodayHubNoteUrisFromRefs(args.vaultMarkdownRefs).length > 0) {
    return base;
  }
  const openTabUris = args.editorWorkspaceTabs
    .map(t => tabCurrentUri(t))
    .filter((u): u is string => u !== '');
  return {
    ...base,
    editorWorkspaceTabs: tabsToStored(args.editorWorkspaceTabs),
    activeEditorTabId: args.activeEditorTabId,
    ...(openTabUris.length > 0 ? {openTabUris} : {}),
  };
}

const DEFAULT_INBOX: StoredMainWindowInbox = {
  composingNewEntry: false,
  selectedUri: null,
};

/** Default matches the former `mainTab` default of `podcasts`. */
export const DEFAULT_MAIN_WINDOW_PANE_VISIBILITY: {
  vaultPaneVisible: boolean;
  episodesPaneVisible: boolean;
  inboxPaneVisible: boolean;
} = {
  vaultPaneVisible: false,
  episodesPaneVisible: true,
  inboxPaneVisible: true,
};

function normalizeStoredVaultUriSlashes(uri: string): string {
  return uri.replace(/\\/g, '/').replace(/\/+/g, '/');
}

function normalizedStoredTabEntryStrings(rawEntries: unknown): string[] {
  if (!Array.isArray(rawEntries)) {
    return [];
  }
  const entries: string[] = [];
  for (const e of rawEntries) {
    if (typeof e === 'string') {
      const u = normalizeStoredVaultUriSlashes(e.trim());
      if (u) {
        entries.push(u);
      }
    }
  }
  return entries;
}

function parseSingleStoredEditorWorkspaceTab(
  rawTab: unknown,
): StoredEditorWorkspaceTab | undefined {
  if (rawTab === null || typeof rawTab !== 'object' || Array.isArray(rawTab)) {
    return undefined;
  }
  const t = rawTab as Record<string, unknown>;
  const id = typeof t.id === 'string' ? t.id.trim() : '';
  if (!id) {
    return undefined;
  }
  const entries = normalizedStoredTabEntryStrings(t.entries);
  if (entries.length === 0) {
    return undefined;
  }
  let index =
    typeof t.index === 'number' && Number.isFinite(t.index)
      ? Math.floor(t.index)
      : 0;
  if (index < 0 || index >= entries.length) {
    index = entries.length - 1;
  }
  return {id, entries, index};
}

function parseStoredEditorWorkspaceTabs(
  rawTabs: unknown,
): StoredEditorWorkspaceTab[] | undefined {
  if (!Array.isArray(rawTabs)) {
    return undefined;
  }
  const tabs: StoredEditorWorkspaceTab[] = [];
  for (const rawTab of rawTabs) {
    const tab = parseSingleStoredEditorWorkspaceTab(rawTab);
    if (tab) {
      tabs.push(tab);
    }
  }
  return tabs;
}

function parseActiveEditorTabId(raw: unknown): string | null | undefined {
  if (raw === null) {
    return null;
  }
  if (typeof raw === 'string') {
    const id = raw.trim();
    return id === '' ? null : id;
  }
  return undefined;
}

function resolveStoredPaneVisibility(o: Record<string, unknown>): {
  vaultPaneVisible: boolean;
  episodesPaneVisible: boolean;
} {
  const v = o.vaultPaneVisible;
  const e = o.episodesPaneVisible;
  if (typeof v === 'boolean' && typeof e === 'boolean') {
    return {vaultPaneVisible: v, episodesPaneVisible: e};
  }
  let legacyTab: MainTabId = 'podcasts';
  if (o.mainTab === 'inbox' || o.mainTab === 'podcasts') {
    legacyTab = o.mainTab;
  }
  if (legacyTab === 'inbox') {
    return {vaultPaneVisible: true, episodesPaneVisible: false};
  }
  return {vaultPaneVisible: false, episodesPaneVisible: true};
}

function parseTodayHubWorkspacesMap(
  rawMap: Record<string, unknown>,
): Record<string, TodayHubWorkspaceSnapshot> | undefined {
  const workspaces: Record<string, TodayHubWorkspaceSnapshot> = {};
  for (const [rawKey, rawSnap] of Object.entries(rawMap)) {
    const hubUri = normalizeStoredVaultUriSlashes(rawKey.trim());
    if (!hubUri) {
      continue;
    }
    if (
      rawSnap === null
      || typeof rawSnap !== 'object'
      || Array.isArray(rawSnap)
    ) {
      continue;
    }
    const snap = rawSnap as Record<string, unknown>;
    const snapTabs = parseStoredEditorWorkspaceTabs(snap.editorWorkspaceTabs);
    if (!snapTabs) {
      continue;
    }
    const snapActive = parseActiveEditorTabId(snap.activeEditorTabId);
    const entry: TodayHubWorkspaceSnapshot = {editorWorkspaceTabs: snapTabs};
    if (snapActive !== undefined) {
      entry.activeEditorTabId = snapActive;
    }
    const homeHistory = parseTodayHubSnapshotHomeHistoryForStore(hubUri, snap);
    if (homeHistory) {
      entry.homeHistory = homeHistory;
    }
    workspaces[hubUri] = entry;
  }
  return Object.keys(workspaces).length > 0 ? workspaces : undefined;
}

function trimmedNonEmptyStringsFromMixedArray(arr: readonly unknown[]): string[] {
  const uris: string[] = [];
  for (const item of arr) {
    if (typeof item === 'string') {
      const u = item.trim();
      if (u) {
        uris.push(u);
      }
    }
  }
  return uris;
}

function mergeInboxCoreFieldsFromRaw(
  inbox: StoredMainWindowInbox,
  ib: Record<string, unknown>,
): void {
  if (typeof ib.composingNewEntry === 'boolean') {
    inbox.composingNewEntry = ib.composingNewEntry;
  }
  if (typeof ib.composeDraftMarkdown === 'string') {
    inbox.composeDraftMarkdown = ib.composeDraftMarkdown;
  }
  if (ib.selectedUri === null) {
    inbox.selectedUri = null;
  } else if (typeof ib.selectedUri === 'string') {
    const t = ib.selectedUri.trim();
    inbox.selectedUri = t === '' ? null : t;
  }
  if (Array.isArray(ib.openTabUris)) {
    const uris = trimmedNonEmptyStringsFromMixedArray(ib.openTabUris);
    if (uris.length > 0) {
      inbox.openTabUris = uris;
    }
  }
}

function mergeInboxWorkspaceFieldsFromRaw(
  inbox: StoredMainWindowInbox,
  ib: Record<string, unknown>,
): void {
  const topTabs = parseStoredEditorWorkspaceTabs(ib.editorWorkspaceTabs);
  if (topTabs) {
    inbox.editorWorkspaceTabs = topTabs;
  }
  const topActive = parseActiveEditorTabId(ib.activeEditorTabId);
  if (topActive !== undefined) {
    inbox.activeEditorTabId = topActive;
  }
  if (ib.activeTodayHubUri === null) {
    inbox.activeTodayHubUri = null;
  } else if (typeof ib.activeTodayHubUri === 'string') {
    const h = normalizeStoredVaultUriSlashes(ib.activeTodayHubUri.trim());
    inbox.activeTodayHubUri = h === '' ? null : h;
  }
  if (
    ib.todayHubWorkspaces !== null
    && typeof ib.todayHubWorkspaces === 'object'
    && !Array.isArray(ib.todayHubWorkspaces)
  ) {
    const workspaces = parseTodayHubWorkspacesMap(
      ib.todayHubWorkspaces as Record<string, unknown>,
    );
    if (workspaces) {
      inbox.todayHubWorkspaces = workspaces;
    }
  }
}

function mergeInboxFieldsFromRaw(
  inbox: StoredMainWindowInbox,
  ib: Record<string, unknown>,
): void {
  mergeInboxCoreFieldsFromRaw(inbox, ib);
  mergeInboxWorkspaceFieldsFromRaw(inbox, ib);
}

/** Pure parse + sanitize for tests and for store values. */
export function normalizeMainWindowUiPayload(parsed: unknown): StoredMainWindowUi | null {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  const o = parsed as Record<string, unknown>;
  const vaultRoot = typeof o.vaultRoot === 'string' ? o.vaultRoot.trim() : '';
  if (!vaultRoot) {
    return null;
  }

  const {vaultPaneVisible, episodesPaneVisible} = resolveStoredPaneVisibility(o);
  let inboxPaneVisible = DEFAULT_MAIN_WINDOW_PANE_VISIBILITY.inboxPaneVisible;
  if (typeof o.inboxPaneVisible === 'boolean') {
    inboxPaneVisible = o.inboxPaneVisible;
  }

  let notificationsPanelVisible = true;
  if (typeof o.notificationsPanelVisible === 'boolean') {
    notificationsPanelVisible = o.notificationsPanelVisible;
  }

  const inbox: StoredMainWindowInbox = {...DEFAULT_INBOX};
  if (o.inbox !== null && typeof o.inbox === 'object' && !Array.isArray(o.inbox)) {
    mergeInboxFieldsFromRaw(inbox, o.inbox as Record<string, unknown>);
  }

  return {
    vaultRoot,
    vaultPaneVisible,
    episodesPaneVisible,
    inboxPaneVisible,
    notificationsPanelVisible,
    inbox,
  };
}

export async function loadMainWindowUi(): Promise<StoredMainWindowUi | null> {
  try {
    const store = await load(MAIN_WINDOW_UI_STORE_PATH);
    const raw = await store.get<string>(MAIN_WINDOW_UI_KEY);
    if (typeof raw !== 'string' || !raw.trim()) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    return normalizeMainWindowUiPayload(parsed);
  } catch {
    return null;
  }
}

export async function saveMainWindowUi(ui: StoredMainWindowUi): Promise<void> {
  const store = await load(MAIN_WINDOW_UI_STORE_PATH);
  await store.set(MAIN_WINDOW_UI_KEY, JSON.stringify(ui));
  await store.save();
}

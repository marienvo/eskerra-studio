import type {
  Dispatch,
  MutableRefObject,
  RefObject,
  SetStateAction,
} from 'react';

import type {
  EskerraSettings,
  SubtreeMarkdownPresenceCache,
  VaultMarkdownRef,
} from '@eskerra/core';

import type {NoteMarkdownEditorHandle} from '../editor/noteEditor/NoteMarkdownEditor';
import type {
  VaultRelativeMarkdownLinkActivatePayload,
  VaultWikiLinkActivatePayload,
} from '../editor/noteEditor/vaultLinkActivatePayload';
import type {EditorWorkspaceTab} from '../lib/editorWorkspaceTabs';
import type {TodayHubWorkspaceSnapshot} from '../lib/mainWindowUiStore';
import type {
  TodayHubSettings,
  TodayHubWorkspaceBridge,
} from '../lib/todayHub';
import type {VaultTreeBulkItem} from '../lib/vaultTreeBulkPlan';

import type {
  DiskConflictSoftState,
  DiskConflictState,
} from './workspaceFsWatchReconcile';

export type WorkspaceNoteRow = {
  lastModified: number | null;
  name: string;
  uri: string;
};

export type WorkspaceRenameLinkProgress = {
  done: number;
  total: number;
};

export type WorkspacePendingWikiLinkAmbiguityRename = {
  uri: string;
  nextDisplayName: string;
  summary: {
    scannedFileCount: number;
    touchedFileCount: number;
    touchedBytes: number;
    updatedLinkCount: number;
    skippedAmbiguousLinkCount: number;
  };
};

export type WorkspaceEditorShellScrollDirective =
  | {kind: 'snapTop'}
  | {kind: 'restore'; top: number; left: number};

export type WorkspaceBootstrapState = {
  vaultRoot: string | null;
  vaultSettings: EskerraSettings | null;
  setVaultSettings: Dispatch<SetStateAction<EskerraSettings | null>>;
  settingsName: string;
  hydrateVault: (root: string) => Promise<void>;
  inboxShellRestored: boolean;
  initialVaultHydrateAttemptDone: boolean;
  fsRefreshNonce: number;
  podcastFsNonce: number;
  deviceInstanceId: string;
  busy: boolean;
};

export type WorkspaceSelectionController = {
  notes: WorkspaceNoteRow[];
  selectedUri: string | null;
  editorBody: string;
  setEditorBody: (value: string) => void;
  inboxEditorResetNonce: number;
  composingNewEntry: boolean;
  startNewEntry: () => void;
  cancelNewEntry: () => void;
  selectNote: (uri: string) => void;
  selectNoteInNewActiveTab: (
    uri: string,
    opts?: {insertAfterActive?: boolean},
  ) => void;
  submitNewEntry: () => Promise<void>;
  inboxContentByUri: Record<string, string>;
  vaultMarkdownRefs: VaultMarkdownRef[];
  selectedNoteBacklinkUris: readonly string[];
  inboxEditorShellScrollDirectiveRef: MutableRefObject<WorkspaceEditorShellScrollDirective | null>;
  inboxBacklinksDeferNonce: number;
};

export type WorkspacePersistenceController = {
  onInboxSaveShortcut: () => void;
  onCleanNoteInbox: () => void;
  flushInboxSave: () => Promise<void>;
};

export type WorkspaceTreeController = {
  deleteNote: (uri: string) => Promise<void>;
  renameNote: (uri: string, nextDisplayName: string) => Promise<void>;
  subtreeMarkdownCache: SubtreeMarkdownPresenceCache;
  deleteFolder: (directoryUri: string) => Promise<void>;
  renameFolder: (directoryUri: string, nextDisplayName: string) => Promise<void>;
  moveVaultTreeItem: (
    sourceUri: string,
    sourceKind: 'folder' | 'article',
    targetDirectoryUri: string,
  ) => Promise<void>;
  bulkDeleteVaultTreeItems: (items: VaultTreeBulkItem[]) => Promise<void>;
  bulkMoveVaultTreeItems: (
    items: VaultTreeBulkItem[],
    targetDirectoryUri: string,
  ) => Promise<void>;
  vaultTreeSelectionClearNonce: number;
};

export type WorkspaceFrontmatterController = {
  inboxYamlFrontmatterInner: string | null;
  applyFrontmatterInnerChange: (nextInner: string | null) => void;
  syncFrontmatterStateFromDisk: (nextInner: string | null, leading: string) => void;
};

export type WorkspaceLinkController = {
  onWikiLinkActivate: (payload: VaultWikiLinkActivatePayload) => void;
  onMarkdownRelativeLinkActivate: (
    payload: VaultRelativeMarkdownLinkActivatePayload,
  ) => void;
  onMarkdownExternalLinkOpen: (payload: {href: string; at: number}) => void;
};

export type WorkspaceTabsController = {
  editorHistoryCanGoBack: boolean;
  editorHistoryCanGoForward: boolean;
  editorHistoryGoBack: () => void;
  editorHistoryGoForward: () => void;
  editorWorkspaceTabs: readonly EditorWorkspaceTab[];
  activeEditorTabId: string | null;
  activateOpenTab: (tabId: string) => void;
  closeEditorTab: (tabId: string) => void;
  reorderEditorWorkspaceTabs: (
    fromIndex: number,
    insertBeforeIndex: number,
  ) => void;
  closeOtherEditorTabs: (keepTabId: string) => void;
  closeAllEditorTabs: () => void;
  reopenLastClosedEditorTab: () => void;
  canReopenClosedEditorTab: boolean;
};

export type WorkspaceTodayHubController = {
  showTodayHubCanvas: boolean;
  todayHubSettings: TodayHubSettings | null;
  todayHubBridgeRef: MutableRefObject<TodayHubWorkspaceBridge>;
  todayHubWikiNavParentRef: MutableRefObject<string | null>;
  todayHubCellEditorRef: RefObject<NoteMarkdownEditorHandle | null>;
  prehydrateTodayHubRows: (rowUris: readonly string[]) => Promise<void>;
  persistTodayHubRow: (
    rowUri: string,
    mergedMarkdown: string,
    columnCount: number,
  ) => Promise<void>;
  todayHubCleanRowBlocked: (rowUri: string) => boolean;
  todayHubSelectorItems: readonly {todayNoteUri: string; label: string}[];
  activeTodayHubUri: string | null;
  /** Active hub URI derived from the shadow workspace model for disk serialization. */
  persistenceActiveTodayHubUri: string | null;
  /**
   * Hub workspaces serialized from the shadow workspace model — authoritative JSON for
   * `StoredMainWindowInbox.todayHubWorkspaces`.
   */
  persistenceTodayHubWorkspaces: Record<string, TodayHubWorkspaceSnapshot>;
  /**
   * Legacy React-backed map (restore merge + hub switch): inactive-hub tab snapshots and switch
   * bookkeeping. Not necessarily identical frame-to-frame to persistenceTodayHubWorkspaces.
   */
  legacyTodayHubWorkspacesForSwitch: Record<string, TodayHubWorkspaceSnapshot>;
  /**
   * @deprecated Use persistenceTodayHubWorkspaces. Same value as model-derived persistence (former ambiguous name).
   */
  todayHubWorkspacesForSave: Record<string, TodayHubWorkspaceSnapshot>;
  switchTodayHubWorkspace: (todayNoteUri: string) => Promise<void>;
  focusActiveTodayHubNote: () => void;
  workspaceSelectorSubLabel?: string;
  openWorkspaceHomeCurrentInBackgroundTab: () => void;
  workspaceSelectShowsActiveTabPill: boolean;
};

export type WorkspaceConflictController = {
  diskConflict: DiskConflictState | null;
  resolveDiskConflictReloadFromDisk: () => void;
  resolveDiskConflictKeepLocal: () => void;
  diskConflictSoft: DiskConflictSoftState | null;
  elevateDiskConflictSoftToBlocking: () => void;
  dismissDiskConflictSoft: () => void;
  mergeView:
    | null
    | {kind: 'backup'; baseUri: string; backupUri: string}
    | {kind: 'diskConflict'; baseUri: string; diskMarkdown: string};
  closeMergeView: () => void;
  applyFullBackupFromMerge: () => Promise<void>;
  keepMyEditsFromMerge: () => void;
  enterDiskConflictMergeView: () => void;
  applyMergedBodyFromMerge: (body: string) => void;
};

export type WorkspaceNotificationsState = {
  err: string | null;
  setErr: (value: string | null) => void;
  wikiRenameNotice: string | null;
  renameLinkProgress: WorkspaceRenameLinkProgress | null;
  pendingWikiLinkAmbiguityRename: WorkspacePendingWikiLinkAmbiguityRename | null;
  confirmPendingWikiLinkAmbiguityRename: () => Promise<void>;
  cancelPendingWikiLinkAmbiguityRename: () => void;
};

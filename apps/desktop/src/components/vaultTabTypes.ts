import type {
  MutableRefObject,
  ReactNode,
  RefObject,
} from 'react';

import type {
  EskerraSettings,
  VaultFilesystem,
  VaultMarkdownRef,
} from '@eskerra/core';

import type {NoteMarkdownEditorHandle} from '../editor/noteEditor/NoteMarkdownEditor';
import type {
  VaultRelativeMarkdownLinkActivatePayload,
  VaultWikiLinkActivatePayload,
} from '../editor/noteEditor/vaultLinkActivatePayload';
import type {InboxEditorShellScrollDirective} from '../hooks/workspaceEditorScrollMap';
import type {EditorWorkspaceTab} from '../lib/editorWorkspaceTabs';
import type {SessionNotification} from '../lib/sessionNotifications';
import type {
  TodayHubSettings,
  TodayHubWorkspaceBridge,
} from '../lib/todayHub';
import type {VaultTreeBulkItem} from '../lib/vaultTreeBulkPlan';

import type {
  EditorWorkspaceToolbarNowPlaying,
} from './EditorWorkspaceToolbar';
import type {PlaybackTransportProps} from './PlaybackTransport';

export type VaultTabNoteRow = {
  lastModified: number | null;
  name: string;
  uri: string;
};

export type VaultTabDiskConflictPayload = {
  uri: string;
};

export type VaultTabWikiLinkAmbiguityRenamePrompt = {
  scannedFileCount: number;
  touchedFileCount: number;
  touchedBytes: number;
  updatedLinkCount: number;
  skippedAmbiguousLinkCount: number;
};

export type VaultTabMergeView =
  | null
  | {kind: 'backup'; baseUri: string; backupUri: string}
  | {kind: 'diskConflict'; baseUri: string; diskMarkdown: string};

export type VaultTabEnvironment = {
  vaultRoot: string;
  vaultSettings: EskerraSettings | null;
  fs: VaultFilesystem;
  fsRefreshNonce: number;
  /** Vault-wide markdown index for wiki resolve, autocomplete, highlighting, and tree sidecars. */
  vaultMarkdownRefs: VaultMarkdownRef[];
};

export type VaultTabLayoutController = {
  vaultPaneVisible: boolean;
  onToggleVault: () => void;
  episodesPaneVisible: boolean;
  onToggleEpisodes: () => void;
  inboxPaneVisible: boolean;
  onToggleInboxPane: () => void;
  /** Ensures the Inbox tree pane is shown before reveal when the active note is under Inbox. */
  onOpenInboxPane: () => void;
  onCloseInboxPane: () => void;
  notificationsInboxStackTopHeightPx: number;
  onNotificationsInboxStackTopHeightPxChanged: (px: number) => void;
  vaultWidthPx: number;
  episodesWidthPx: number;
  onVaultWidthPxChanged: (px: number) => void;
  onEpisodesWidthPxChanged: (px: number) => void;
  stackTopHeightPx: number;
  onStackTopHeightPxChanged: (px: number) => void;
  notificationsWidthPx: number;
  onNotificationsWidthPxChanged: (px: number) => void;
  /** Mount node in `WindowTitleBar` for editor open-note tabs (portal). */
  titleBarEditorTabsHost?: HTMLElement | null;
};

export type VaultTabEditorController = {
  inboxEditorRef: RefObject<NoteMarkdownEditorHandle | null>;
  inboxEditorShellScrollRef: RefObject<HTMLDivElement | null>;
  inboxEditorShellScrollDirectiveRef: MutableRefObject<InboxEditorShellScrollDirective | null>;
  inboxContentByUri: Record<string, string>;
  backlinkUris: readonly string[];
  selectedUri: string | null;
  onSelectNote: (uri: string) => void;
  onSelectNoteInNewActiveTab: (uri: string) => void;
  onAddEntry: () => void;
  composingNewEntry: boolean;
  onCancelNewEntry: () => void;
  onCreateNewEntry: () => void;
  editorBody: string;
  onEditorChange: (body: string) => void;
  inboxEditorResetNonce: number;
  onEditorError: (message: string) => void;
  onSaveShortcut: () => void;
  /** Normalize markdown for the open note (body only); omitted while composing or no selection. */
  onCleanNote?: () => void;
  busy: boolean;
  /** Workspace bumps this after `loadMarkdown`; backlinks defer is handled locally. */
  inboxBacklinksDeferNonce: number;
};

export type VaultTabTreeController = {
  notes: VaultTabNoteRow[];
  onDeleteNote: (uri: string) => void | Promise<void>;
  onRenameNote: (uri: string, nextDisplayName: string) => void | Promise<void>;
  onDeleteFolder: (directoryUri: string) => void | Promise<void>;
  onRenameFolder: (directoryUri: string, nextDisplayName: string) => void | Promise<void>;
  onMoveVaultTreeItem: (
    sourceUri: string,
    sourceKind: 'folder' | 'article',
    targetDirectoryUri: string,
  ) => void | Promise<void>;
  onBulkMoveVaultTreeItems: (
    items: VaultTreeBulkItem[],
    targetDirectoryUri: string,
  ) => void | Promise<void>;
  onBulkDeleteVaultTreeItems: (items: VaultTreeBulkItem[]) => void | Promise<void>;
  vaultTreeSelectionClearNonce: number;
};

export type VaultTabLinkController = {
  onWikiLinkActivate: (payload: VaultWikiLinkActivatePayload) => void;
  onMarkdownRelativeLinkActivate: (
    payload: VaultRelativeMarkdownLinkActivatePayload,
  ) => void;
  onMarkdownExternalLinkOpen: (payload: {href: string; at: number}) => void;
  linkSnippetBlockedDomains?: ReadonlyArray<string>;
  onMuteLinkSnippetDomain?: (domain: string) => void;
};

export type VaultTabTabsController = {
  editorHistoryCanGoBack: boolean;
  editorHistoryCanGoForward: boolean;
  onEditorHistoryGoBack: () => void;
  onEditorHistoryGoForward: () => void;
  editorWorkspaceTabs: readonly EditorWorkspaceTab[];
  activeEditorTabId: string | null;
  onActivateOpenTab: (tabId: string) => void;
  onCloseEditorTab: (tabId: string) => void;
  onReorderEditorWorkspaceTabs?: (fromIndex: number, insertBeforeIndex: number) => void;
  onCloseOtherEditorTabs: (keepTabId: string) => void;
};

export type VaultTabFrontmatterController = {
  inboxYamlFrontmatterInner: string | null;
  applyFrontmatterInnerChange: (nextInner: string | null) => void;
  /** Blocks structured frontmatter edits while a hard conflict is open on the selected note. */
  diskConflict: VaultTabDiskConflictPayload | null;
};

export type VaultTabTodayHubController = {
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
  /** Skip hub row clean when this returns true (e.g. disk conflict on that week file). */
  todayHubCleanRowBlocked?: (rowUri: string) => boolean;
};

export type VaultTabNotificationsController = {
  notificationsPanelVisible: boolean;
  onToggleNotificationsPanel: () => void;
  notificationItems: readonly SessionNotification[];
  notificationHighlightId: string | null;
  onDismissNotification: (id: string) => void;
  onClearAllNotifications: () => void;
};

export type VaultTabMergeController = {
  wikiLinkAmbiguityRenamePrompt: VaultTabWikiLinkAmbiguityRenamePrompt | null;
  onConfirmWikiLinkAmbiguityRename: () => void | Promise<void>;
  onCancelWikiLinkAmbiguityRename: () => void;
  mergeView: VaultTabMergeView;
  onCloseMergeView: () => void;
  onApplyFullBackupFromMerge: () => void | Promise<void>;
  onApplyMergedBodyFromMerge: (body: string) => void;
  onKeepMyEditsFromMerge?: () => void;
};

export type VaultTabPlaybackController = {
  /** Shown in `EditorWorkspaceToolbar` when an episode is active. */
  playbackTransport?: PlaybackTransportProps;
  toolbarNowPlaying?: EditorWorkspaceToolbarNowPlaying | null;
  /** Episodes list column; omitted when `episodesPaneVisible` is false (pass `null`). */
  episodesPane: ReactNode;
};

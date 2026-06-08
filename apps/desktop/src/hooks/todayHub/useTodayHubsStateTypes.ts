import type {
  Dispatch,
  MutableRefObject,
  RefObject,
  SetStateAction,
} from 'react';

import type {SubtreeMarkdownPresenceCache, VaultFilesystem, VaultMarkdownRef} from '@eskerra/core';

import type {NoteMarkdownEditorHandle} from '../../editor/noteEditor/NoteMarkdownEditor';
import type {EditorWorkspaceTab} from '../../lib/editorWorkspaceTabs';
import type {TodayHubWorkspaceSnapshot} from '../../lib/mainWindowUiStore';
import type {TodayHubSettings, TodayHubWorkspaceBridge} from '../../lib/todayHub';
import type {WorkspaceHomeState} from '../../lib/workspaceHomeNavigation';
import type {WorkspaceModel} from '../../lib/workspaceModel';
import type {OpenMarkdownInEditorOptions} from '../workspaceOpenMarkdownCommand';
import type {ShellRestoreProjectionSyncArgs} from '../workspaceInboxShellRestoreBridge';
import type {DiskConflictState} from '../workspaceFsWatchReconcile';
import type {deriveModelDerivedPersistencePayload} from '../workspacePersistenceBridge';

export type TodayHubOpenMarkdown = (
  uri: string,
  options?: OpenMarkdownInEditorOptions,
) => Promise<void>;

export type TodayHubWorkspaceMirrorCallbacks = {
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
};

export type TodayHubWorkspaceBridgeArgs = {
  workspaceShadowModel: WorkspaceModel;
  dispatchWorkspaceActionSync: (
    reason: string,
    reduce: (model: WorkspaceModel) => WorkspaceModel,
  ) => WorkspaceModel;
  mirror: TodayHubWorkspaceMirrorCallbacks;
};

export type TodayHubEditorTabRefs = {
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
  editorWorkspaceTabsRef: MutableRefObject<EditorWorkspaceTab[]>;
  activeEditorTabIdRef: MutableRefObject<string | null>;
  flushInboxSaveRef: MutableRefObject<() => Promise<void>>;
  saveChainRef: MutableRefObject<Promise<void>>;
  saveActiveRef: MutableRefObject<boolean>;
  inboxContentByUriRef: MutableRefObject<Record<string, string>>;
  diskConflictRef: MutableRefObject<DiskConflictState | null>;
  openMarkdownInEditorRef: MutableRefObject<TodayHubOpenMarkdown>;
  activateOpenTabRef: MutableRefObject<(tabId: string) => void>;
  selectNoteRef: MutableRefObject<(uri: string) => void>;
};

export type TodayHubEditorTabSetters = {
  replaceEditorWorkspaceTabs: (nextTabs: EditorWorkspaceTab[]) => void;
  setEditorWorkspaceTabs: Dispatch<SetStateAction<EditorWorkspaceTab[]>>;
  setActiveEditorTabId: Dispatch<SetStateAction<string | null>>;
  setComposingNewEntry: Dispatch<SetStateAction<boolean>>;
  setInboxYamlFrontmatterInner: Dispatch<SetStateAction<string | null>>;
  setInboxEditorYamlLeadingBeforeFrontmatter: Dispatch<SetStateAction<string>>;
  setEditorBody: Dispatch<SetStateAction<string>>;
  setInboxEditorResetNonce: Dispatch<SetStateAction<number>>;
  setInboxContentByUri: Dispatch<SetStateAction<Record<string, string>>>;
};

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
  workspace: TodayHubWorkspaceBridgeArgs;
  editorTabs: TodayHubEditorTabRefs & TodayHubEditorTabSetters & {
    editorWorkspaceTabs: readonly EditorWorkspaceTab[];
    activeEditorTabId: string | null;
  };
  refreshNotes: (root: string) => Promise<void>;
  setFsRefreshNonce: Dispatch<SetStateAction<number>>;
  setErr: (value: string | null) => void;
  markVaultWriteSettled: () => void;
  subtreeMarkdownCache: SubtreeMarkdownPresenceCache;
};

/** @deprecated Use grouped `workspace` + `editorTabs`; kept for gradual migration. */
export type UseTodayHubsStateArgsLegacy = UseTodayHubsStateArgs & {
  workspaceShadowModel: WorkspaceModel;
  dispatchWorkspaceActionSync: TodayHubWorkspaceBridgeArgs['dispatchWorkspaceActionSync'];
  replaceShadowHomeStateForHub: TodayHubWorkspaceMirrorCallbacks['replaceShadowHomeStateForHub'];
  mirrorShadowActiveHub: TodayHubWorkspaceMirrorCallbacks['mirrorShadowActiveHub'];
  mirrorShadowHomeSurface: TodayHubWorkspaceMirrorCallbacks['mirrorShadowHomeSurface'];
  mirrorShadowActiveTab: TodayHubWorkspaceMirrorCallbacks['mirrorShadowActiveTab'];
  mirrorShadowActiveWorkspaceTabs: TodayHubWorkspaceMirrorCallbacks['mirrorShadowActiveWorkspaceTabs'];
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
  ) => Promise<boolean>;
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

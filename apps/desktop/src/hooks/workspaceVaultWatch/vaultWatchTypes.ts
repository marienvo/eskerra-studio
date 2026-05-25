import type {Dispatch, MutableRefObject, RefObject, SetStateAction} from 'react';

import type {
  EskerraSettings,
  SubtreeMarkdownPresenceCache,
  VaultFilesystem,
} from '@eskerra/core';

import type {NoteMarkdownEditorHandle} from '../../editor/noteEditor/NoteMarkdownEditor';
import type {InboxAutosaveScheduler} from '../../lib/inboxAutosaveScheduler';
import type {EditorWorkspaceTab} from '../../lib/editorWorkspaceTabs';
import type {
  TodayHubSettings,
  TodayHubWorkspaceBridge,
} from '../../lib/todayHub';

import type {
  DiskConflictSoftState,
  DiskConflictState,
  LastPersisted,
} from '../workspaceFsWatchReconcile';

export type VaultWatchRefs = {
  vaultRootRef: MutableRefObject<string | null>;
  editorWorkspaceTabsRef: MutableRefObject<EditorWorkspaceTab[]>;
  selectedUriRef: MutableRefObject<string | null>;
  activeEditorTabIdRef: MutableRefObject<string | null>;
  composingNewEntryRef: MutableRefObject<boolean>;
  diskConflictRef: MutableRefObject<DiskConflictState | null>;
  diskConflictSoftRef: MutableRefObject<DiskConflictSoftState | null>;
  inboxContentByUriRef: MutableRefObject<Record<string, string>>;
  lastPersistedRef: MutableRefObject<LastPersisted | null>;
  lastPersistedExternalMutationSeqRef: MutableRefObject<number>;
  editorBodyRef: MutableRefObject<string>;
  openTimeDiskBodyRef: MutableRefObject<string>;
  inboxYamlFrontmatterInnerRef: MutableRefObject<string | null>;
  inboxEditorYamlLeadingBeforeFrontmatterRef: MutableRefObject<string>;
  editorShellScrollByUriRef: MutableRefObject<Map<string, {top: number; left: number}>>;
  skipRecencyDeferForUriRef: MutableRefObject<Set<string>>;
  diskConflictDeferTimerRef: MutableRefObject<number | null>;
  lastInboxEditorActivityAtRef: MutableRefObject<number>;
  autosaveSchedulerRef: MutableRefObject<InboxAutosaveScheduler>;
  todayHubRowLastPersistedRef: MutableRefObject<Map<string, string>>;
  todayHubSettingsRef: MutableRefObject<TodayHubSettings | null>;
  todayHubBridgeRef: MutableRefObject<TodayHubWorkspaceBridge>;
  inboxEditorRef: RefObject<NoteMarkdownEditorHandle | null>;
};

export type VaultWatchActions = {
  setEditorWorkspaceTabs: Dispatch<SetStateAction<EditorWorkspaceTab[]>>;
  setActiveEditorTabId: Dispatch<SetStateAction<string | null>>;
  setDiskConflict: Dispatch<SetStateAction<DiskConflictState | null>>;
  setDiskConflictSoft: Dispatch<SetStateAction<DiskConflictSoftState | null>>;
  setInboxContentByUri: Dispatch<SetStateAction<Record<string, string>>>;
  setSelectedUri: Dispatch<SetStateAction<string | null>>;
  setComposingNewEntry: Dispatch<SetStateAction<boolean>>;
  setEditorBody: Dispatch<SetStateAction<string>>;
  setInboxEditorResetNonce: Dispatch<SetStateAction<number>>;
  setInboxYamlFrontmatterInner: Dispatch<SetStateAction<string | null>>;
  setInboxEditorYamlLeadingBeforeFrontmatter: Dispatch<SetStateAction<string>>;
  setFsRefreshNonce: Dispatch<SetStateAction<number>>;
  setPodcastFsNonce: Dispatch<SetStateAction<number>>;
  setVaultSettings: Dispatch<SetStateAction<EskerraSettings | null>>;
  writeLastPersistedSnapshotWithoutSeqBump: (next: LastPersisted | null) => void;
  bumpLastPersistedExternalMutationSeq: () => void;
  syncWorkspaceModelRemoveOpenTabUri: (normalizedMarkdownUri: string) => void;
};

export type VaultWatchCallbacks = {
  refreshNotes: (root: string) => Promise<void>;
  openMarkdownInEditor: (
    uri: string,
    opts?: {skipHistory?: boolean},
  ) => Promise<void>;
  loadFullMarkdownIntoInboxEditor: (
    markdown: string,
    uri: string,
    selection: 'preserve' | 'start',
  ) => void;
  scheduleBacklinksDeferOneFrameAfterLoad: () => void;
  clearBacklinkDiskBodyCache: () => void;
};

export type VaultWatchDeps = {
  fs: VaultFilesystem;
  subtreeMarkdownCache: SubtreeMarkdownPresenceCache;
  refs: VaultWatchRefs;
  actions: VaultWatchActions;
  callbacks: VaultWatchCallbacks;
};

export type UseWorkspaceVaultWatchEffectsArgs = {
  vaultRoot: string | null;
  fs: VaultFilesystem;
  refreshNotes: VaultWatchCallbacks['refreshNotes'];
  inboxEditorRef: VaultWatchRefs['inboxEditorRef'];
  openMarkdownInEditor: VaultWatchCallbacks['openMarkdownInEditor'];
  loadFullMarkdownIntoInboxEditor: VaultWatchCallbacks['loadFullMarkdownIntoInboxEditor'];
  scheduleBacklinksDeferOneFrameAfterLoad: VaultWatchCallbacks['scheduleBacklinksDeferOneFrameAfterLoad'];
  clearBacklinkDiskBodyCache: VaultWatchCallbacks['clearBacklinkDiskBodyCache'];
  subtreeMarkdownCache: SubtreeMarkdownPresenceCache;
  vaultRootRef: VaultWatchRefs['vaultRootRef'];
  editorWorkspaceTabsRef: VaultWatchRefs['editorWorkspaceTabsRef'];
  selectedUriRef: VaultWatchRefs['selectedUriRef'];
  activeEditorTabIdRef: VaultWatchRefs['activeEditorTabIdRef'];
  composingNewEntryRef: VaultWatchRefs['composingNewEntryRef'];
  diskConflictRef: VaultWatchRefs['diskConflictRef'];
  diskConflictSoftRef: VaultWatchRefs['diskConflictSoftRef'];
  inboxContentByUriRef: VaultWatchRefs['inboxContentByUriRef'];
  lastPersistedRef: VaultWatchRefs['lastPersistedRef'];
  lastPersistedExternalMutationSeqRef: VaultWatchRefs['lastPersistedExternalMutationSeqRef'];
  writeLastPersistedSnapshotWithoutSeqBump: VaultWatchActions['writeLastPersistedSnapshotWithoutSeqBump'];
  bumpLastPersistedExternalMutationSeq: VaultWatchActions['bumpLastPersistedExternalMutationSeq'];
  editorBodyRef: VaultWatchRefs['editorBodyRef'];
  openTimeDiskBodyRef: VaultWatchRefs['openTimeDiskBodyRef'];
  inboxYamlFrontmatterInnerRef: VaultWatchRefs['inboxYamlFrontmatterInnerRef'];
  inboxEditorYamlLeadingBeforeFrontmatterRef: VaultWatchRefs['inboxEditorYamlLeadingBeforeFrontmatterRef'];
  editorShellScrollByUriRef: VaultWatchRefs['editorShellScrollByUriRef'];
  skipRecencyDeferForUriRef: VaultWatchRefs['skipRecencyDeferForUriRef'];
  diskConflictDeferTimerRef: VaultWatchRefs['diskConflictDeferTimerRef'];
  lastInboxEditorActivityAtRef: VaultWatchRefs['lastInboxEditorActivityAtRef'];
  autosaveSchedulerRef: VaultWatchRefs['autosaveSchedulerRef'];
  todayHubRowLastPersistedRef: VaultWatchRefs['todayHubRowLastPersistedRef'];
  todayHubSettingsRef: VaultWatchRefs['todayHubSettingsRef'];
  todayHubBridgeRef: VaultWatchRefs['todayHubBridgeRef'];
  setEditorWorkspaceTabs: VaultWatchActions['setEditorWorkspaceTabs'];
  setActiveEditorTabId: VaultWatchActions['setActiveEditorTabId'];
  setDiskConflict: VaultWatchActions['setDiskConflict'];
  setDiskConflictSoft: VaultWatchActions['setDiskConflictSoft'];
  setInboxContentByUri: VaultWatchActions['setInboxContentByUri'];
  setSelectedUri: VaultWatchActions['setSelectedUri'];
  setComposingNewEntry: VaultWatchActions['setComposingNewEntry'];
  setEditorBody: VaultWatchActions['setEditorBody'];
  setInboxEditorResetNonce: VaultWatchActions['setInboxEditorResetNonce'];
  setInboxYamlFrontmatterInner: VaultWatchActions['setInboxYamlFrontmatterInner'];
  setInboxEditorYamlLeadingBeforeFrontmatter: VaultWatchActions['setInboxEditorYamlLeadingBeforeFrontmatter'];
  setFsRefreshNonce: VaultWatchActions['setFsRefreshNonce'];
  setPodcastFsNonce: VaultWatchActions['setPodcastFsNonce'];
  setVaultSettings: VaultWatchActions['setVaultSettings'];
  syncWorkspaceModelRemoveOpenTabUri: VaultWatchActions['syncWorkspaceModelRemoveOpenTabUri'];
};

export function toVaultWatchDeps(args: UseWorkspaceVaultWatchEffectsArgs): VaultWatchDeps {
  return {
    fs: args.fs,
    subtreeMarkdownCache: args.subtreeMarkdownCache,
    refs: {
      vaultRootRef: args.vaultRootRef,
      editorWorkspaceTabsRef: args.editorWorkspaceTabsRef,
      selectedUriRef: args.selectedUriRef,
      activeEditorTabIdRef: args.activeEditorTabIdRef,
      composingNewEntryRef: args.composingNewEntryRef,
      diskConflictRef: args.diskConflictRef,
      diskConflictSoftRef: args.diskConflictSoftRef,
      inboxContentByUriRef: args.inboxContentByUriRef,
      lastPersistedRef: args.lastPersistedRef,
      lastPersistedExternalMutationSeqRef: args.lastPersistedExternalMutationSeqRef,
      editorBodyRef: args.editorBodyRef,
      openTimeDiskBodyRef: args.openTimeDiskBodyRef,
      inboxYamlFrontmatterInnerRef: args.inboxYamlFrontmatterInnerRef,
      inboxEditorYamlLeadingBeforeFrontmatterRef:
        args.inboxEditorYamlLeadingBeforeFrontmatterRef,
      editorShellScrollByUriRef: args.editorShellScrollByUriRef,
      skipRecencyDeferForUriRef: args.skipRecencyDeferForUriRef,
      diskConflictDeferTimerRef: args.diskConflictDeferTimerRef,
      lastInboxEditorActivityAtRef: args.lastInboxEditorActivityAtRef,
      autosaveSchedulerRef: args.autosaveSchedulerRef,
      todayHubRowLastPersistedRef: args.todayHubRowLastPersistedRef,
      todayHubSettingsRef: args.todayHubSettingsRef,
      todayHubBridgeRef: args.todayHubBridgeRef,
      inboxEditorRef: args.inboxEditorRef,
    },
    actions: {
      setEditorWorkspaceTabs: args.setEditorWorkspaceTabs,
      setActiveEditorTabId: args.setActiveEditorTabId,
      setDiskConflict: args.setDiskConflict,
      setDiskConflictSoft: args.setDiskConflictSoft,
      setInboxContentByUri: args.setInboxContentByUri,
      setSelectedUri: args.setSelectedUri,
      setComposingNewEntry: args.setComposingNewEntry,
      setEditorBody: args.setEditorBody,
      setInboxEditorResetNonce: args.setInboxEditorResetNonce,
      setInboxYamlFrontmatterInner: args.setInboxYamlFrontmatterInner,
      setInboxEditorYamlLeadingBeforeFrontmatter:
        args.setInboxEditorYamlLeadingBeforeFrontmatter,
      setFsRefreshNonce: args.setFsRefreshNonce,
      setPodcastFsNonce: args.setPodcastFsNonce,
      setVaultSettings: args.setVaultSettings,
      writeLastPersistedSnapshotWithoutSeqBump:
        args.writeLastPersistedSnapshotWithoutSeqBump,
      bumpLastPersistedExternalMutationSeq: args.bumpLastPersistedExternalMutationSeq,
      syncWorkspaceModelRemoveOpenTabUri: args.syncWorkspaceModelRemoveOpenTabUri,
    },
    callbacks: {
      refreshNotes: args.refreshNotes,
      openMarkdownInEditor: args.openMarkdownInEditor,
      loadFullMarkdownIntoInboxEditor: args.loadFullMarkdownIntoInboxEditor,
      scheduleBacklinksDeferOneFrameAfterLoad: args.scheduleBacklinksDeferOneFrameAfterLoad,
      clearBacklinkDiskBodyCache: args.clearBacklinkDiskBodyCache,
    },
  };
}

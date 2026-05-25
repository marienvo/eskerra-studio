import {
  useMemo,
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
} from 'react';

import type {SubtreeMarkdownPresenceCache, VaultFilesystem} from '@eskerra/core';

import type {NoteMarkdownEditorHandle} from '../../editor/noteEditor/NoteMarkdownEditor';
import type {EditorWorkspaceTab} from '../../lib/editorWorkspaceTabs';
import type {TodayHubWorkspaceBridge} from '../../lib/todayHub';
import type {TabCommandContext} from '../workspaceTabCommands';
import type {TreeCommandContext} from '../workspaceTreeCommands';
import type {ComposeCommandsContext} from '../workspaceComposeCommands';
import type {OpenMarkdownInEditorOptions} from '../workspaceOpenMarkdownCommand';

export function useTabCommandContext(args: {
  busy: boolean;
  editorWorkspaceTabsRef: MutableRefObject<EditorWorkspaceTab[]>;
  activeEditorTabIdRef: MutableRefObject<string | null>;
  selectedUriRef: MutableRefObject<string | null>;
  composingNewEntryRef: MutableRefObject<boolean>;
  activeTodayHubUriRef: MutableRefObject<string | null>;
  flushInboxSaveRef: MutableRefObject<() => Promise<void>>;
  saveChainRef: MutableRefObject<Promise<void>>;
  vaultRootRef: MutableRefObject<string | null>;
  notesRef: RefObject<readonly {uri: string}[]>;
  editorClosedTabsStackRef: MutableRefObject<unknown[]>;
  editorShellScrollByUriRef: MutableRefObject<Map<string, {top: number; left: number}>>;
  inboxYamlFrontmatterInnerRef: MutableRefObject<string | null>;
  inboxEditorYamlLeadingBeforeFrontmatterRef: MutableRefObject<string>;
  bumpEditorClosedStack: () => void;
  dispatchWorkspaceActionSync: TabCommandContext['callbacks']['dispatchWorkspaceActionSync'];
  replaceEditorWorkspaceTabs: TabCommandContext['callbacks']['replaceEditorWorkspaceTabs'];
  mirrorShadowActiveTab: TabCommandContext['callbacks']['mirrorShadowActiveTab'];
  mirrorShadowHomeSurface: TabCommandContext['callbacks']['mirrorShadowHomeSurface'];
  openMarkdownInEditor: (
    uri: string,
    options?: OpenMarkdownInEditorOptions,
  ) => Promise<void>;
  selectHomeCurrentNote: TabCommandContext['callbacks']['selectHomeCurrentNote'];
  clearInboxSelection: () => void;
  setActiveEditorTabId: TabCommandContext['setters']['setActiveEditorTabId'];
  setSelectedUri: TabCommandContext['setters']['setSelectedUri'];
  setComposingNewEntry: TabCommandContext['setters']['setComposingNewEntry'];
  setEditorBody: TabCommandContext['setters']['setEditorBody'];
  setInboxYamlFrontmatterInner: TabCommandContext['setters']['setInboxYamlFrontmatterInner'];
  setInboxEditorYamlLeadingBeforeFrontmatter: TabCommandContext['setters']['setInboxEditorYamlLeadingBeforeFrontmatter'];
  setInboxEditorResetNonce: TabCommandContext['setters']['setInboxEditorResetNonce'];
  clearLastPersistedSnapshot: () => void;
}): TabCommandContext {
  const {
    busy,
    editorWorkspaceTabsRef,
    activeEditorTabIdRef,
    selectedUriRef,
    composingNewEntryRef,
    activeTodayHubUriRef,
    flushInboxSaveRef,
    saveChainRef,
    vaultRootRef,
    notesRef,
    editorClosedTabsStackRef,
    editorShellScrollByUriRef,
    inboxYamlFrontmatterInnerRef,
    inboxEditorYamlLeadingBeforeFrontmatterRef,
    bumpEditorClosedStack,
    dispatchWorkspaceActionSync,
    replaceEditorWorkspaceTabs,
    mirrorShadowActiveTab,
    mirrorShadowHomeSurface,
    openMarkdownInEditor,
    selectHomeCurrentNote,
    clearInboxSelection,
    setActiveEditorTabId,
    setSelectedUri,
    setComposingNewEntry,
    setEditorBody,
    setInboxYamlFrontmatterInner,
    setInboxEditorYamlLeadingBeforeFrontmatter,
    setInboxEditorResetNonce,
    clearLastPersistedSnapshot,
  } = args;

  return useMemo(
    (): TabCommandContext => ({
      busy,
      refs: {
        editorWorkspaceTabsRef,
        activeEditorTabIdRef,
        selectedUriRef,
        composingNewEntryRef,
        activeTodayHubUriRef,
        flushInboxSaveRef,
        saveChainRef,
        vaultRootRef,
        notesRef,
        editorClosedTabsStackRef,
        editorShellScrollByUriRef,
        inboxYamlFrontmatterInnerRef,
        inboxEditorYamlLeadingBeforeFrontmatterRef,
      },
      callbacks: {
        bumpEditorClosedStack,
        dispatchWorkspaceActionSync,
        replaceEditorWorkspaceTabs,
        mirrorShadowActiveTab,
        mirrorShadowHomeSurface,
        openMarkdownInEditor,
        selectHomeCurrentNote,
        clearInboxSelection,
      },
      setters: {
        setActiveEditorTabId,
        setSelectedUri,
        setComposingNewEntry,
        setEditorBody,
        setInboxYamlFrontmatterInner,
        setInboxEditorYamlLeadingBeforeFrontmatter,
        setInboxEditorResetNonce,
        clearLastPersistedSnapshot,
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      busy,
      bumpEditorClosedStack,
      dispatchWorkspaceActionSync,
      replaceEditorWorkspaceTabs,
      mirrorShadowActiveTab,
      mirrorShadowHomeSurface,
      openMarkdownInEditor,
      selectHomeCurrentNote,
      clearInboxSelection,
      setActiveEditorTabId,
      setSelectedUri,
      setComposingNewEntry,
      setEditorBody,
      setInboxYamlFrontmatterInner,
      setInboxEditorYamlLeadingBeforeFrontmatter,
      setInboxEditorResetNonce,
      clearLastPersistedSnapshot,
    ],
  );
}

export function useComposeCommandsContext(args: {
  fs: VaultFilesystem;
  vaultRoot: string | null;
  subtreeMarkdownCache: SubtreeMarkdownPresenceCache;
  markVaultWriteSettled: () => void;
  refreshNotes: (root: string) => Promise<void>;
  flushInboxSaveRef: MutableRefObject<() => Promise<void>>;
  scheduleBacklinksDeferOneFrameAfterLoad: () => void;
  loadFullMarkdownIntoInboxEditor: (
    markdown: string,
    uri: string,
    selection: 'preserve' | 'start',
  ) => void;
  resetInboxEditorComposeState: () => void;
  todayHubCleanRowBlocked: (rowUri: string) => boolean;
  showTodayHubCanvasRef: MutableRefObject<boolean>;
  todayHubBridgeRef: MutableRefObject<TodayHubWorkspaceBridge>;
  inboxEditorRef: RefObject<NoteMarkdownEditorHandle | null>;
  selectedUriRef: MutableRefObject<string | null>;
  composingNewEntryRef: MutableRefObject<boolean>;
  inboxEditorShellScrollDirectiveRef: MutableRefObject<unknown>;
  diskConflictRef: MutableRefObject<unknown>;
  diskConflictSoftRef: MutableRefObject<unknown>;
  lastPersistedRef: MutableRefObject<unknown>;
  editorBodyRef: MutableRefObject<string>;
  inboxYamlFrontmatterInnerRef: MutableRefObject<string | null>;
  inboxEditorYamlLeadingBeforeFrontmatterRef: MutableRefObject<string>;
  inboxContentByUriRef: MutableRefObject<Record<string, string>>;
  setBusy: (busy: boolean) => void;
  setErr: (value: string | null) => void;
  setFsRefreshNonce: Dispatch<SetStateAction<number>>;
  setEditorBody: (body: string) => void;
  setComposeDraftMarkdown: (md: string) => void;
  setComposeDraftResetNonce: Dispatch<SetStateAction<number>>;
  setComposingNewEntry: (v: boolean) => void;
  setSelectedUri: (uri: string | null) => void;
  setDiskConflict: (v: unknown) => void;
  setDiskConflictSoft: (v: unknown) => void;
  setInboxContentByUri: Dispatch<SetStateAction<Record<string, string>>>;
  clearLastPersistedSnapshot: () => void;
  openMarkdownInEditor: (
    uri: string,
    options?: OpenMarkdownInEditorOptions,
  ) => Promise<void>;
}): ComposeCommandsContext {
  const a = args;
  return useMemo(
    (): ComposeCommandsContext => ({
      fs: a.fs,
      vaultRoot: a.vaultRoot,
      subtreeMarkdownCache: a.subtreeMarkdownCache,
      markVaultWriteSettled: a.markVaultWriteSettled,
      refreshNotes: a.refreshNotes,
      flushInboxSave: () => a.flushInboxSaveRef.current(),
      scheduleBacklinksDeferOneFrameAfterLoad: a.scheduleBacklinksDeferOneFrameAfterLoad,
      loadFullMarkdownIntoInboxEditor: a.loadFullMarkdownIntoInboxEditor,
      resetInboxEditorComposeState: a.resetInboxEditorComposeState,
      todayHubCleanRowBlocked: a.todayHubCleanRowBlocked,
      showTodayHubCanvasRef: a.showTodayHubCanvasRef,
      todayHubBridgeRef: a.todayHubBridgeRef,
      inboxEditorRef: a.inboxEditorRef,
      refs: {
        selectedUriRef: a.selectedUriRef,
        composingNewEntryRef: a.composingNewEntryRef,
        inboxEditorShellScrollDirectiveRef: a.inboxEditorShellScrollDirectiveRef,
        diskConflictRef: a.diskConflictRef,
        diskConflictSoftRef: a.diskConflictSoftRef,
        lastPersistedRef: a.lastPersistedRef,
        editorBodyRef: a.editorBodyRef,
        inboxYamlFrontmatterInnerRef: a.inboxYamlFrontmatterInnerRef,
        inboxEditorYamlLeadingBeforeFrontmatterRef:
          a.inboxEditorYamlLeadingBeforeFrontmatterRef,
        inboxContentByUriRef: a.inboxContentByUriRef,
      },
      setters: {
        setBusy: a.setBusy,
        setErr: a.setErr,
        setFsRefreshNonce: a.setFsRefreshNonce,
        setEditorBody: a.setEditorBody,
        setComposeDraftMarkdown: a.setComposeDraftMarkdown,
        setComposeDraftResetNonce: a.setComposeDraftResetNonce,
        setComposingNewEntry: a.setComposingNewEntry,
        setSelectedUri: a.setSelectedUri,
        setDiskConflict: a.setDiskConflict,
        setDiskConflictSoft: a.setDiskConflictSoft,
        setInboxContentByUri: a.setInboxContentByUri,
        clearLastPersistedSnapshot: a.clearLastPersistedSnapshot,
      },
      openMarkdownInEditor: a.openMarkdownInEditor,
    }),
    [
      a.fs,
      a.vaultRoot,
      a.subtreeMarkdownCache,
      a.markVaultWriteSettled,
      a.refreshNotes,
      a.flushInboxSaveRef,
      a.scheduleBacklinksDeferOneFrameAfterLoad,
      a.loadFullMarkdownIntoInboxEditor,
      a.resetInboxEditorComposeState,
      a.todayHubCleanRowBlocked,
      a.showTodayHubCanvasRef,
      a.todayHubBridgeRef,
      a.inboxEditorRef,
      a.selectedUriRef,
      a.composingNewEntryRef,
      a.inboxEditorShellScrollDirectiveRef,
      a.diskConflictRef,
      a.diskConflictSoftRef,
      a.lastPersistedRef,
      a.editorBodyRef,
      a.inboxYamlFrontmatterInnerRef,
      a.inboxEditorYamlLeadingBeforeFrontmatterRef,
      a.inboxContentByUriRef,
      a.setBusy,
      a.setErr,
      a.setFsRefreshNonce,
      a.setEditorBody,
      a.setComposeDraftMarkdown,
      a.setComposeDraftResetNonce,
      a.setComposingNewEntry,
      a.setSelectedUri,
      a.setDiskConflict,
      a.setDiskConflictSoft,
      a.setInboxContentByUri,
      a.clearLastPersistedSnapshot,
      a.openMarkdownInEditor,
    ],
  );
}

export function useTreeCommandContext(args: {
  vaultRoot: string | null;
  fs: VaultFilesystem;
  subtreeMarkdownCache: SubtreeMarkdownPresenceCache;
  autosaveSchedulerRef: MutableRefObject<{cancel: () => void}>;
  saveChainRef: MutableRefObject<Promise<void>>;
  editorWorkspaceTabsRef: MutableRefObject<EditorWorkspaceTab[]>;
  activeEditorTabIdRef: MutableRefObject<string | null>;
  selectedUriRef: MutableRefObject<string | null>;
  composingNewEntryRef: MutableRefObject<boolean>;
  editorShellScrollByUriRef: MutableRefObject<Map<string, {top: number; left: number}>>;
  inboxYamlFrontmatterInnerRef: MutableRefObject<string | null>;
  inboxEditorYamlLeadingBeforeFrontmatterRef: MutableRefObject<string>;
  lastPersistedRef: MutableRefObject<{uri: string; markdown: string} | null>;
  setEditorWorkspaceTabs: TreeCommandContext['setters']['setEditorWorkspaceTabs'];
  setActiveEditorTabId: TreeCommandContext['setters']['setActiveEditorTabId'];
  setInboxContentByUri: TreeCommandContext['setters']['setInboxContentByUri'];
  setBusy: TreeCommandContext['setters']['setBusy'];
  setErr: TreeCommandContext['setters']['setErr'];
  setFsRefreshNonce: TreeCommandContext['setters']['setFsRefreshNonce'];
  setSelectedUri: TreeCommandContext['setters']['setSelectedUri'];
  setComposingNewEntry: TreeCommandContext['setters']['setComposingNewEntry'];
  setEditorBody: TreeCommandContext['setters']['setEditorBody'];
  setInboxYamlFrontmatterInner: TreeCommandContext['setters']['setInboxYamlFrontmatterInner'];
  setInboxEditorYamlLeadingBeforeFrontmatter: TreeCommandContext['setters']['setInboxEditorYamlLeadingBeforeFrontmatter'];
  setInboxEditorResetNonce: TreeCommandContext['setters']['setInboxEditorResetNonce'];
  setLastPersistedSnapshot: TreeCommandContext['setters']['setLastPersistedSnapshot'];
  clearLastPersistedSnapshot: TreeCommandContext['setters']['clearLastPersistedSnapshot'];
  mirrorShadowHomeSurface: TreeCommandContext['mirrorShadowHomeSurface'];
  mirrorShadowActiveTab: TreeCommandContext['mirrorShadowActiveTab'];
  removeHomeHistoryUris: TreeCommandContext['removeHomeHistoryUris'];
  markVaultWriteSettled: TreeCommandContext['markVaultWriteSettled'];
  refreshNotes: TreeCommandContext['refreshNotes'];
  refocusAfterActiveTabRemoved: TreeCommandContext['refocusAfterActiveTabRemoved'];
  openMarkdownInEditor: TreeCommandContext['openMarkdownInEditor'];
  flushInboxSaveRef: MutableRefObject<() => Promise<void>>;
  clearRenameNotice: TreeCommandContext['clearRenameNotice'];
  replaceEditorWorkspaceTabs: TreeCommandContext['replaceEditorWorkspaceTabs'];
  remapHomeStatesPrefix: TreeCommandContext['remapHomeStatesPrefix'];
  clearInboxSelection: TreeCommandContext['clearInboxSelection'];
  setVaultTreeSelectionClearNonce: TreeCommandContext['setVaultTreeSelectionClearNonce'];
}): TreeCommandContext {
  const a = args;
  return useMemo(
    (): TreeCommandContext => ({
      vaultRoot: a.vaultRoot,
      fs: a.fs,
      subtreeMarkdownCache: a.subtreeMarkdownCache,
      refs: {
        autosaveSchedulerRef: a.autosaveSchedulerRef,
        saveChainRef: a.saveChainRef,
        editorWorkspaceTabsRef: a.editorWorkspaceTabsRef,
        activeEditorTabIdRef: a.activeEditorTabIdRef,
        selectedUriRef: a.selectedUriRef,
        composingNewEntryRef: a.composingNewEntryRef,
        editorShellScrollByUriRef: a.editorShellScrollByUriRef,
        inboxYamlFrontmatterInnerRef: a.inboxYamlFrontmatterInnerRef,
        inboxEditorYamlLeadingBeforeFrontmatterRef:
          a.inboxEditorYamlLeadingBeforeFrontmatterRef,
        lastPersistedRef: a.lastPersistedRef,
      },
      setters: {
        setEditorWorkspaceTabs: a.setEditorWorkspaceTabs,
        setActiveEditorTabId: a.setActiveEditorTabId,
        setInboxContentByUri: a.setInboxContentByUri,
        setBusy: a.setBusy,
        setErr: a.setErr,
        setFsRefreshNonce: a.setFsRefreshNonce,
        setSelectedUri: a.setSelectedUri,
        setComposingNewEntry: a.setComposingNewEntry,
        setEditorBody: a.setEditorBody,
        setInboxYamlFrontmatterInner: a.setInboxYamlFrontmatterInner,
        setInboxEditorYamlLeadingBeforeFrontmatter:
          a.setInboxEditorYamlLeadingBeforeFrontmatter,
        setInboxEditorResetNonce: a.setInboxEditorResetNonce,
        setLastPersistedSnapshot: a.setLastPersistedSnapshot,
        clearLastPersistedSnapshot: a.clearLastPersistedSnapshot,
      },
      mirrorShadowHomeSurface: a.mirrorShadowHomeSurface,
      mirrorShadowActiveTab: a.mirrorShadowActiveTab,
      removeHomeHistoryUris: a.removeHomeHistoryUris,
      markVaultWriteSettled: a.markVaultWriteSettled,
      refreshNotes: a.refreshNotes,
      refocusAfterActiveTabRemoved: a.refocusAfterActiveTabRemoved,
      openMarkdownInEditor: a.openMarkdownInEditor,
      flushInboxSaveRef: a.flushInboxSaveRef,
      clearRenameNotice: a.clearRenameNotice,
      replaceEditorWorkspaceTabs: a.replaceEditorWorkspaceTabs,
      remapHomeStatesPrefix: a.remapHomeStatesPrefix,
      clearInboxSelection: a.clearInboxSelection,
      setVaultTreeSelectionClearNonce: a.setVaultTreeSelectionClearNonce,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      a.vaultRoot,
      a.fs,
      a.subtreeMarkdownCache,
      a.setEditorWorkspaceTabs,
      a.setActiveEditorTabId,
      a.setInboxContentByUri,
      a.setBusy,
      a.setErr,
      a.setFsRefreshNonce,
      a.setSelectedUri,
      a.setComposingNewEntry,
      a.setEditorBody,
      a.setInboxYamlFrontmatterInner,
      a.setInboxEditorYamlLeadingBeforeFrontmatter,
      a.setInboxEditorResetNonce,
      a.setLastPersistedSnapshot,
      a.clearLastPersistedSnapshot,
      a.mirrorShadowHomeSurface,
      a.mirrorShadowActiveTab,
      a.removeHomeHistoryUris,
      a.markVaultWriteSettled,
      a.refreshNotes,
      a.refocusAfterActiveTabRemoved,
      a.openMarkdownInEditor,
      a.flushInboxSaveRef,
      a.clearRenameNotice,
      a.replaceEditorWorkspaceTabs,
      a.remapHomeStatesPrefix,
      a.clearInboxSelection,
      a.setVaultTreeSelectionClearNonce,
    ],
  );
}

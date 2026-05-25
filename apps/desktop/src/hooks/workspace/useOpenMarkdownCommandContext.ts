import {useMemo, type MutableRefObject, type RefObject} from 'react';

import type {VaultFilesystem} from '@eskerra/core';

import type {NoteMarkdownEditorHandle} from '../../editor/noteEditor/NoteMarkdownEditor';
import type {InboxAutosaveScheduler} from '../../lib/inboxAutosaveScheduler';
import type {EditorWorkspaceTab} from '../../lib/editorWorkspaceTabs';
import type {TodayHubWorkspaceBridge} from '../../lib/todayHub';
import type {WorkspaceModel} from '../../lib/workspaceModel';

import type {OpenMarkdownCommandContext} from '../workspaceOpenMarkdownCommand';
import type {LastPersisted} from '../workspaceFsWatchReconcile';
import type {InboxEditorShellScrollDirective} from '../workspaceEditorScrollMap';

export function useOpenMarkdownCommandContext(args: {
  fs: VaultFilesystem;
  openMarkdownGenerationRef: MutableRefObject<number>;
  clearMergeViewForOpenRef: MutableRefObject<() => void>;
  autosaveSchedulerRef: MutableRefObject<InboxAutosaveScheduler>;
  todayHubBridgeRef: MutableRefObject<TodayHubWorkspaceBridge>;
  diskConflictDeferTimerRef: MutableRefObject<number | null>;
  inboxEditorShellScrollRef: RefObject<HTMLDivElement | null>;
  selectedUriRef: MutableRefObject<string | null>;
  composingNewEntryRef: MutableRefObject<boolean>;
  editorShellScrollByUriRef: MutableRefObject<Map<string, {top: number; left: number}>>;
  inboxEditorShellScrollDirectiveRef: MutableRefObject<InboxEditorShellScrollDirective | null>;
  clearStaleDiskConflictsForOpen: (targetNorm: string) => void;
  vaultRootRef: MutableRefObject<string | null>;
  inboxContentByUriRef: MutableRefObject<Record<string, string>>;
  lastPersistedRef: MutableRefObject<LastPersisted | null>;
  setLastPersistedSnapshot: (next: LastPersisted) => void;
  eagerEditorLoadUriRef: MutableRefObject<string | null>;
  backlinksActiveBodyRef: MutableRefObject<string>;
  loadFullMarkdownIntoInboxEditor: OpenMarkdownCommandContext['loadFullMarkdownIntoInboxEditor'];
  scheduleBacklinksDeferOneFrameAfterLoad: () => void;
  setInboxContentByUri: OpenMarkdownCommandContext['setInboxContentByUri'];
  setBacklinksActiveBody: OpenMarkdownCommandContext['setBacklinksActiveBody'];
  setComposingNewEntry: OpenMarkdownCommandContext['setComposingNewEntry'];
  setSelectedUri: OpenMarkdownCommandContext['setSelectedUri'];
  inboxEditorRef: RefObject<NoteMarkdownEditorHandle | null>;
  editorBodyRef: MutableRefObject<string>;
  openTimeDiskBodyRef: MutableRefObject<string>;
  inboxYamlFrontmatterInnerRef: MutableRefObject<string | null>;
  inboxEditorYamlLeadingBeforeFrontmatterRef: MutableRefObject<string>;
  mergeInboxNoteBodyCacheRefAndState: (norm: string, body: string) => void;
  enqueuePersistOutgoingNoteMarkdown: (uri: string, markdown: string) => void;
  setErr: OpenMarkdownCommandContext['setErr'];
  dispatchWorkspaceActionSync: (
    reason: string,
    reduce: (model: WorkspaceModel) => WorkspaceModel,
  ) => WorkspaceModel;
  mirrorShadowActiveWorkspaceTabs: OpenMarkdownCommandContext['mirrorShadowActiveWorkspaceTabs'];
  mirrorShadowHomeSurface: OpenMarkdownCommandContext['mirrorShadowHomeSurface'];
  mirrorShadowActiveTab: OpenMarkdownCommandContext['mirrorShadowActiveTab'];
  editorWorkspaceTabsRef: MutableRefObject<EditorWorkspaceTab[]>;
  activeEditorTabIdRef: MutableRefObject<string | null>;
  activeTodayHubUriRef: MutableRefObject<string | null>;
  setEditorWorkspaceTabs: OpenMarkdownCommandContext['setEditorWorkspaceTabs'];
  setActiveEditorTabId: OpenMarkdownCommandContext['setActiveEditorTabId'];
  pushHomeHistoryForHub: OpenMarkdownCommandContext['pushHomeHistoryForHub'];
}): OpenMarkdownCommandContext {
  const {
    fs,
    openMarkdownGenerationRef,
    clearMergeViewForOpenRef,
    autosaveSchedulerRef,
    todayHubBridgeRef,
    diskConflictDeferTimerRef,
    inboxEditorShellScrollRef,
    selectedUriRef,
    composingNewEntryRef,
    editorShellScrollByUriRef,
    inboxEditorShellScrollDirectiveRef,
    clearStaleDiskConflictsForOpen,
    vaultRootRef,
    inboxContentByUriRef,
    lastPersistedRef,
    setLastPersistedSnapshot,
    eagerEditorLoadUriRef,
    backlinksActiveBodyRef,
    loadFullMarkdownIntoInboxEditor,
    scheduleBacklinksDeferOneFrameAfterLoad,
    setInboxContentByUri,
    setBacklinksActiveBody,
    setComposingNewEntry,
    setSelectedUri,
    inboxEditorRef,
    editorBodyRef,
    openTimeDiskBodyRef,
    inboxYamlFrontmatterInnerRef,
    inboxEditorYamlLeadingBeforeFrontmatterRef,
    mergeInboxNoteBodyCacheRefAndState,
    enqueuePersistOutgoingNoteMarkdown,
    setErr,
    dispatchWorkspaceActionSync,
    mirrorShadowActiveWorkspaceTabs,
    mirrorShadowHomeSurface,
    mirrorShadowActiveTab,
    editorWorkspaceTabsRef,
    activeEditorTabIdRef,
    activeTodayHubUriRef,
    setEditorWorkspaceTabs,
    setActiveEditorTabId,
    pushHomeHistoryForHub,
  } = args;

  return useMemo(
    () => ({
      fs,
      openMarkdownGenerationRef,
      clearMergeViewForOpenRef,
      autosaveSchedulerRef,
      todayHubBridgeRef,
      diskConflictDeferTimerRef,
      inboxEditorShellScrollRef,
      selectedUriRef,
      composingNewEntryRef,
      editorShellScrollByUriRef,
      inboxEditorShellScrollDirectiveRef,
      clearStaleDiskConflictsForOpen,
      vaultRootRef,
      inboxContentByUriRef,
      lastPersistedRef,
      setLastPersistedSnapshot,
      eagerEditorLoadUriRef,
      backlinksActiveBodyRef,
      loadFullMarkdownIntoInboxEditor,
      scheduleBacklinksDeferOneFrameAfterLoad,
      setInboxContentByUri,
      setBacklinksActiveBody,
      setComposingNewEntry,
      setSelectedUri,
      inboxEditorRef,
      editorBodyRef,
      openTimeDiskBodyRef,
      inboxYamlFrontmatterInnerRef,
      inboxEditorYamlLeadingBeforeFrontmatterRef,
      mergeInboxNoteBodyCacheRefAndState,
      enqueuePersistOutgoingNoteMarkdown,
      setErr,
      dispatchWorkspaceActionSync,
      mirrorShadowActiveWorkspaceTabs,
      mirrorShadowHomeSurface,
      mirrorShadowActiveTab,
      editorWorkspaceTabsRef,
      activeEditorTabIdRef,
      activeTodayHubUriRef,
      setEditorWorkspaceTabs,
      setActiveEditorTabId,
      pushHomeHistoryForHub,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stable refs omitted; deps mirror legacy open-markdown hook
    [
      fs,
      autosaveSchedulerRef,
      clearStaleDiskConflictsForOpen,
      loadFullMarkdownIntoInboxEditor,
      scheduleBacklinksDeferOneFrameAfterLoad,
      setBacklinksActiveBody,
      setErr,
      dispatchWorkspaceActionSync,
      mirrorShadowActiveWorkspaceTabs,
      mirrorShadowHomeSurface,
      mirrorShadowActiveTab,
      setEditorWorkspaceTabs,
      setActiveEditorTabId,
      pushHomeHistoryForHub,
      mergeInboxNoteBodyCacheRefAndState,
      enqueuePersistOutgoingNoteMarkdown,
      setComposingNewEntry,
      setSelectedUri,
      inboxEditorRef,
      setLastPersistedSnapshot,
      openTimeDiskBodyRef,
    ],
  );
}

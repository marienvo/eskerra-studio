import {useCallback, type Dispatch, type MutableRefObject, type RefObject, type SetStateAction} from 'react';

import {type SubtreeMarkdownPresenceCache, type VaultFilesystem, type VaultMarkdownRef} from '@eskerra/core';

import type {NoteMarkdownEditorHandle} from '../../editor/noteEditor/NoteMarkdownEditor';
import type {InboxAutosaveScheduler} from '../../lib/inboxAutosaveScheduler';
import {remapAllTabsUriPrefix, type EditorWorkspaceTab} from '../../lib/editorWorkspaceTabs';
import {loadVaultMarkdownBodiesWithSeed} from '../inboxNoteBodyCache';
import {persistableInboxEditorFullMarkdown} from '../openNotePersistence';
import {
  useWorkspaceRenameMaintenance,
  type WorkspaceRenameMaintenanceCommitArgs,
  type WorkspaceRenameMaintenanceSnapshot,
} from '../workspaceRenameMaintenance';
import {remapEditorShellScrollMapExact} from '../workspaceEditorScrollMap';

type UseWorkspaceRenameMaintenanceBindingInput = {
  vaultRoot: string | null;
  fs: VaultFilesystem;
  autosaveSchedulerRef: MutableRefObject<InboxAutosaveScheduler>;
  flushInboxSaveRef: MutableRefObject<() => Promise<void>>;
  refreshNotes: (root: string) => Promise<void>;
  subtreeMarkdownCache: SubtreeMarkdownPresenceCache;
  setBusy: Dispatch<SetStateAction<boolean>>;
  setErr: Dispatch<SetStateAction<string | null>>;
  setFsRefreshNonce: Dispatch<SetStateAction<number>>;
  vaultMarkdownRefsRef: MutableRefObject<VaultMarkdownRef[]>;
  selectedUriRef: MutableRefObject<string | null>;
  inboxEditorRef: RefObject<NoteMarkdownEditorHandle | null>;
  editorBodyRef: MutableRefObject<string>;
  composingNewEntryRef: MutableRefObject<boolean>;
  inboxYamlFrontmatterInnerRef: MutableRefObject<string | null>;
  inboxEditorYamlLeadingBeforeFrontmatterRef: MutableRefObject<string>;
  inboxContentByUriRef: MutableRefObject<Record<string, string>>;
  setInboxContentByUri: Dispatch<SetStateAction<Record<string, string>>>;
  lastPersistedRef: MutableRefObject<{uri: string; markdown: string} | null>;
  setLastPersistedSnapshot: (snapshot: {uri: string; markdown: string}) => void;
  setSelectedUri: (uri: string | null) => void;
  editorShellScrollByUriRef: MutableRefObject<Map<string, {top: number; left: number}>>;
  editorWorkspaceTabsRef: MutableRefObject<EditorWorkspaceTab[]>;
  replaceEditorWorkspaceTabs: (nextTabs: EditorWorkspaceTab[]) => void;
  remapHomeStatesPrefix: (oldPrefix: string, nextPrefix: string) => void;
};

export function useWorkspaceRenameMaintenanceBinding({
  vaultRoot,
  fs,
  autosaveSchedulerRef,
  flushInboxSaveRef,
  refreshNotes,
  subtreeMarkdownCache,
  setBusy,
  setErr,
  setFsRefreshNonce,
  vaultMarkdownRefsRef,
  selectedUriRef,
  inboxEditorRef,
  editorBodyRef,
  composingNewEntryRef,
  inboxYamlFrontmatterInnerRef,
  inboxEditorYamlLeadingBeforeFrontmatterRef,
  inboxContentByUriRef,
  setInboxContentByUri,
  lastPersistedRef,
  setLastPersistedSnapshot,
  setSelectedUri,
  editorShellScrollByUriRef,
  editorWorkspaceTabsRef,
  replaceEditorWorkspaceTabs,
  remapHomeStatesPrefix,
}: UseWorkspaceRenameMaintenanceBindingInput) {
  const getRenameMaintenanceSnapshot =
    useCallback(async (): Promise<WorkspaceRenameMaintenanceSnapshot> => {
      const wikiRefs = vaultMarkdownRefsRef.current.map(r => ({name: r.name, uri: r.uri}));
      const activeUri = selectedUriRef.current;
      const activeBody =
        activeUri != null
          ? persistableInboxEditorFullMarkdown({
              editorBodySlice:
                inboxEditorRef.current?.getMarkdown() ?? editorBodyRef.current,
              selectedUri: activeUri,
              composingNewEntry: composingNewEntryRef.current,
              yamlInner: inboxYamlFrontmatterInnerRef.current,
              yamlLeading: inboxEditorYamlLeadingBeforeFrontmatterRef.current,
              persistedFullMarkdown:
                lastPersistedRef.current?.uri === activeUri
                  ? lastPersistedRef.current.markdown
                  : null,
            })
          : '';
      const expandedContent = await loadVaultMarkdownBodiesWithSeed(
        fs,
        wikiRefs,
        inboxContentByUriRef.current,
        activeUri,
        activeBody,
      );
      return {wikiRefs, activeUri, activeBody, expandedContent};
    }, [
      fs,
      vaultMarkdownRefsRef,
      selectedUriRef,
      inboxEditorRef,
      editorBodyRef,
      composingNewEntryRef,
      inboxYamlFrontmatterInnerRef,
      inboxEditorYamlLeadingBeforeFrontmatterRef,
      inboxContentByUriRef,
    ]);

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
          setLastPersistedSnapshot({uri: nextUri, markdown: previousPersisted.markdown});
        }
      }
      if (nextUri !== oldUri) {
        remapEditorShellScrollMapExact(editorShellScrollByUriRef.current, oldUri, nextUri);
        const remappedRenameTabs = remapAllTabsUriPrefix(
          editorWorkspaceTabsRef.current,
          oldUri,
          nextUri,
        );
        replaceEditorWorkspaceTabs(remappedRenameTabs);
        remapHomeStatesPrefix(oldUri, nextUri);
      }
    },
    [
      setInboxContentByUri,
      selectedUriRef,
      setSelectedUri,
      lastPersistedRef,
      setLastPersistedSnapshot,
      editorShellScrollByUriRef,
      editorWorkspaceTabsRef,
      replaceEditorWorkspaceTabs,
      remapHomeStatesPrefix,
    ],
  );

  return useWorkspaceRenameMaintenance({
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
}

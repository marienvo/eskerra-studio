import type {Dispatch, MutableRefObject, RefObject, SetStateAction} from 'react';

import type {VaultFilesystem} from '@eskerra/core';

import type {NoteMarkdownEditorHandle} from '../../editor/noteEditor/NoteMarkdownEditor';
import type {TodayHubWorkspaceBridge} from '../../lib/todayHub';

import type {DiskConflictState, LastPersisted} from '../workspaceFsWatchReconcile';

import type {LiveInboxMarkdownRefs} from './readLiveInboxFullMarkdown';

export type WorkspacePersistenceRefs = LiveInboxMarkdownRefs & {
  vaultRootRef: MutableRefObject<string | null>;
  selectedUriRef: MutableRefObject<string | null>;
  composingNewEntryRef: MutableRefObject<boolean>;
  diskConflictRef: MutableRefObject<DiskConflictState | null>;
  inboxContentByUriRef: MutableRefObject<Record<string, string>>;
  lastPersistedRef: MutableRefObject<LastPersisted | null>;
  todayHubBridgeRef: MutableRefObject<TodayHubWorkspaceBridge>;
  submitNewEntryRef: MutableRefObject<() => Promise<unknown>>;
};

export type WorkspacePersistenceActions = {
  setErr: (value: string | null) => void;
  setInboxContentByUri: Dispatch<SetStateAction<Record<string, string>>>;
  setLastPersistedSnapshot: (next: LastPersisted) => void;
  refreshNotes: (root: string) => Promise<void>;
  onVaultWriteSettled: () => void;
  loadFullMarkdownIntoInboxEditor: (
    markdown: string,
    uri: string,
    selection: 'preserve' | 'start',
  ) => void;
  scheduleBacklinksDeferOneFrameAfterLoad: () => void;
};

export type WorkspacePersistenceState = {
  vaultRoot: string | null;
  selectedUri: string | null;
  composingNewEntry: boolean;
  editorBody: string;
  inboxYamlFrontmatterInner: string | null;
  diskConflict: DiskConflictState | null;
};

export type WorkspacePersistenceDeps = {
  fs: VaultFilesystem;
  refs: WorkspacePersistenceRefs;
  actions: WorkspacePersistenceActions;
  state: WorkspacePersistenceState;
};

/** Flat args for {@link useWorkspacePersistence} (orchestrator builds deps internally). */
export type UseWorkspacePersistenceArgs = WorkspacePersistenceState & {
  fs: VaultFilesystem;
  vaultRootRef: WorkspacePersistenceRefs['vaultRootRef'];
  selectedUriRef: WorkspacePersistenceRefs['selectedUriRef'];
  composingNewEntryRef: WorkspacePersistenceRefs['composingNewEntryRef'];
  diskConflictRef: WorkspacePersistenceRefs['diskConflictRef'];
  inboxContentByUriRef: WorkspacePersistenceRefs['inboxContentByUriRef'];
  editorBodyRef: WorkspacePersistenceRefs['editorBodyRef'];
  openTimeDiskBodyRef: WorkspacePersistenceRefs['openTimeDiskBodyRef'];
  lastPersistedRef: WorkspacePersistenceRefs['lastPersistedRef'];
  inboxYamlFrontmatterInnerRef: WorkspacePersistenceRefs['inboxYamlFrontmatterInnerRef'];
  inboxEditorYamlLeadingBeforeFrontmatterRef: WorkspacePersistenceRefs['inboxEditorYamlLeadingBeforeFrontmatterRef'];
  inboxEditorRef: RefObject<NoteMarkdownEditorHandle | null>;
  todayHubBridgeRef: WorkspacePersistenceRefs['todayHubBridgeRef'];
  submitNewEntryRef: WorkspacePersistenceRefs['submitNewEntryRef'];
  setErr: WorkspacePersistenceActions['setErr'];
  setInboxContentByUri: WorkspacePersistenceActions['setInboxContentByUri'];
  setLastPersistedSnapshot: WorkspacePersistenceActions['setLastPersistedSnapshot'];
  refreshNotes: WorkspacePersistenceActions['refreshNotes'];
  onVaultWriteSettled: WorkspacePersistenceActions['onVaultWriteSettled'];
  loadFullMarkdownIntoInboxEditor: WorkspacePersistenceActions['loadFullMarkdownIntoInboxEditor'];
  scheduleBacklinksDeferOneFrameAfterLoad: WorkspacePersistenceActions['scheduleBacklinksDeferOneFrameAfterLoad'];
};

export function toWorkspacePersistenceDeps(
  args: UseWorkspacePersistenceArgs,
): WorkspacePersistenceDeps {
  return {
    fs: args.fs,
    refs: {
      vaultRootRef: args.vaultRootRef,
      selectedUriRef: args.selectedUriRef,
      composingNewEntryRef: args.composingNewEntryRef,
      diskConflictRef: args.diskConflictRef,
      inboxContentByUriRef: args.inboxContentByUriRef,
      editorBodyRef: args.editorBodyRef,
      openTimeDiskBodyRef: args.openTimeDiskBodyRef,
      lastPersistedRef: args.lastPersistedRef,
      inboxYamlFrontmatterInnerRef: args.inboxYamlFrontmatterInnerRef,
      inboxEditorYamlLeadingBeforeFrontmatterRef:
        args.inboxEditorYamlLeadingBeforeFrontmatterRef,
      inboxEditorRef: args.inboxEditorRef,
      todayHubBridgeRef: args.todayHubBridgeRef,
      submitNewEntryRef: args.submitNewEntryRef,
    },
    actions: {
      setErr: args.setErr,
      setInboxContentByUri: args.setInboxContentByUri,
      setLastPersistedSnapshot: args.setLastPersistedSnapshot,
      refreshNotes: args.refreshNotes,
      onVaultWriteSettled: args.onVaultWriteSettled,
      loadFullMarkdownIntoInboxEditor: args.loadFullMarkdownIntoInboxEditor,
      scheduleBacklinksDeferOneFrameAfterLoad: args.scheduleBacklinksDeferOneFrameAfterLoad,
    },
    state: {
      vaultRoot: args.vaultRoot,
      selectedUri: args.selectedUri,
      composingNewEntry: args.composingNewEntry,
      editorBody: args.editorBody,
      inboxYamlFrontmatterInner: args.inboxYamlFrontmatterInner,
      diskConflict: args.diskConflict,
    },
  };
}

import {
  reconcileOpenNotesAfterFsChangeFromVaultWatch,
  type ReconcileFsOpenMarkdownEnv,
  type ReconcileFsTodayHubEnv,
} from '../workspaceFsWatchReconcile';

import type {VaultWatchDeps} from './vaultWatchTypes';

export function buildVaultWatchReconcileEnvs(
  deps: VaultWatchDeps,
  cancelled: () => boolean,
): {open: ReconcileFsOpenMarkdownEnv; today: ReconcileFsTodayHubEnv} {
  const {fs, refs, actions, callbacks} = deps;
  return {
    open: {
      cancelled,
      fs,
      vaultRootRef: refs.vaultRootRef,
      editorWorkspaceTabsRef: refs.editorWorkspaceTabsRef,
      selectedUriRef: refs.selectedUriRef,
      activeEditorTabIdRef: refs.activeEditorTabIdRef,
      composingNewEntryRef: refs.composingNewEntryRef,
      diskConflictRef: refs.diskConflictRef,
      diskConflictSoftRef: refs.diskConflictSoftRef,
      inboxContentByUriRef: refs.inboxContentByUriRef,
      lastPersistedRef: refs.lastPersistedRef,
      writeLastPersistedSnapshotWithoutSeqBump:
        actions.writeLastPersistedSnapshotWithoutSeqBump,
      bumpLastPersistedExternalMutationSeq: actions.bumpLastPersistedExternalMutationSeq,
      editorBodyRef: refs.editorBodyRef,
      openTimeDiskBodyRef: refs.openTimeDiskBodyRef,
      inboxYamlFrontmatterInnerRef: refs.inboxYamlFrontmatterInnerRef,
      inboxEditorYamlLeadingBeforeFrontmatterRef:
        refs.inboxEditorYamlLeadingBeforeFrontmatterRef,
      editorShellScrollByUriRef: refs.editorShellScrollByUriRef,
      skipRecencyDeferForUriRef: refs.skipRecencyDeferForUriRef,
      diskConflictDeferTimerRef: refs.diskConflictDeferTimerRef,
      lastInboxEditorActivityAtRef: refs.lastInboxEditorActivityAtRef,
      inboxEditorRef: refs.inboxEditorRef,
      autosaveSchedulerRef: refs.autosaveSchedulerRef,
      setEditorWorkspaceTabs: actions.setEditorWorkspaceTabs,
      setActiveEditorTabId: actions.setActiveEditorTabId,
      setDiskConflict: actions.setDiskConflict,
      setDiskConflictSoft: actions.setDiskConflictSoft,
      setInboxContentByUri: actions.setInboxContentByUri,
      setSelectedUri: actions.setSelectedUri,
      setComposingNewEntry: actions.setComposingNewEntry,
      setEditorBody: actions.setEditorBody,
      setInboxEditorResetNonce: actions.setInboxEditorResetNonce,
      setInboxYamlFrontmatterInner: actions.setInboxYamlFrontmatterInner,
      setInboxEditorYamlLeadingBeforeFrontmatter:
        actions.setInboxEditorYamlLeadingBeforeFrontmatter,
      openMarkdownInEditor: callbacks.openMarkdownInEditor,
      loadFullMarkdownIntoInboxEditor: callbacks.loadFullMarkdownIntoInboxEditor,
      scheduleBacklinksDeferOneFrameAfterLoad:
        callbacks.scheduleBacklinksDeferOneFrameAfterLoad,
      syncWorkspaceModelRemoveOpenTabUri: actions.syncWorkspaceModelRemoveOpenTabUri,
    },
    today: {
      todayHubRowLastPersistedRef: refs.todayHubRowLastPersistedRef,
      todayHubSettingsRef: refs.todayHubSettingsRef,
      todayHubBridgeRef: refs.todayHubBridgeRef,
    },
  };
}

export {reconcileOpenNotesAfterFsChangeFromVaultWatch};

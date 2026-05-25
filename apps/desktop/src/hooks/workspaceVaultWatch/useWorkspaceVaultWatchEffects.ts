import {listen} from '@tauri-apps/api/event';
import {useEffect} from 'react';

import type {VaultFilesChangedPayload} from '../../lib/vaultFilesChangedPayload';

import {
  createVaultWatchSession,
  disposeVaultWatchSession,
} from './vaultWatchSession';
import {
  toVaultWatchDeps,
  type UseWorkspaceVaultWatchEffectsArgs,
} from './vaultWatchTypes';

export function useWorkspaceVaultWatchEffects(
  args: UseWorkspaceVaultWatchEffectsArgs,
): void {
  const {vaultRoot} = args;

  useEffect(() => {
    if (!vaultRoot) {
      return;
    }
    const deps = toVaultWatchDeps(args);
    let cancelled = false;
    const session = createVaultWatchSession(vaultRoot, deps, () => cancelled);
    let unlisten: (() => void) | undefined;

    listen<VaultFilesChangedPayload>('vault-files-changed', event => {
      session.handleVaultFilesChanged(event.payload);
    })
      .then(fn => {
        if (cancelled) {
          fn();
        } else {
          unlisten = fn;
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      disposeVaultWatchSession(session, deps.refs.diskConflictDeferTimerRef);
      unlisten?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- flat deps mirror pre-split hook; `args` object is unstable
  }, [
    vaultRoot,
    args.refreshNotes,
    args.fs,
    args.inboxEditorRef,
    args.openMarkdownInEditor,
    args.loadFullMarkdownIntoInboxEditor,
    args.scheduleBacklinksDeferOneFrameAfterLoad,
    args.clearBacklinkDiskBodyCache,
    args.subtreeMarkdownCache,
    args.vaultRootRef,
    args.editorWorkspaceTabsRef,
    args.selectedUriRef,
    args.activeEditorTabIdRef,
    args.composingNewEntryRef,
    args.diskConflictRef,
    args.diskConflictSoftRef,
    args.inboxContentByUriRef,
    args.lastPersistedRef,
    args.lastPersistedExternalMutationSeqRef,
    args.writeLastPersistedSnapshotWithoutSeqBump,
    args.bumpLastPersistedExternalMutationSeq,
    args.editorBodyRef,
    args.openTimeDiskBodyRef,
    args.inboxYamlFrontmatterInnerRef,
    args.inboxEditorYamlLeadingBeforeFrontmatterRef,
    args.editorShellScrollByUriRef,
    args.skipRecencyDeferForUriRef,
    args.diskConflictDeferTimerRef,
    args.lastInboxEditorActivityAtRef,
    args.autosaveSchedulerRef,
    args.todayHubRowLastPersistedRef,
    args.todayHubSettingsRef,
    args.todayHubBridgeRef,
    args.setEditorWorkspaceTabs,
    args.setActiveEditorTabId,
    args.setDiskConflict,
    args.setDiskConflictSoft,
    args.setInboxContentByUri,
    args.setSelectedUri,
    args.setComposingNewEntry,
    args.setEditorBody,
    args.setInboxEditorResetNonce,
    args.setInboxYamlFrontmatterInner,
    args.setInboxEditorYamlLeadingBeforeFrontmatter,
    args.setFsRefreshNonce,
    args.setPodcastFsNonce,
    args.setVaultSettings,
    args.syncWorkspaceModelRemoveOpenTabUri,
  ]);
}

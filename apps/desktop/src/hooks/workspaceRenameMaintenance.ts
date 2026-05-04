import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';

import {
  sanitizeInboxNoteStem,
  stemFromMarkdownFileName,
  type VaultFilesystem,
} from '@eskerra/core';

import {
  renameVaultMarkdownNote,
} from '../lib/vaultBootstrap';
import {
  applyVaultWikiLinkRenameMaintenance,
  planVaultWikiLinkRenameMaintenance,
  type VaultWikiLinkRenameApplyResult,
  type VaultWikiLinkRenamePlanResult,
} from '../lib/vaultWikiLinkRenameMaintenance';
import type {SubtreeMarkdownPresenceCache} from '@eskerra/core';

import type {
  WorkspacePendingWikiLinkAmbiguityRename,
  WorkspaceRenameLinkProgress,
} from './workspaceReturnShape';
import type {InboxAutosaveScheduler} from '../lib/inboxAutosaveScheduler';

const LARGE_RENAME_MIN_TOUCHED_FILES = 60;
const LARGE_RENAME_MIN_TOUCHED_BYTES = 768 * 1024;
const RENAME_APPLY_YIELD_EVERY_WRITES = 24;
const RENAME_NOTICE_TTL_MS = 5000;

export type WorkspaceRenameMaintenanceSnapshot = {
  wikiRefs: ReadonlyArray<{name: string; uri: string}>;
  activeUri: string | null;
  activeBody: string;
  expandedContent: Readonly<Record<string, string>>;
};

export type WorkspaceRenameMaintenanceCommitArgs = {
  oldUri: string;
  nextUri: string;
  rewritePlan: VaultWikiLinkRenamePlanResult;
  applyResult: VaultWikiLinkRenameApplyResult;
};

export function createEmptyVaultWikiLinkRenamePlan(
  scannedFileCount: number,
): VaultWikiLinkRenamePlanResult {
  return {
    updates: [],
    scannedFileCount,
    touchedFileCount: 0,
    touchedBytes: 0,
    updatedLinkCount: 0,
    skippedAmbiguousLinkCount: 0,
  };
}

export function shouldShowRenameLinkProgress(
  rewritePlan: Pick<
    VaultWikiLinkRenamePlanResult,
    'skippedAmbiguousLinkCount' | 'touchedFileCount' | 'touchedBytes'
  >,
): boolean {
  return (
    rewritePlan.skippedAmbiguousLinkCount === 0
    && rewritePlan.touchedFileCount > 0
    && (rewritePlan.touchedFileCount >= LARGE_RENAME_MIN_TOUCHED_FILES
      || rewritePlan.touchedBytes >= LARGE_RENAME_MIN_TOUCHED_BYTES)
  );
}

export function buildPendingWikiLinkAmbiguityRename(args: {
  uri: string;
  nextDisplayName: string;
  plan: VaultWikiLinkRenamePlanResult;
}): WorkspacePendingWikiLinkAmbiguityRename {
  const {uri, nextDisplayName, plan} = args;
  return {
    uri,
    nextDisplayName,
    summary: {
      scannedFileCount: plan.scannedFileCount,
      touchedFileCount: plan.touchedFileCount,
      touchedBytes: plan.touchedBytes,
      updatedLinkCount: plan.updatedLinkCount,
      skippedAmbiguousLinkCount: plan.skippedAmbiguousLinkCount,
    },
  };
}

export function useWorkspaceRenameMaintenance(args: {
  vaultRoot: string | null;
  fs: VaultFilesystem;
  autosaveSchedulerRef: MutableRefObject<InboxAutosaveScheduler>;
  flushInboxSaveRef: MutableRefObject<() => Promise<void>>;
  getSnapshot: () => Promise<WorkspaceRenameMaintenanceSnapshot>;
  commitRenameResult: (args: WorkspaceRenameMaintenanceCommitArgs) => void;
  refreshNotes: (root: string) => Promise<void>;
  subtreeMarkdownCache: SubtreeMarkdownPresenceCache;
  setBusy: Dispatch<SetStateAction<boolean>>;
  setErr: Dispatch<SetStateAction<string | null>>;
  setFsRefreshNonce: Dispatch<SetStateAction<number>>;
}): {
  wikiRenameNotice: string | null;
  renameLinkProgress: WorkspaceRenameLinkProgress | null;
  pendingWikiLinkAmbiguityRename: WorkspacePendingWikiLinkAmbiguityRename | null;
  renameNote: (uri: string, nextDisplayName: string) => Promise<void>;
  confirmPendingWikiLinkAmbiguityRename: () => Promise<void>;
  cancelPendingWikiLinkAmbiguityRename: () => void;
  clearRenameNotice: () => void;
  resetRenameMaintenanceState: () => void;
} {
  const {
    vaultRoot,
    fs,
    autosaveSchedulerRef,
    flushInboxSaveRef,
    getSnapshot,
    commitRenameResult,
    refreshNotes,
    subtreeMarkdownCache,
    setBusy,
    setErr,
    setFsRefreshNonce,
  } = args;
  const [wikiRenameNotice, setWikiRenameNotice] = useState<string | null>(null);
  const [renameLinkProgress, setRenameLinkProgress] =
    useState<WorkspaceRenameLinkProgress | null>(null);
  const [pendingWikiLinkAmbiguityRename, setPendingWikiLinkAmbiguityRename] =
    useState<WorkspacePendingWikiLinkAmbiguityRename | null>(null);
  const renameNoticeTimeoutRef = useRef<number | null>(null);

  const clearRenameNotice = useCallback(() => {
    if (renameNoticeTimeoutRef.current != null) {
      window.clearTimeout(renameNoticeTimeoutRef.current);
      renameNoticeTimeoutRef.current = null;
    }
    setWikiRenameNotice(null);
  }, []);

  const resetRenameMaintenanceState = useCallback(() => {
    clearRenameNotice();
    setRenameLinkProgress(null);
    setPendingWikiLinkAmbiguityRename(null);
  }, [clearRenameNotice]);

  const setTransientRenameNotice = useCallback(
    (message: string) => {
      clearRenameNotice();
      setWikiRenameNotice(message);
      renameNoticeTimeoutRef.current = window.setTimeout(() => {
        setWikiRenameNotice(null);
        renameNoticeTimeoutRef.current = null;
      }, RENAME_NOTICE_TTL_MS);
    },
    [clearRenameNotice],
  );

  useEffect(() => {
    return () => {
      if (renameNoticeTimeoutRef.current != null) {
        window.clearTimeout(renameNoticeTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    queueMicrotask(resetRenameMaintenanceState);
  }, [vaultRoot, resetRenameMaintenanceState]);

  const applyRenameWithProgress = useCallback(
    async (
      rewritePlan: VaultWikiLinkRenamePlanResult,
      oldUri: string,
      newUri: string,
    ) => {
      const showLargeImpactProgress = shouldShowRenameLinkProgress(rewritePlan);
      if (showLargeImpactProgress) {
        setRenameLinkProgress({done: 0, total: rewritePlan.touchedFileCount});
      }
      return applyVaultWikiLinkRenameMaintenance({
        fs,
        oldUri,
        newUri,
        updates: rewritePlan.updates,
        onProgress: showLargeImpactProgress
          ? (done, total) => {
              setRenameLinkProgress({done, total});
            }
          : undefined,
        yieldEveryWrites: showLargeImpactProgress ? RENAME_APPLY_YIELD_EVERY_WRITES : 0,
      });
    },
    [fs],
  );

  const runRenameWithWikiLinkMaintenance = useCallback(
    async (options: {
      uri: string;
      nextDisplayName: string;
      forceApplyDespiteAmbiguity: boolean;
    }) => {
      if (!vaultRoot) {
        return;
      }
      const {uri, nextDisplayName, forceApplyDespiteAmbiguity} = options;
      autosaveSchedulerRef.current.cancel();
      await flushInboxSaveRef.current();

      setBusy(true);
      setErr(null);
      clearRenameNotice();
      setRenameLinkProgress(null);

      try {
        const {
          wikiRefs,
          activeUri,
          activeBody,
          expandedContent,
        } = await getSnapshot();

        const planRename = (
          renamedStem: string | null,
          newTargetUri: string,
        ): VaultWikiLinkRenamePlanResult =>
          renamedStem
            ? planVaultWikiLinkRenameMaintenance({
                vaultRoot,
                oldTargetUri: uri,
                renamedStem,
                newTargetUri,
                notes: wikiRefs,
                contentByUri: expandedContent,
                activeUri,
                activeBody,
              })
            : createEmptyVaultWikiLinkRenamePlan(wikiRefs.length);

        const planStartedAt = performance.now();
        const plannedStem = sanitizeInboxNoteStem(nextDisplayName);
        const preRenamePlan = planRename(plannedStem, uri);
        const planDurationMs = performance.now() - planStartedAt;
        if (preRenamePlan.skippedAmbiguousLinkCount > 0 && !forceApplyDespiteAmbiguity) {
          setPendingWikiLinkAmbiguityRename(
            buildPendingWikiLinkAmbiguityRename({
              uri,
              nextDisplayName,
              plan: preRenamePlan,
            }),
          );
          return;
        }
        setPendingWikiLinkAmbiguityRename(null);

        const nextUri = await renameVaultMarkdownNote(vaultRoot, uri, nextDisplayName, fs);
        const nextName = nextUri.split('/').pop();
        const renamedStem = nextName ? stemFromMarkdownFileName(nextName) : plannedStem;
        const rewritePlan = planRename(renamedStem, nextUri);
        const applyResult = await applyRenameWithProgress(rewritePlan, uri, nextUri);
        console.info('[WL-5] rename-maintenance', {
          oldUri: uri,
          newUri: nextUri,
          scannedFiles: rewritePlan.scannedFileCount,
          touchedFiles: rewritePlan.touchedFileCount,
          touchedBytes: rewritePlan.touchedBytes,
          updatedLinks: rewritePlan.updatedLinkCount,
          skippedAmbiguous: rewritePlan.skippedAmbiguousLinkCount,
          failedWrites: applyResult.failed.length,
          planDurationMs: Math.round(planDurationMs),
        });
        commitRenameResult({oldUri: uri, nextUri, rewritePlan, applyResult});
        if (applyResult.failed.length > 0) {
          const list = applyResult.failed.map(f => f.uri).join(', ');
          setErr(
            `Renamed note, but link updates failed for ${applyResult.failed.length} file(s): ${list}`,
          );
        } else if (rewritePlan.updatedLinkCount > 0) {
          const noteLabel = rewritePlan.touchedFileCount === 1 ? 'note' : 'notes';
          setTransientRenameNotice(
            `Updated links in ${rewritePlan.touchedFileCount} ${noteLabel}.`,
          );
        }
        subtreeMarkdownCache.invalidateForMutation(vaultRoot, uri, 'file');
        if (nextUri !== uri) {
          subtreeMarkdownCache.invalidateForMutation(vaultRoot, nextUri, 'file');
        }
        await refreshNotes(vaultRoot);
        setFsRefreshNonce(n => n + 1);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setRenameLinkProgress(null);
        setBusy(false);
      }
    },
    [
      vaultRoot,
      fs,
      autosaveSchedulerRef,
      flushInboxSaveRef,
      getSnapshot,
      commitRenameResult,
      refreshNotes,
      clearRenameNotice,
      setTransientRenameNotice,
      subtreeMarkdownCache,
      setBusy,
      setErr,
      setFsRefreshNonce,
      applyRenameWithProgress,
    ],
  );

  const renameNote = useCallback(
    async (uri: string, nextDisplayName: string) => {
      await runRenameWithWikiLinkMaintenance({
        uri,
        nextDisplayName,
        forceApplyDespiteAmbiguity: false,
      });
    },
    [runRenameWithWikiLinkMaintenance],
  );

  const confirmPendingWikiLinkAmbiguityRename = useCallback(async () => {
    const pending = pendingWikiLinkAmbiguityRename;
    if (!pending) {
      return;
    }
    await runRenameWithWikiLinkMaintenance({
      uri: pending.uri,
      nextDisplayName: pending.nextDisplayName,
      forceApplyDespiteAmbiguity: true,
    });
  }, [pendingWikiLinkAmbiguityRename, runRenameWithWikiLinkMaintenance]);

  const cancelPendingWikiLinkAmbiguityRename = useCallback(() => {
    setPendingWikiLinkAmbiguityRename(null);
  }, []);

  return {
    wikiRenameNotice,
    renameLinkProgress,
    pendingWikiLinkAmbiguityRename,
    renameNote,
    confirmPendingWikiLinkAmbiguityRename,
    cancelPendingWikiLinkAmbiguityRename,
    clearRenameNotice,
    resetRenameMaintenanceState,
  };
}

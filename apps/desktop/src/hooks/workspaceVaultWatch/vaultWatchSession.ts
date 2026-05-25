import {captureObservabilityMessage} from '../../observability/captureObservabilityMessage';
import {isPodcastRelevantVaultPath} from '../workspacePodcastFsRelevance';
import {
  vaultFrontmatterIndexSchedule,
  vaultFrontmatterIndexTouchPaths,
} from '../../lib/tauriVaultFrontmatter';
import {vaultSearchIndexSchedule, vaultSearchIndexTouchPaths} from '../../lib/tauriVaultSearch';
import {readVaultSettings} from '../../lib/vaultBootstrap';
import type {VaultFilesChangedPayload} from '../../lib/vaultFilesChangedPayload';
import {planVaultFilesChangedEvent} from '../../lib/vaultFilesChangedEventPlan';
import {
  fingerprintUtf16ForDebug,
  type ReconcileFsOpenMarkdownEnv,
  type ReconcileFsTodayHubEnv,
} from '../workspaceFsWatchReconcile';

import {
  buildVaultWatchReconcileEnvs,
  reconcileOpenNotesAfterFsChangeFromVaultWatch,
} from './buildVaultWatchReconcileEnv';
import {
  vaultChangedPathsSignature,
  vaultWatchBackendFromReason,
} from './vaultWatchObservability';
import type {VaultWatchDeps} from './vaultWatchTypes';

const VAULT_INDEX_TOUCH_DEDUP_MS = 1000;
export const VAULT_OPEN_TAB_PROBE_INTERVAL_MS = 10000;
const VAULT_OPEN_TAB_PROBE_MIN_GAP_MS = 2500;
const VAULT_COARSE_REFRESH_DEDUP_MS = 30000;

export type VaultWatchSession = {
  watchSessionId: string;
  vaultRootHash: string;
  vaultRoot: string;
  deps: VaultWatchDeps;
  cancelled: () => boolean;
  reconcileFsOpenEnv: ReconcileFsOpenMarkdownEnv;
  reconcileFsTodayEnv: ReconcileFsTodayHubEnv;
  enqueueVaultFsReconcileJob: (label: string, job: () => Promise<void>) => Promise<void>;
  runOpenTabProbe: (trigger: 'focus' | 'interval') => void;
  handleVaultFilesChanged: (payload: VaultFilesChangedPayload | undefined) => void;
  disposeProbeListeners: () => void;
};

export function createVaultWatchSession(
  vaultRoot: string,
  deps: VaultWatchDeps,
  isCancelled: () => boolean,
): VaultWatchSession {
  const watchSessionId = crypto.randomUUID();
  const vaultRootHash = fingerprintUtf16ForDebug(vaultRoot);
  let coarseFullReindexScheduled = false;
  let lastIncrementalIndexTouch:
    | {signature: string; touchedAtMs: number}
    | null = null;
  let lastOpenTabProbeAtMs = 0;
  let lastCoarseRefreshAtMs = 0;
  let vaultFilesChangedEventSeq = 0;
  const bumpProbeNoop = () => undefined;

  const {open: reconcileFsOpenEnv, today: reconcileFsTodayEnv} =
    buildVaultWatchReconcileEnvs(deps, isCancelled);

  let vaultFsReconcileQueue: Promise<void> = Promise.resolve();
  const enqueueVaultFsReconcileJob = (
    label: string,
    job: () => Promise<void>,
  ): Promise<void> => {
    const run = async () => {
      if (isCancelled()) {
        return;
      }
      try {
        await job();
      } catch (e) {
        console.warn(`[vault-files-changed] reconcile failed: ${label}`, e);
      }
    };
    const queued = vaultFsReconcileQueue.then(run, run);
    vaultFsReconcileQueue = queued.catch(() => undefined);
    return queued;
  };

  const rerunFsReconcileForTab = (normTab: string) => {
    enqueueVaultFsReconcileJob(
      'deferred-tab',
      () =>
        reconcileOpenNotesAfterFsChangeFromVaultWatch(
          reconcileFsOpenEnv,
          reconcileFsTodayEnv,
          [normTab],
          rerunFsReconcileForTab,
        ),
    );
  };

  const reconcileOpenNotesAfterFsChange = (rawPaths: string[]) =>
    enqueueVaultFsReconcileJob(
      'watch-event',
      () =>
        reconcileOpenNotesAfterFsChangeFromVaultWatch(
          reconcileFsOpenEnv,
          reconcileFsTodayEnv,
          rawPaths,
          rerunFsReconcileForTab,
        ),
    );

  const runOpenTabProbe = (trigger: 'focus' | 'interval') => {
    const now = Date.now();
    if (now - lastOpenTabProbeAtMs < VAULT_OPEN_TAB_PROBE_MIN_GAP_MS) {
      return;
    }
    lastOpenTabProbeAtMs = now;
    const {refs} = deps;
    enqueueVaultFsReconcileJob(
      `open-tab-probe:${trigger}`,
      async () => {
        const before = refs.lastPersistedRef.current;
        const externalMutationSeqBefore =
          refs.lastPersistedExternalMutationSeqRef.current;
        const vaultFilesChangedEventSeqBefore = vaultFilesChangedEventSeq;
        await reconcileOpenNotesAfterFsChangeFromVaultWatch(
          {
            ...reconcileFsOpenEnv,
            bumpLastPersistedExternalMutationSeq: bumpProbeNoop,
          },
          reconcileFsTodayEnv,
          [],
          rerunFsReconcileForTab,
        );
        if (isCancelled()) {
          return;
        }
        if (
          refs.lastPersistedExternalMutationSeqRef.current
          !== externalMutationSeqBefore
        ) {
          return;
        }
        if (vaultFilesChangedEventSeq !== vaultFilesChangedEventSeqBefore) {
          return;
        }
        const after = refs.lastPersistedRef.current;
        const selected = refs.selectedUriRef.current;
        if (
          selected
          && before?.uri === selected
          && after?.uri === selected
          && before.markdown !== after.markdown
        ) {
          captureObservabilityMessage({
            message: 'eskerra.desktop.vault_watch_open_tab_probe_reload',
            level: 'warning',
            extra: {
              trigger,
              watchSessionId,
              vaultRootHash,
              markdownBeforeHash: fingerprintUtf16ForDebug(before.markdown),
              markdownAfterHash: fingerprintUtf16ForDebug(after.markdown),
            },
            tags: {
              obs_surface: 'vault_watch',
              watch_session_id: watchSessionId,
              vault_root_hash: vaultRootHash,
              backend: 'open_tab_probe',
              reason: trigger,
            },
            fingerprint: [
              'eskerra.desktop',
              'vault_watch_open_tab_probe_reload',
              trigger,
            ],
          });
        }
      },
    );
  };

  const onWindowFocus = () => runOpenTabProbe('focus');
  window.addEventListener('focus', onWindowFocus);
  const openTabProbeInterval = window.setInterval(
    () => runOpenTabProbe('interval'),
    VAULT_OPEN_TAB_PROBE_INTERVAL_MS,
  );

  const handleVaultFilesChanged = (payload: VaultFilesChangedPayload | undefined) => {
    vaultFilesChangedEventSeq += 1;
    const plan = planVaultFilesChangedEvent({
      payload,
      isPodcastRelevantPath: isPodcastRelevantVaultPath,
      allowCoarseFullReindex: !coarseFullReindexScheduled,
    });
    const {paths, coarse} = plan;
    const coarseReason = payload?.coarseReason ?? null;
    const now = Date.now();
    const shouldRunRefreshWork =
      !coarse || now - lastCoarseRefreshAtMs >= VAULT_COARSE_REFRESH_DEDUP_MS;
    if (plan.shouldTouchPathsIncrementally) {
      const signature = vaultChangedPathsSignature(paths);
      const duplicate =
        lastIncrementalIndexTouch?.signature === signature
        && now - lastIncrementalIndexTouch.touchedAtMs < VAULT_INDEX_TOUCH_DEDUP_MS;
      if (!duplicate) {
        lastIncrementalIndexTouch = {signature, touchedAtMs: now};
        vaultSearchIndexTouchPaths(paths).catch(() => undefined);
        vaultFrontmatterIndexTouchPaths(paths).catch(() => undefined);
      }
    }
    if (plan.shouldScheduleFullReindex) {
      if (coarse) {
        coarseFullReindexScheduled = true;
      }
      vaultSearchIndexSchedule().catch(() => undefined);
      vaultFrontmatterIndexSchedule().catch(() => undefined);
    }
    if (coarse) {
      const backend = vaultWatchBackendFromReason(coarseReason);
      console.warn('[vault-files-changed] coarse invalidation', {
        reason: coarseReason,
        pathCount: paths.length,
        watchSessionId,
        vaultRootHash,
      });
      captureObservabilityMessage({
        message: 'eskerra.desktop.vault_watch_coarse_invalidation',
        level: 'warning',
        extra: {
          reason: coarseReason,
          pathCount: paths.length,
          watchSessionId,
          vaultRootHash,
        },
        tags: {
          obs_surface: 'vault_watch',
          watch_session_id: watchSessionId,
          vault_root_hash: vaultRootHash,
          coarse_reason: coarseReason ?? 'unknown',
        },
        fingerprint: [
          'eskerra.desktop',
          'vault_watch_coarse_invalidation',
          coarseReason ?? 'unknown',
        ],
      });
      if (coarseReason?.startsWith('notify_error:')) {
        captureObservabilityMessage({
          message: 'eskerra.desktop.vault_watch_backend_error',
          level: 'warning',
          extra: {
            reason: coarseReason,
            backend,
            pathCount: paths.length,
            watchSessionId,
            vaultRootHash,
          },
          tags: {
            obs_surface: 'vault_watch',
            watch_session_id: watchSessionId,
            vault_root_hash: vaultRootHash,
            backend,
            reason: coarseReason,
          },
          fingerprint: [
            'eskerra.desktop',
            'vault_watch_backend_error',
            backend,
          ],
        });
      }
    }
    if (!shouldRunRefreshWork) {
      return;
    }
    if (coarse) {
      lastCoarseRefreshAtMs = now;
    }
    const {subtreeMarkdownCache, actions, callbacks} = deps;
    subtreeMarkdownCache.invalidateAll();
    callbacks.clearBacklinkDiskBodyCache();
    callbacks.refreshNotes(vaultRoot).catch(() => undefined);
    actions.setFsRefreshNonce(n => n + 1);
    if (plan.shouldRefreshPodcasts) {
      actions.setPodcastFsNonce(n => n + 1);
    }
    (async () => {
      try {
        const next = await readVaultSettings(vaultRoot, deps.fs);
        actions.setVaultSettings(next);
      } catch {
        // ignore: transient FS race
      }
    })().catch(() => undefined);
    reconcileOpenNotesAfterFsChange(plan.pathsForReconcile).catch(() => undefined);
  };

  const disposeProbeListeners = () => {
    window.removeEventListener('focus', onWindowFocus);
    window.clearInterval(openTabProbeInterval);
  };

  return {
    watchSessionId,
    vaultRootHash,
    vaultRoot,
    deps,
    cancelled: isCancelled,
    reconcileFsOpenEnv,
    reconcileFsTodayEnv,
    enqueueVaultFsReconcileJob,
    runOpenTabProbe,
    handleVaultFilesChanged,
    disposeProbeListeners,
  };
}

export function disposeVaultWatchSession(
  session: VaultWatchSession,
  diskConflictDeferTimerRef: {current: number | null},
): void {
  session.disposeProbeListeners();
  if (diskConflictDeferTimerRef.current != null) {
    window.clearTimeout(diskConflictDeferTimerRef.current);
    diskConflictDeferTimerRef.current = null;
  }
}

import {listen} from '@tauri-apps/api/event';
import {
  useEffect,
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
} from 'react';

import type {
  EskerraSettings,
  SubtreeMarkdownPresenceCache,
  VaultFilesystem,
} from '@eskerra/core';

import type {NoteMarkdownEditorHandle} from '../editor/noteEditor/NoteMarkdownEditor';
import type {InboxAutosaveScheduler} from '../lib/inboxAutosaveScheduler';
import {captureObservabilityMessage} from '../observability/captureObservabilityMessage';
import {isPodcastRelevantVaultPath} from './workspacePodcastFsRelevance';
import {
  vaultFrontmatterIndexSchedule,
  vaultFrontmatterIndexTouchPaths,
} from '../lib/tauriVaultFrontmatter';
import {vaultSearchIndexSchedule, vaultSearchIndexTouchPaths} from '../lib/tauriVaultSearch';
import {readVaultSettings} from '../lib/vaultBootstrap';
import type {VaultFilesChangedPayload} from '../lib/vaultFilesChangedPayload';
import {planVaultFilesChangedEvent} from '../lib/vaultFilesChangedEventPlan';
import type {EditorWorkspaceTab} from '../lib/editorWorkspaceTabs';
import type {
  TodayHubSettings,
  TodayHubWorkspaceBridge,
} from '../lib/todayHub';
import {
  fingerprintUtf16ForDebug,
  reconcileOpenNotesAfterFsChangeFromVaultWatch,
  type DiskConflictSoftState,
  type DiskConflictState,
  type LastPersisted,
  type ReconcileFsOpenMarkdownEnv,
  type ReconcileFsTodayHubEnv,
} from './workspaceFsWatchReconcile';

const VAULT_INDEX_TOUCH_DEDUP_MS = 1000;
const VAULT_OPEN_TAB_PROBE_INTERVAL_MS = 10000;
const VAULT_OPEN_TAB_PROBE_MIN_GAP_MS = 2500;
const VAULT_COARSE_REFRESH_DEDUP_MS = 30000;

export function vaultChangedPathsSignature(paths: readonly string[]): string {
  return [...new Set(paths.map(p => p.trim()).filter(Boolean))].sort().join('\n');
}

export function vaultWatchBackendFromReason(reason: string | null): string {
  if (!reason) {
    return 'unknown';
  }
  const parts = reason.split(':');
  return parts.length >= 2 && parts[1] ? parts[1] : 'unknown';
}

export function normalizeVaultWatchErrorReason(message: string): string {
  const lower = message.toLowerCase();
  const osMatch = lower.match(/\(os error (\d+)\)/);
  if (osMatch?.[1]) {
    return `os_error_${osMatch[1]}`;
  }
  if (lower.includes('permission denied') || lower.includes('operation not permitted')) {
    return 'permission_denied';
  }
  if (lower.includes('no such file') || lower.includes('not found')) {
    return 'not_found';
  }
  if (lower.includes('too many open files')) {
    return 'too_many_open_files';
  }
  if (lower.includes('recommended watcher')) {
    return 'recommended_watcher_error';
  }
  if (lower.includes('poll watcher')) {
    return 'poll_watcher_error';
  }
  return 'unknown';
}

export function useWorkspaceVaultWatchEffects(args: {
  vaultRoot: string | null;
  fs: VaultFilesystem;
  refreshNotes: (root: string) => Promise<void>;
  inboxEditorRef: RefObject<NoteMarkdownEditorHandle | null>;
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
  subtreeMarkdownCache: SubtreeMarkdownPresenceCache;
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
}): void {
  const {
    vaultRoot,
    fs,
    refreshNotes,
    inboxEditorRef,
    openMarkdownInEditor,
    loadFullMarkdownIntoInboxEditor,
    scheduleBacklinksDeferOneFrameAfterLoad,
    clearBacklinkDiskBodyCache,
    subtreeMarkdownCache,
    vaultRootRef,
    editorWorkspaceTabsRef,
    selectedUriRef,
    activeEditorTabIdRef,
    composingNewEntryRef,
    diskConflictRef,
    diskConflictSoftRef,
    inboxContentByUriRef,
    lastPersistedRef,
    lastPersistedExternalMutationSeqRef,
    editorBodyRef,
    inboxYamlFrontmatterInnerRef,
    inboxEditorYamlLeadingBeforeFrontmatterRef,
    editorShellScrollByUriRef,
    skipRecencyDeferForUriRef,
    diskConflictDeferTimerRef,
    lastInboxEditorActivityAtRef,
    autosaveSchedulerRef,
    todayHubRowLastPersistedRef,
    todayHubSettingsRef,
    todayHubBridgeRef,
    setEditorWorkspaceTabs,
    setActiveEditorTabId,
    setDiskConflict,
    setDiskConflictSoft,
    setInboxContentByUri,
    setSelectedUri,
    setComposingNewEntry,
    setEditorBody,
    setInboxEditorResetNonce,
    setInboxYamlFrontmatterInner,
    setInboxEditorYamlLeadingBeforeFrontmatter,
    setFsRefreshNonce,
    setPodcastFsNonce,
    setVaultSettings,
  } = args;

  useEffect(() => {
    if (!vaultRoot) {
      return;
    }
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    const watchSessionId = crypto.randomUUID();
    const vaultRootHash = fingerprintUtf16ForDebug(vaultRoot);
    let coarseFullReindexScheduled = false;
    let lastIncrementalIndexTouch:
      | {signature: string; touchedAtMs: number}
      | null = null;
    let lastOpenTabProbeAtMs = 0;
    let lastCoarseRefreshAtMs = 0;
    let vaultFilesChangedEventSeq = 0;
    const markExternalLastPersistedMutation = () => {
      lastPersistedExternalMutationSeqRef.current += 1;
    };
    const markProbeLastPersistedMutation = () => undefined;

    const reconcileFsOpenEnv: ReconcileFsOpenMarkdownEnv = {
      cancelled: () => cancelled,
      fs,
      vaultRootRef,
      editorWorkspaceTabsRef,
      selectedUriRef,
      activeEditorTabIdRef,
      composingNewEntryRef,
      diskConflictRef,
      diskConflictSoftRef,
      inboxContentByUriRef,
      lastPersistedRef,
      editorBodyRef,
      inboxYamlFrontmatterInnerRef,
      inboxEditorYamlLeadingBeforeFrontmatterRef,
      editorShellScrollByUriRef,
      skipRecencyDeferForUriRef,
      diskConflictDeferTimerRef,
      lastInboxEditorActivityAtRef,
      inboxEditorRef,
      autosaveSchedulerRef,
      markLastPersistedMutation: markExternalLastPersistedMutation,
      setEditorWorkspaceTabs,
      setActiveEditorTabId,
      setDiskConflict,
      setDiskConflictSoft,
      setInboxContentByUri,
      setSelectedUri,
      setComposingNewEntry,
      setEditorBody,
      setInboxEditorResetNonce,
      setInboxYamlFrontmatterInner,
      setInboxEditorYamlLeadingBeforeFrontmatter,
      openMarkdownInEditor,
      loadFullMarkdownIntoInboxEditor,
      scheduleBacklinksDeferOneFrameAfterLoad,
    };
    const reconcileFsTodayEnv: ReconcileFsTodayHubEnv = {
      todayHubRowLastPersistedRef,
      todayHubSettingsRef,
      todayHubBridgeRef,
    };
    let vaultFsReconcileQueue: Promise<void> = Promise.resolve();
    const enqueueVaultFsReconcileJob = (
      label: string,
      job: () => Promise<void>,
    ): Promise<void> => {
      const run = async () => {
        if (cancelled) {
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
      void enqueueVaultFsReconcileJob(
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
      void enqueueVaultFsReconcileJob(
        `open-tab-probe:${trigger}`,
        async () => {
          const before = lastPersistedRef.current;
          const externalMutationSeqBefore =
            lastPersistedExternalMutationSeqRef.current;
          const vaultFilesChangedEventSeqBefore = vaultFilesChangedEventSeq;
          await reconcileOpenNotesAfterFsChangeFromVaultWatch(
            {
              ...reconcileFsOpenEnv,
              markLastPersistedMutation: markProbeLastPersistedMutation,
            },
            reconcileFsTodayEnv,
            [],
            rerunFsReconcileForTab,
          );
          if (cancelled) {
            return;
          }
          if (
            lastPersistedExternalMutationSeqRef.current
            !== externalMutationSeqBefore
          ) {
            return;
          }
          if (vaultFilesChangedEventSeq !== vaultFilesChangedEventSeqBefore) {
            return;
          }
          const after = lastPersistedRef.current;
          const selected = selectedUriRef.current;
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

    listen<VaultFilesChangedPayload>('vault-files-changed', event => {
      vaultFilesChangedEventSeq += 1;
      const plan = planVaultFilesChangedEvent({
        payload: event.payload,
        isPodcastRelevantPath: isPodcastRelevantVaultPath,
        allowCoarseFullReindex: !coarseFullReindexScheduled,
      });
      const {paths, coarse} = plan;
      const coarseReason = event.payload?.coarseReason ?? null;
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
      subtreeMarkdownCache.invalidateAll();
      clearBacklinkDiskBodyCache();
      void refreshNotes(vaultRoot);
      setFsRefreshNonce(n => n + 1);
      // Only rescan podcast catalog when podcast-relevant files change (YYYY podcasts.md or 📻 *.md).
      if (plan.shouldRefreshPodcasts) {
        setPodcastFsNonce(n => n + 1);
      }
      void (async () => {
        try {
          const next = await readVaultSettings(vaultRoot, fs);
          setVaultSettings(next);
        } catch {
          // ignore: transient FS race
        }
      })();
      void reconcileOpenNotesAfterFsChange(plan.pathsForReconcile);
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
      window.removeEventListener('focus', onWindowFocus);
      window.clearInterval(openTabProbeInterval);
      unlisten?.();
      if (diskConflictDeferTimerRef.current != null) {
        window.clearTimeout(diskConflictDeferTimerRef.current);
        diskConflictDeferTimerRef.current = null;
      }
    };
  }, [
    vaultRoot,
    refreshNotes,
    fs,
    inboxEditorRef,
    openMarkdownInEditor,
    loadFullMarkdownIntoInboxEditor,
    scheduleBacklinksDeferOneFrameAfterLoad,
    clearBacklinkDiskBodyCache,
    subtreeMarkdownCache,
    vaultRootRef,
    editorWorkspaceTabsRef,
    selectedUriRef,
    activeEditorTabIdRef,
    composingNewEntryRef,
    diskConflictRef,
    diskConflictSoftRef,
    inboxContentByUriRef,
    lastPersistedRef,
    lastPersistedExternalMutationSeqRef,
    editorBodyRef,
    inboxYamlFrontmatterInnerRef,
    inboxEditorYamlLeadingBeforeFrontmatterRef,
    editorShellScrollByUriRef,
    skipRecencyDeferForUriRef,
    diskConflictDeferTimerRef,
    lastInboxEditorActivityAtRef,
    autosaveSchedulerRef,
    todayHubRowLastPersistedRef,
    todayHubSettingsRef,
    todayHubBridgeRef,
    setEditorWorkspaceTabs,
    setActiveEditorTabId,
    setDiskConflict,
    setDiskConflictSoft,
    setInboxContentByUri,
    setSelectedUri,
    setComposingNewEntry,
    setEditorBody,
    setInboxEditorResetNonce,
    setInboxYamlFrontmatterInner,
    setInboxEditorYamlLeadingBeforeFrontmatter,
    setFsRefreshNonce,
    setPodcastFsNonce,
    setVaultSettings,
  ]);
}

import type {SessionNotificationTone} from './sessionNotifications';

type ManualSyncRunner = (opts?: {readonly silent?: boolean}) => Promise<boolean>;

export function buildCloseSyncRunner(runManualSync: ManualSyncRunner): () => Promise<boolean> {
  return () => runManualSync({silent: true});
}

type HandleManualSyncCloseRequestArgs = {
  instant: boolean;
  manualSyncDisabledReason: string | null;
  manualSyncRunning: boolean;
  runManualSync: () => Promise<boolean>;
  close: () => void;
  notify: (tone: SessionNotificationTone, text: string) => void;
  notifyDisabled?: boolean;
  /** When true, shows failure context when sync-before-close fails. */
  showCloseSyncFeedback?: boolean;
};

export async function handleManualSyncCloseRequest({
  instant,
  manualSyncDisabledReason,
  manualSyncRunning,
  runManualSync,
  close,
  notify,
  notifyDisabled = true,
  showCloseSyncFeedback = false,
}: HandleManualSyncCloseRequestArgs): Promise<void> {
  if (instant) {
    close();
    return;
  }

  if (manualSyncRunning) {
    return;
  }

  if (manualSyncDisabledReason != null) {
    if (notifyDisabled) {
      notify(
        'error',
        `Cannot sync before closing: ${manualSyncDisabledReason}. Hold Shift and click close to close instantly.`,
      );
    }
    return;
  }

  const synced = await runManualSync();
  if (synced) {
    close();
  } else if (showCloseSyncFeedback) {
    notify('error', 'Sync before close failed. Eskerra stayed open.');
  }
}

/** Conservative overall timeout for sync-before-close; independent of Git subcommand timeouts. */
export const CLOSE_SYNC_TIMEOUT_MS = 30_000;

type HandleOsCloseRequestArgs = {
  manualSyncRequired?: boolean;
  manualSyncDisabledReason: string | null;
  manualSyncRunning: boolean;
  runManualSync: () => Promise<boolean>;
  notify: (tone: SessionNotificationTone, text: string) => void;
  /** Programmatic close that bypasses the OS-close interceptor (allowClose already set). */
  close: () => void;
  /** Ref shared with the caller; prevents duplicate runs on repeated close attempts. */
  closeSyncInProgressRef: {current: boolean};
  timeoutMs?: number;
};

/**
 * Handles an OS/window-manager close event:
 * - Guards against duplicate runs via closeSyncInProgressRef.
 * - Races sync against a timeout.
 * - Calls close() on success; notifies on failure or timeout.
 */
export async function handleOsCloseRequest({
  manualSyncRequired = true,
  manualSyncDisabledReason,
  manualSyncRunning,
  runManualSync,
  notify,
  close,
  closeSyncInProgressRef,
  timeoutMs = CLOSE_SYNC_TIMEOUT_MS,
}: HandleOsCloseRequestArgs): Promise<void> {
  if (closeSyncInProgressRef.current) {
    return;
  }

  if (!manualSyncRequired) {
    close();
    return;
  }

  if (manualSyncDisabledReason != null) {
    notify(
      'error',
      `Cannot sync before closing: ${manualSyncDisabledReason}. Use the close button while holding Shift to close instantly.`,
    );
    return;
  }

  if (manualSyncRunning) {
    return;
  }

  closeSyncInProgressRef.current = true;

  try {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<'timeout'>(resolve => {
      timeoutId = setTimeout(() => { resolve('timeout'); }, timeoutMs);
    });

    const result = await Promise.race([runManualSync(), timeoutPromise]);
    clearTimeout(timeoutId);

    if (result === 'timeout') {
      notify(
        'error',
        'Sync before close timed out. Eskerra stayed open so you can retry or close instantly.',
      );
    } else if (result === true) {
      close();
    } else {
      notify('error', 'Sync before close failed. Eskerra stayed open.');
    }
  } finally {
    closeSyncInProgressRef.current = false;
  }
}

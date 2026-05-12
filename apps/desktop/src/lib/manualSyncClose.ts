import type {SessionNotificationTone} from './sessionNotifications';

type HandleManualSyncCloseRequestArgs = {
  instant: boolean;
  manualSyncDisabledReason: string | null;
  manualSyncRunning: boolean;
  runManualSync: () => Promise<boolean>;
  close: () => void;
  notify: (tone: SessionNotificationTone, text: string) => void;
  notifyDisabled?: boolean;
};

export async function handleManualSyncCloseRequest({
  instant,
  manualSyncDisabledReason,
  manualSyncRunning,
  runManualSync,
  close,
  notify,
  notifyDisabled = true,
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
  }
}

import type {SessionNotificationTone} from './sessionNotifications';

type HandleManualSyncCloseRequestArgs = {
  instant: boolean;
  manualSyncDisabledReason: string | null;
  manualSyncRunning: boolean;
  runManualSync: () => Promise<boolean>;
  close: () => void;
  notify: (tone: SessionNotificationTone, text: string) => void;
};

export async function handleManualSyncCloseRequest({
  instant,
  manualSyncDisabledReason,
  manualSyncRunning,
  runManualSync,
  close,
  notify,
}: HandleManualSyncCloseRequestArgs): Promise<void> {
  if (instant) {
    close();
    return;
  }

  if (manualSyncRunning) {
    return;
  }

  if (manualSyncDisabledReason != null) {
    notify(
      'error',
      `Cannot sync before closing: ${manualSyncDisabledReason}. Hold Shift and click close to close instantly.`,
    );
    return;
  }

  const synced = await runManualSync();
  if (synced) {
    close();
  }
}

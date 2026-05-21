import {useMemo} from 'react';

import {useSessionNotifications} from '../hooks/useSessionNotifications';
import {normalizeEditorDocUri} from '../lib/editorDocumentHistory';
import type {AppStatusBarCenter} from '../lib/resolveAppStatusBarCenter';

type UseAppNotificationSessionArgs = {
  err: string | null;
  diskConflict: unknown;
  diskConflictSoft: {uri: string} | null;
  selectedUri: string | null;
  statusBarCenter: AppStatusBarCenter;
  renameLinkProgress: {done: number; total: number} | null;
  openNotificationsPanel: () => void;
};

export function useAppNotificationSession({
  err,
  diskConflict,
  diskConflictSoft,
  selectedUri,
  statusBarCenter,
  renameLinkProgress,
  openNotificationsPanel,
}: UseAppNotificationSessionArgs) {
  const diskConflictSoftVisible = useMemo(
    () =>
      !err &&
      diskConflict == null &&
      diskConflictSoft != null &&
      selectedUri != null &&
      normalizeEditorDocUri(diskConflictSoft.uri) ===
        normalizeEditorDocUri(selectedUri),
    [err, diskConflict, diskConflictSoft, selectedUri],
  );

  const session = useSessionNotifications(
    {
      statusBarCenter,
      renameLinkProgress,
      diskConflictBlocking: diskConflict != null,
      diskConflictSoftVisible,
    },
    {onOpenPanel: openNotificationsPanel},
  );

  return session;
}

import {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';

import type {AppStatusBarCenter} from '../lib/resolveAppStatusBarCenter';
import {
  DISK_CONFLICT_BLOCKING_NOTIF_TEXT,
  DISK_CONFLICT_SOFT_NOTIF_TEXT,
  SESSION_NOTIF_RENAME_PROGRESS_ID,
  appendNotification,
  removeNotificationById,
  statusMessageSignature,
  upsertRenameProgressItem,
  type SessionNotification,
  type SessionNotificationTone,
} from '../lib/sessionNotifications';

function hasStatusNotificationWithMessage(
  items: SessionNotification[],
  tone: SessionNotification['tone'],
  text: string,
): boolean {
  return items.some(
    n => n.source === 'status' && n.tone === tone && n.text === text,
  );
}

export type UseSessionNotificationsInput = {
  statusBarCenter: AppStatusBarCenter;
  renameLinkProgress: {done: number; total: number} | null;
  diskConflictBlocking: boolean;
  diskConflictSoftVisible: boolean;
};

export type UseSessionNotificationsOptions = {
  onOpenPanel: () => void;
};

export function useSessionNotifications(
  input: UseSessionNotificationsInput,
  options: UseSessionNotificationsOptions,
) {
  const onOpenPanelRef = useRef(options.onOpenPanel);
  useLayoutEffect(() => {
    onOpenPanelRef.current = options.onOpenPanel;
  }, [options.onOpenPanel]);

  const [items, setItems] = useState<SessionNotification[]>([]);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const highlightClearTimerRef = useRef<number | null>(null);

  const dismissedStatusSigsRef = useRef<Set<string>>(new Set());
  const dismissedRenameWhileActiveRef = useRef(false);
  const prevDiskBlockingRef = useRef(false);
  const prevDiskSoftRef = useRef(false);

  const {statusBarCenter, renameLinkProgress, diskConflictBlocking, diskConflictSoftVisible} =
    input;

  useEffect(() => {
    if (statusBarCenter.kind !== 'message' || renameLinkProgress != null) {
      dismissedStatusSigsRef.current.clear();
      return;
    }
    const sig = statusMessageSignature(statusBarCenter.tone, statusBarCenter.text);
    for (const k of [...dismissedStatusSigsRef.current]) {
      if (k !== sig) {
        dismissedStatusSigsRef.current.delete(k);
      }
    }
  }, [statusBarCenter, renameLinkProgress]);

  useEffect(() => {
    if (statusBarCenter.kind !== 'message') {
      return;
    }
    if (renameLinkProgress != null) {
      return;
    }
    const {tone, text} = statusBarCenter;
    const sig = statusMessageSignature(tone, text);
    if (dismissedStatusSigsRef.current.has(sig)) {
      return;
    }
    queueMicrotask(() => {
      setItems(prev => {
        if (hasStatusNotificationWithMessage(prev, tone, text)) {
          return prev;
        }
        const id = crypto.randomUUID();
        return appendNotification(prev, {id, tone, text, source: 'status'});
      });
    });
  }, [statusBarCenter, renameLinkProgress]);

  useEffect(() => {
    if (renameLinkProgress == null) {
      dismissedRenameWhileActiveRef.current = false;
      return;
    }
    if (dismissedRenameWhileActiveRef.current) {
      return;
    }
    const text = `Updating links… ${renameLinkProgress.done}/${renameLinkProgress.total}`;
    queueMicrotask(() => {
      setItems(prev => upsertRenameProgressItem(prev, text));
    });
  }, [renameLinkProgress]);

  useEffect(() => {
    if (diskConflictBlocking && !prevDiskBlockingRef.current) {
      const id = crypto.randomUUID();
      queueMicrotask(() => {
        setItems(prev =>
          appendNotification(prev, {
            id,
            tone: 'error',
            text: DISK_CONFLICT_BLOCKING_NOTIF_TEXT,
            source: 'diskConflictBlocking',
          }),
        );
      });
    }
    prevDiskBlockingRef.current = diskConflictBlocking;
  }, [diskConflictBlocking]);

  useEffect(() => {
    if (diskConflictSoftVisible && !prevDiskSoftRef.current) {
      const id = crypto.randomUUID();
      queueMicrotask(() => {
        setItems(prev =>
          appendNotification(prev, {
            id,
            tone: 'info',
            text: DISK_CONFLICT_SOFT_NOTIF_TEXT,
            source: 'diskConflictSoft',
          }),
        );
      });
    }
    prevDiskSoftRef.current = diskConflictSoftVisible;
  }, [diskConflictSoftVisible]);

  const dismissItem = useCallback((id: string) => {
    setItems(prev => {
      const item = prev.find(i => i.id === id);
      if (item?.source === 'status') {
        dismissedStatusSigsRef.current.add(statusMessageSignature(item.tone, item.text));
      }
      if (item?.source === 'renameProgress') {
        dismissedRenameWhileActiveRef.current = true;
      }
      return removeNotificationById(prev, id);
    });
  }, []);

  const clearAll = useCallback(() => {
    dismissedStatusSigsRef.current.clear();
    dismissedRenameWhileActiveRef.current = false;
    setItems([]);
  }, []);

  const pushItem = useCallback((tone: SessionNotificationTone, text: string) => {
    const id = crypto.randomUUID();
    setItems(prev =>
      appendNotification(prev, {
        id,
        tone,
        text,
        source: 'manualGitSync',
      }),
    );
  }, []);

  const openPanelAndHighlight = useCallback((id: string) => {
    onOpenPanelRef.current();
    setHighlightId(id);
    if (highlightClearTimerRef.current != null) {
      clearTimeout(highlightClearTimerRef.current);
    }
    highlightClearTimerRef.current = window.setTimeout(() => {
      highlightClearTimerRef.current = null;
      setHighlightId(null);
    }, 2400);
  }, []);

  useEffect(() => {
    return () => {
      if (highlightClearTimerRef.current != null) {
        clearTimeout(highlightClearTimerRef.current);
      }
    };
  }, []);

  const linkedNotificationId = useMemo(() => {
    if (statusBarCenter.kind !== 'message') {
      return null;
    }
    if (renameLinkProgress != null) {
      const inList = items.some(i => i.id === SESSION_NOTIF_RENAME_PROGRESS_ID);
      return inList ? SESSION_NOTIF_RENAME_PROGRESS_ID : null;
    }
    return (
      items.find(
        i =>
          i.source === 'status' &&
          i.tone === statusBarCenter.tone &&
          i.text === statusBarCenter.text,
      )?.id ?? null
    );
  }, [items, renameLinkProgress, statusBarCenter]);

  return {
    items,
    dismissItem,
    clearAll,
    pushItem,
    highlightId,
    linkedNotificationId,
    openPanelAndHighlight,
  };
}

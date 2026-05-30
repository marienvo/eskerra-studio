import {useCallback, useEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';

import {SESSION_NOTIF_RENAME_PROGRESS_ID} from '../lib/sessionNotifications';
import type {SessionNotification} from '../lib/sessionNotifications';
import {diffToastIds} from '../lib/toastQueue';
import {MaterialIcon} from './MaterialIcon';

const TOAST_DURATION_MS = 10_000;

type ToastStackProps = {
  items: readonly SessionNotification[];
  onDismiss: (id: string) => void;
};

type TimerState = {
  timerId: number;
  startedAt: number;
  remaining: number;
};

export function ToastStack({items, onDismiss}: ToastStackProps) {
  const [liveIds, setLiveIds] = useState<ReadonlySet<string>>(() => new Set());
  const [progressBarEpochById, setProgressBarEpochById] = useState<
    ReadonlyMap<string, number>
  >(() => new Map());

  // Seeded once on mount so a notification backlog does not flash as new toasts.
  const seenIdsRef = useRef<Set<string>>(new Set(items.map(i => i.id)));

  const timersRef = useRef<Map<string, TimerState>>(new Map());
  // Tracks last seen text for rename-progress to detect in-place text changes.
  const lastRenameTextRef = useRef<string | null>(null);

  const bumpProgressBarEpoch = useCallback((id: string) => {
    setProgressBarEpochById(prev => {
      const next = new Map(prev);
      next.set(id, (prev.get(id) ?? 0) + 1);
      return next;
    });
  }, []);

  const expireToast = useCallback((id: string) => {
    timersRef.current.delete(id);
    setLiveIds(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const startTimer = useCallback(
    (id: string, durationMs: number) => {
      const existing = timersRef.current.get(id);
      if (existing != null) {
        clearTimeout(existing.timerId);
      }
      const timerId = window.setTimeout(() => expireToast(id), durationMs);
      timersRef.current.set(id, {
        timerId,
        startedAt: Date.now(),
        remaining: durationMs,
      });
    },
    [expireToast],
  );

  useEffect(() => {
    const seenIds = seenIdsRef.current;
    const currentIds = items.map(i => i.id);
    const {appeared, removed} = diffToastIds({seenIds, liveIds, currentIds});

    // Handle rename-progress in-place text change: if already live, restart timer.
    const renameItem = items.find(i => i.id === SESSION_NOTIF_RENAME_PROGRESS_ID);
    if (
      renameItem != null &&
      liveIds.has(SESSION_NOTIF_RENAME_PROGRESS_ID) &&
      renameItem.text !== lastRenameTextRef.current
    ) {
      lastRenameTextRef.current = renameItem.text;
      startTimer(SESSION_NOTIF_RENAME_PROGRESS_ID, TOAST_DURATION_MS);
      bumpProgressBarEpoch(SESSION_NOTIF_RENAME_PROGRESS_ID);
    }
    if (renameItem == null) {
      lastRenameTextRef.current = null;
    }

    if (appeared.length === 0 && removed.length === 0) {
      return;
    }

    for (const id of appeared) {
      seenIds.add(id);
      if (id === SESSION_NOTIF_RENAME_PROGRESS_ID) {
        lastRenameTextRef.current = items.find(i => i.id === id)?.text ?? null;
      }
      startTimer(id, TOAST_DURATION_MS);
    }

    const timers = timersRef.current;
    for (const id of removed) {
      const state = timers.get(id);
      if (state != null) {
        clearTimeout(state.timerId);
        timers.delete(id);
      }
    }

    setLiveIds(prev => {
      const next = new Set(prev);
      for (const id of appeared) next.add(id);
      for (const id of removed) next.delete(id);
      return next;
    });
  }, [bumpProgressBarEpoch, items, liveIds, startTimer]);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const state of timers.values()) {
        clearTimeout(state.timerId);
      }
    };
  }, []);

  const handleMouseEnter = useCallback((id: string) => {
    const state = timersRef.current.get(id);
    if (state == null) return;
    clearTimeout(state.timerId);
    const elapsed = Date.now() - state.startedAt;
    const remaining = Math.max(0, state.remaining - elapsed);
    timersRef.current.set(id, {...state, timerId: -1, remaining});
  }, []);

  const handleMouseLeave = useCallback(
    (id: string) => {
      const state = timersRef.current.get(id);
      if (state == null || state.remaining <= 0) return;
      const timerId = window.setTimeout(() => expireToast(id), state.remaining);
      timersRef.current.set(id, {
        timerId,
        startedAt: Date.now(),
        remaining: state.remaining,
      });
    },
    [expireToast],
  );

  const liveItems = items.filter(i => liveIds.has(i.id));

  if (liveItems.length === 0) {
    return null;
  }

  return createPortal(
    <div className="toast-stack" aria-live="polite" aria-atomic="false">
      {liveItems.map(item => (
        <div
          key={item.id}
          className={`toast toast--${item.tone}`}
          role={item.tone === 'error' ? 'alert' : undefined}
          onMouseEnter={() => handleMouseEnter(item.id)}
          onMouseLeave={() => handleMouseLeave(item.id)}
        >
          <MaterialIcon
            name={item.tone === 'error' ? 'error_outline' : 'info'}
            size={12}
            className="toast__icon"
            aria-hidden
          />
          <p className="toast__text">{item.text}</p>
          <button
            type="button"
            className="toast__dismiss icon-btn-ghost"
            aria-label="Dismiss"
            onClick={() => {
              const state = timersRef.current.get(item.id);
              if (state != null) {
                clearTimeout(state.timerId);
                timersRef.current.delete(item.id);
              }
              onDismiss(item.id);
            }}
          >
            <MaterialIcon name="close" size={12} aria-hidden />
          </button>
          <div className="toast__progress" aria-hidden>
            <div
              key={progressBarEpochById.get(item.id) ?? 0}
              className="toast__progress-bar"
            />
          </div>
        </div>
      ))}
    </div>,
    document.body,
  );
}

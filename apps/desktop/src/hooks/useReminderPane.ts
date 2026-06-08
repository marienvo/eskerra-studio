/**
 * Loads and watches the daemon-written reminder index, manages per-row remove
 * state, and exposes the `RemoveReminder` IPC call.
 *
 * Responsibilities:
 * - Writes `reminderd.json` once per vault root so the daemon knows which
 *   vault to scan (runs off the render path, best-effort).
 * - Reads the reminder index from `~/.local/share/eskerra/reminders/<hash>.json`.
 * - Re-reads on `vault-files-changed` events (daemon rescans after vault edits)
 *   and on a 15-second polling interval (covers daemon-initiated changes like
 *   snooze/OS-action writes that don't originate from a vault file edit).
 * - Tracks per-row `removeState` ('idle' | 'removing' | 'remove-unavailable').
 * - Computes `hasDueReminders` (any reminder with `now ≥ dueAtMs`) on a
 *   minute tick so the notifications dot lights up at the right time.
 */

import {listen} from '@tauri-apps/api/event';
import {invoke, isTauri} from '@tauri-apps/api/core';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';

import {captureObservabilityMessage} from '../observability/captureObservabilityMessage';
import {hasDueRemindersNow, parseReminderIndex, type Reminder} from '../lib/reminderIndex';
import {
  isLockedSnoozeMinutes,
  reminderToPaneRow,
  type ReminderPaneRow,
  type ReminderRemoveState,
} from '../lib/reminderPane';

const POLL_INTERVAL_MS = 15_000;
const MINUTE_TICK_MS = 60_000;
const SNOOZE_UNAVAILABLE_HINT_MS = 3_000;

/**
 * Sentry signal for a `RemoveReminder` transport failure (daemon unreachable →
 * app-side `remove-unavailable`). Counts the daemon-down rate without leaking
 * PII (vault identity is the hash; the reminder id embeds a path, so it is
 * intentionally not tagged). See specs/observability/desktop-reminderd.md.
 */
const REMOVE_UNAVAILABLE_EVENT = 'eskerra.desktop.reminder_remove_unavailable';

/**
 * Sentry signal for a `SnoozeReminder` transport failure (daemon unreachable →
 * app-side `snooze-unavailable`). Parallels `REMOVE_UNAVAILABLE_EVENT`; same
 * PII-free tagging.
 */
const SNOOZE_UNAVAILABLE_EVENT = 'eskerra.desktop.reminder_snooze_unavailable';

function reportRemoveUnavailable(vaultHash: string | null): void {
  captureObservabilityMessage({
    message: REMOVE_UNAVAILABLE_EVENT,
    level: 'warning',
    fingerprint: [REMOVE_UNAVAILABLE_EVENT],
    tags: {obs_surface: 'reminders', vault_root_hash: vaultHash ?? 'unknown'},
  });
}

function reportSnoozeUnavailable(vaultHash: string | null): void {
  captureObservabilityMessage({
    message: SNOOZE_UNAVAILABLE_EVENT,
    level: 'warning',
    fingerprint: [SNOOZE_UNAVAILABLE_EVENT],
    tags: {obs_surface: 'reminders', vault_root_hash: vaultHash ?? 'unknown'},
  });
}

// ── Internal helpers ──────────────────────────────────────────────────────────

async function readIndex(vaultHash: string): Promise<Reminder[]> {
  if (!isTauri()) return [];
  try {
    const json = await invoke<string | null>('reminders_read_index', {vaultHash});
    if (!json) return [];
    return parseReminderIndex(json)?.reminders ?? [];
  } catch {
    return [];
  }
}

async function writeConfig(vaultRoot: string, vaultHash: string): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke<boolean>('reminders_write_config', {vaultRoot, vaultHash});
  } catch {
    // Best-effort: if writing fails the daemon stays idle on the old vault.
  }
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export type ReminderRemoveResult = 'removed' | 'stale' | 'remove-unavailable';

export type UseReminderPaneResult = {
  rows: readonly ReminderPaneRow[];
  /** Raw daemon index entries for reminder-id lookup outside the pane. */
  reminders: readonly Reminder[];
  hasDueReminders: boolean;
  removeReminder: (
    noteUri: string,
    reminderId: string,
  ) => Promise<ReminderRemoveResult>;
  snoozeReminder: (noteUri: string, reminderId: string, minutes: number) => Promise<void>;
};

export function useReminderPane(vaultRoot: string | null): UseReminderPaneResult {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [rowStates, setRowStates] = useState<ReadonlyMap<string, ReminderRemoveState>>(
    new Map(),
  );
  const [hasDueReminders, setHasDueReminders] = useState(false);
  const [snoozeTransientIds, setSnoozeTransientIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const vaultHashRef = useRef<string | null>(null);
  const snoozeHintTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Compute vault hash once per vault root and write reminderd.json.
  useEffect(() => {
    if (!vaultRoot || !isTauri()) {
      vaultHashRef.current = null;
      return;
    }
    let cancelled = false;
    invoke<string>('reminders_vault_hash', {vaultRoot})
      .then(hash => {
        if (cancelled) return;
        vaultHashRef.current = hash;
        // Drop any per-row remove state from the previous vault so a stale
        // 'removing' spinner or 'remove-unavailable' retry cannot bleed across
        // a vault switch if a reminder ID collides.
        setRowStates(new Map());
        void writeConfig(vaultRoot, hash);
        readIndex(hash).then(rs => {
          if (!cancelled) setReminders(rs);
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [vaultRoot]);

  // Polling interval: re-read the index so daemon-initiated writes (snooze,
  // OS notification actions) surface even when no vault file changed.
  useEffect(() => {
    if (!vaultRoot) return;
    let cancelled = false;
    const timer = setInterval(() => {
      const hash = vaultHashRef.current;
      if (hash) {
        readIndex(hash).then(rs => {
          if (!cancelled) setReminders(rs);
        });
      }
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [vaultRoot]);

  // vault-files-changed: the daemon rescans after any vault edit, so the
  // index may be fresher after this event.
  useEffect(() => {
    if (!vaultRoot) return;
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    listen('vault-files-changed', () => {
      const hash = vaultHashRef.current;
      if (hash) {
        readIndex(hash).then(rs => {
          if (!cancelled) setReminders(rs);
        });
      }
    })
      .then(fn => {
        // If the effect already tore down (e.g. vault switch) before listen()
        // resolved, unsubscribe immediately so no ghost listener survives.
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [vaultRoot]);

  // Minute tick: re-evaluate the due flag so the dot lights up at the right
  // wall-clock minute without a full re-read.
  useEffect(() => {
    const tick = () => setHasDueReminders(hasDueRemindersNow(reminders, Date.now()));
    tick();
    const timer = setInterval(tick, MINUTE_TICK_MS);
    return () => clearInterval(timer);
  }, [reminders]);

  useEffect(() => {
    const timers = snoozeHintTimersRef.current;
    return () => {
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
      timers.clear();
    };
  }, []);

  const flashSnoozeUnavailable = useCallback((reminderId: string) => {
    setSnoozeTransientIds(prev => new Set(prev).add(reminderId));
    const existing = snoozeHintTimersRef.current.get(reminderId);
    if (existing != null) {
      clearTimeout(existing);
    }
    const timer = setTimeout(() => {
      snoozeHintTimersRef.current.delete(reminderId);
      setSnoozeTransientIds(prev => {
        const next = new Set(prev);
        next.delete(reminderId);
        return next;
      });
    }, SNOOZE_UNAVAILABLE_HINT_MS);
    snoozeHintTimersRef.current.set(reminderId, timer);
  }, []);

  // Build pane rows, merging UI-only remove state from rowStates.
  const rows: readonly ReminderPaneRow[] = useMemo(
    () =>
      reminders.map(r => ({
        ...reminderToPaneRow(r, rowStates.get(r.id)),
        snoozeUnavailableHint: snoozeTransientIds.has(r.id),
      })),
    [reminders, rowStates, snoozeTransientIds],
  );

  const removeReminder = useCallback(
    async (
      noteUri: string,
      reminderId: string,
    ): Promise<ReminderRemoveResult> => {
      setRowStates(prev => {
        const next = new Map(prev);
        next.set(reminderId, 'removing');
        return next;
      });

      try {
        const result: ReminderRemoveResult = isTauri()
          ? ((await invoke<string>('reminders_remove', {noteUri, reminderId})) as ReminderRemoveResult)
          : 'remove-unavailable';

        if (result === 'removed') {
          // Drop from local state immediately; next index re-read confirms.
          setReminders(prev => prev.filter(r => r.id !== reminderId));
          setRowStates(prev => {
            const next = new Map(prev);
            next.delete(reminderId);
            return next;
          });
        } else if (result === 'stale') {
          // Daemon received the request but refused safely. Update the row's
          // reminderState via a fresh index re-read; just clear removing state.
          setRowStates(prev => {
            const next = new Map(prev);
            next.delete(reminderId);
            return next;
          });
          const hash = vaultHashRef.current;
          if (hash) {
            const rs = await readIndex(hash);
            // Bail if the vault switched while readIndex was in flight, so we
            // don't overwrite the new vault's reminders with the old vault's.
            if (vaultHashRef.current === hash) setReminders(rs);
          }
        } else {
          // 'remove-unavailable': daemon unreachable — keep row, show retry.
          reportRemoveUnavailable(vaultHashRef.current);
          setRowStates(prev => {
            const next = new Map(prev);
            next.set(reminderId, 'remove-unavailable');
            return next;
          });
        }
        return result;
      } catch {
        reportRemoveUnavailable(vaultHashRef.current);
        setRowStates(prev => {
          const next = new Map(prev);
          next.set(reminderId, 'remove-unavailable');
          return next;
        });
        return 'remove-unavailable';
      }
    },
    [],
  );

  const snoozeReminder = useCallback(
    async (noteUri: string, reminderId: string, minutes: number): Promise<void> => {
      if (!isLockedSnoozeMinutes(minutes)) {
        return;
      }

      let result: string;
      try {
        result = isTauri()
          ? await invoke<string>('reminders_snooze', {noteUri, reminderId, minutes})
          : 'snooze-unavailable';
      } catch {
        result = 'snooze-unavailable';
      }

      if (result === 'snooze-unavailable') {
        // Daemon unreachable: never a local write. Surface observability plus a
        // brief inline hint (ADR §8); leave the row interactive for menu retry.
        reportSnoozeUnavailable(vaultHashRef.current);
        flashSnoozeUnavailable(reminderId);
        return;
      }

      // Snooze changed fireAtMs / state on the daemon side; re-read the index so
      // the row reflects the new schedule immediately (the 15s poll +
      // vault-files-changed already cover this, but this keeps it responsive).
      const hash = vaultHashRef.current;
      if (hash) {
        const rs = await readIndex(hash);
        // Bail if the vault switched while the read was in flight.
        if (vaultHashRef.current === hash) setReminders(rs);
      }
    },
    [flashSnoozeUnavailable],
  );

  return {rows, reminders, hasDueReminders, removeReminder, snoozeReminder};
}

export function __resetReminderPaneForTests(): void {
  // Module-level mutable state reset for Vitest isolation. The hook's state
  // lives in React, so no reset is required at module scope right now.
}

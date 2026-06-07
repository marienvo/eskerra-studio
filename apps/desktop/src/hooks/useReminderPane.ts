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

import {hasDueRemindersNow, parseReminderIndex, type Reminder} from '../lib/reminderIndex';
import {
  reminderToPaneRow,
  type ReminderPaneRow,
  type ReminderRemoveState,
} from '../lib/reminderPane';

const POLL_INTERVAL_MS = 15_000;
const MINUTE_TICK_MS = 60_000;

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

export type UseReminderPaneResult = {
  rows: readonly ReminderPaneRow[];
  hasDueReminders: boolean;
  removeReminder: (noteUri: string, reminderId: string) => Promise<void>;
};

export function useReminderPane(vaultRoot: string | null): UseReminderPaneResult {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [rowStates, setRowStates] = useState<ReadonlyMap<string, ReminderRemoveState>>(
    new Map(),
  );
  const [hasDueReminders, setHasDueReminders] = useState(false);
  const vaultHashRef = useRef<string | null>(null);

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

  // Build pane rows, merging UI-only remove state from rowStates.
  const rows: readonly ReminderPaneRow[] = useMemo(
    () =>
      reminders.map(r =>
        reminderToPaneRow(r, rowStates.get(r.id) != null
          ? {
              id: r.id,
              source: 'reminder',
              noteUri: r.noteUri,
              reminderId: r.id,
              dueAtMs: r.dueAtMs,
              normalizedTokenText: r.normalizedTokenText,
              vaultRelativePath: r.vaultRelativePath,
              reminderState: r.state,
              uiCaretHint: r.uiCaretHint?.utf16Offset,
              removeState: rowStates.get(r.id) ?? 'idle',
            }
          : undefined),
      ),
    [reminders, rowStates],
  );

  const removeReminder = useCallback(
    async (noteUri: string, reminderId: string): Promise<void> => {
      setRowStates(prev => {
        const next = new Map(prev);
        next.set(reminderId, 'removing');
        return next;
      });

      try {
        const result = isTauri()
          ? await invoke<string>('reminders_remove', {noteUri, reminderId})
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
          setRowStates(prev => {
            const next = new Map(prev);
            next.set(reminderId, 'remove-unavailable');
            return next;
          });
        }
      } catch {
        setRowStates(prev => {
          const next = new Map(prev);
          next.set(reminderId, 'remove-unavailable');
          return next;
        });
      }
    },
    [],
  );

  return {rows, hasDueReminders, removeReminder};
}

export function __resetReminderPaneForTests(): void {
  // Module-level mutable state reset for Vitest isolation. The hook's state
  // lives in React, so no reset is required at module scope right now.
}

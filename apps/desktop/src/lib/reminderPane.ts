/**
 * Pane-level reminder row types and the unified `PaneNotification` union that
 * the `NotificationsPanel` and its consumers work with.
 *
 * The pane-level row is deliberately separate from the raw `Reminder` index
 * entry: it carries UI-only state (`removeState`) and never travels back to
 * the daemon. The raw `Reminder` is the source of truth; this is a derived
 * render model.
 */

import type {SessionNotification} from './sessionNotifications';
import type {Reminder} from './reminderIndex';

/**
 * Per-row remove lifecycle:
 * - `idle`              — normal, remove button available
 * - `removing`          — IPC call in flight, button spinner
 * - `remove-unavailable` — transport error (daemon down); shows Retry + Open note
 */
export type ReminderRemoveState = 'idle' | 'removing' | 'remove-unavailable';

/** Pane row for a single reminder. */
export type ReminderPaneRow = {
  /** Matches `Reminder.id` — used as React key and for callbacks. */
  id: string;
  source: 'reminder';
  noteUri: string;
  reminderId: string;
  dueAtMs: number;
  normalizedTokenText: string;
  vaultRelativePath: string;
  /** Reminder lifecycle state from the daemon index. */
  reminderState: Reminder['state'];
  /** Optional advisory caret position forwarded to click-to-open. */
  uiCaretHint: number | undefined;
  /**
   * The cleaned reminder line (token + leading marker removed, whitespace
   * collapsed) computed once by the Rust scanner. Empty when the line held
   * only the token; the row then folds the time onto the note-name header.
   */
  displayLine: string;
  removeState: ReminderRemoveState;
  /**
   * Brief inline flash when snooze IPC failed (ADR §8). Auto-clears; not
   * persisted across index re-reads.
   */
  snoozeUnavailableHint?: boolean;
};

/** Status-line copy when snooze transport fails (ADR §8 transient hint). */
export const REMINDER_SNOOZE_UNAVAILABLE_TEXT =
  "Couldn't reach the reminder service — try snooze again";

/** Union of all row types the notifications pane can display. */
export type PaneNotification = SessionNotification | ReminderPaneRow;

function resolveRemoveState(
  prev: ReminderRemoveState | undefined,
  daemonState: Reminder['state'],
): ReminderRemoveState {
  if (prev === 'removing' && daemonState !== 'stale') {
    return 'removing';
  }
  if (prev === 'remove-unavailable') {
    return 'remove-unavailable';
  }
  return 'idle';
}

/** Maps a raw `Reminder` into a `ReminderPaneRow`, merging existing `removeState`. */
export function reminderToPaneRow(
  reminder: Reminder,
  prevRemoveState: ReminderRemoveState | undefined,
): ReminderPaneRow {
  return {
    id: reminder.id,
    source: 'reminder',
    noteUri: reminder.noteUri,
    reminderId: reminder.id,
    dueAtMs: reminder.dueAtMs,
    normalizedTokenText: reminder.normalizedTokenText,
    vaultRelativePath: reminder.vaultRelativePath,
    reminderState: reminder.state,
    uiCaretHint: reminder.uiCaretHint?.utf16Offset,
    // Older index without `displayLine` → empty (folds onto the header).
    displayLine: reminder.displayLine ?? '',
    // Preserve in-flight UI state across index re-reads; reset only to idle
    // when the daemon confirms `removed` (row disappears) or the index no
    // longer contains this id (also gone). A `stale` daemon state clears
    // `removing` back to idle so the UI shows the stale affordance.
    removeState: resolveRemoveState(prevRemoveState, reminder.state),
  };
}

/** Note display name derived from the vault-relative path (filename without extension). */
export function reminderNoteName(vaultRelativePath: string): string {
  const parts = vaultRelativePath.split('/');
  const filename = parts[parts.length - 1] ?? vaultRelativePath;
  return filename.endsWith('.md') ? filename.slice(0, -3) : filename;
}

/**
 * Local `HH:MM` (24-hour) render of the due time — the compact `(HH:MM)` echo
 * appended to the reminder line, derived from `dueAtMs` so it stays correct
 * after a settings-only re-derive (which moves `dueAtMs` without rescanning).
 * Mirrors the daemon's `hhmm_local`.
 */
export function reminderTimeLabel(dueAtMs: number): string {
  const date = new Date(dueAtMs);
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/** The locked snooze offsets in minutes before `dueAt` (T-3 / T-1 / at-due). */
export const SNOOZE_MINUTES = [3, 1, 0] as const;
export type SnoozeMinutes = (typeof SNOOZE_MINUTES)[number];

/** Whether `minutes` is in the locked snooze action set (daemon + D-Bus contract). */
export function isLockedSnoozeMinutes(minutes: number): minutes is SnoozeMinutes {
  return (SNOOZE_MINUTES as readonly number[]).includes(minutes);
}

/**
 * Which of the three snoozes are still live at `nowMs`: relative snoozes (3 / 1)
 * target `dueAt − N·min` and are offered only while that target is strictly in
 * the future (`target > now`); snooze-0 targets `dueAt` and stays live while
 * `now <= dueAt` (the daemon fires at the boundary). Empty once `now > dueAt`.
 */
export function liveSnoozeOptions(dueAtMs: number, nowMs: number): SnoozeMinutes[] {
  return SNOOZE_MINUTES.filter(minutes =>
    minutes === 0 ? nowMs <= dueAtMs : dueAtMs - minutes * 60_000 > nowMs,
  );
}

/** Human-readable due-time label for a reminder row. */
export function reminderDueLabel(dueAtMs: number, nowMs: number): string {
  if (dueAtMs <= nowMs) {
    return 'overdue';
  }
  const diffMs = dueAtMs - nowMs;
  const diffMin = Math.round(diffMs / 60_000);
  if (diffMin < 1) {
    return 'in < 1 min';
  }
  if (diffMin < 60) {
    return `in ${diffMin} min`;
  }
  const diffHours = Math.round(diffMin / 60);
  if (diffHours < 24) {
    return `in ${diffHours}h`;
  }
  const date = new Date(dueAtMs);
  return date.toLocaleDateString(undefined, {month: 'short', day: 'numeric'});
}

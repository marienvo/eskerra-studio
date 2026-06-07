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
  removeState: ReminderRemoveState;
};

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
  prev: ReminderPaneRow | undefined,
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
    // Preserve in-flight UI state across index re-reads; reset only to idle
    // when the daemon confirms `removed` (row disappears) or the index no
    // longer contains this id (also gone). A `stale` daemon state clears
    // `removing` back to idle so the UI shows the stale affordance.
    removeState: resolveRemoveState(prev?.removeState, reminder.state),
  };
}

/** Note display name derived from the vault-relative path (filename without extension). */
export function reminderNoteName(vaultRelativePath: string): string {
  const parts = vaultRelativePath.split('/');
  const filename = parts[parts.length - 1] ?? vaultRelativePath;
  return filename.endsWith('.md') ? filename.slice(0, -3) : filename;
}

/** Human-readable due-time label for a reminder row. */
export function reminderDueLabel(dueAtMs: number, nowMs: number): string {
  if (dueAtMs <= nowMs) {
    return 'overdue';
  }
  const diffMs = dueAtMs - nowMs;
  const diffMin = Math.round(diffMs / 60_000);
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

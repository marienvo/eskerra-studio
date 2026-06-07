/**
 * TypeScript mirror of the Rust `eskerra-reminder-core` index schema (ADR §3,
 * locked at schemaVersion 1). The daemon writes this file; the app treats it
 * as read-only.
 */

export type ReminderState = 'scheduled' | 'due' | 'notified' | 'stale';

export type UiCaretHint = {
  utf16Offset: number;
};

/** One reminder entry — camelCase matches the Rust `#[serde(rename_all = "camelCase")]`. */
export type Reminder = {
  id: string;
  noteUri: string;
  vaultRelativePath: string;
  normalizedTokenText: string;
  occurrenceOrdinal: number;
  dueAtMs: number;
  fireAtMs: number;
  state: ReminderState;
  lastNotifiedMs: number | null;
  tokenByteFrom: number;
  tokenByteTo: number;
  uiCaretHint: UiCaretHint | null;
  contextAnchor: string;
  duplicateCount: number;
  scanFingerprint: string;
};

/** Top-level index document — one per vault, keyed by `vaultHash`. */
export type ReminderIndex = {
  schemaVersion: number;
  vaultHash: string;
  vaultRelativeRootMarker: string | null;
  generatedAtMs: number;
  reminders: Reminder[];
};

/** Parse and validate the index JSON. Returns null on any parse/schema error. */
export function parseReminderIndex(json: string): ReminderIndex | null {
  try {
    const parsed = JSON.parse(json) as ReminderIndex;
    if (typeof parsed !== 'object' || parsed === null) return null;
    if (parsed.schemaVersion !== 1) return null;
    if (!Array.isArray(parsed.reminders)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** True when any reminder in the list is due (now ≥ dueAtMs) and not stale. */
export function hasDueRemindersNow(reminders: readonly Reminder[], nowMs: number): boolean {
  return reminders.some(r => r.state !== 'stale' && nowMs >= r.dueAtMs);
}

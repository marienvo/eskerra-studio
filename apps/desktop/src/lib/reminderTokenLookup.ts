import {
  collectDateTokenSpansInLine,
  formatDateToken,
  parseDateTokenSpan,
  type DateTokenValue,
} from '../editor/noteEditor/dateToken/dateToken';
import type {ReminderRemoveResult} from '../hooks/useReminderPane';
import type {Reminder} from './reminderIndex';
import {absolutePathToReminderFileUri} from './todayHub/reminderHubCellTarget';

export type ReminderStrikeResult =
  | 'removed'
  | 'stale'
  | 'remove-unavailable'
  | 'not-found';

/** Canonical on-disk token text for a live reminder (matches Rust scanner). */
export function normalizedTokenTextFromValue(value: DateTokenValue): string {
  const {year, month, day, hour, minute} = value;
  return formatDateToken({year, month, day, hour, minute});
}

function countPriorMatchingTokensOnLine(
  line: string,
  lineStart: number,
  offset: number,
  normalizedTokenText: string,
): number {
  let count = 0;
  for (const span of collectDateTokenSpansInLine(line)) {
    if (span.token.startsWith('@~~')) {
      continue;
    }
    const value = parseDateTokenSpan(span.token);
    if (!value) {
      continue;
    }
    if (normalizedTokenTextFromValue(value) !== normalizedTokenText) {
      continue;
    }
    if (lineStart + span.tokenStartInLine < offset) {
      count++;
    }
  }
  return count;
}

/**
 * Counts prior live tokens with the same normalized text in document order.
 * Mirrors `occurrence_ordinal` in `eskerra-reminder-core` scanner.
 */
export function occurrenceOrdinalAtOffset(
  text: string,
  offset: number,
  normalizedTokenText: string,
): number {
  let ordinal = 0;
  let lineStart = 0;
  const lines = text.split('\n');
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex]!;
    ordinal += countPriorMatchingTokensOnLine(
      line,
      lineStart,
      offset,
      normalizedTokenText,
    );
    lineStart += line.length + (lineIndex < lines.length - 1 ? 1 : 0);
  }
  return ordinal;
}

/**
 * Resolves a single index entry for a live token. Returns null when ambiguous
 * or missing (fail-safe, parallel daemon duplicate handling).
 */
export function findReminderForLiveToken(
  reminders: readonly Reminder[],
  noteUri: string,
  normalizedTokenText: string,
  occurrenceOrdinal: number,
): Reminder | null {
  const matches = reminders.filter(
    r =>
      r.noteUri === noteUri
      && r.normalizedTokenText === normalizedTokenText
      && r.occurrenceOrdinal === occurrenceOrdinal,
  );
  if (matches.length !== 1) {
    return null;
  }
  return matches[0]!;
}

export function findReminderForTokenAtOffset(
  reminders: readonly Reminder[],
  noteUri: string,
  documentText: string,
  tokenOffset: number,
  value: DateTokenValue,
): Reminder | null {
  const normalized = normalizedTokenTextFromValue(value);
  const ordinal = occurrenceOrdinalAtOffset(
    documentText,
    tokenOffset,
    normalized,
  );
  return findReminderForLiveToken(
    reminders,
    noteUri,
    normalized,
    ordinal,
  );
}

/** Strike a live token through the daemon single-writer path (ADR 003). */
export async function requestReminderStrikeViaDaemon(
  reminders: readonly Reminder[],
  noteUri: string,
  documentText: string,
  tokenOffset: number,
  value: DateTokenValue,
  removeReminder: (
    noteUri: string,
    reminderId: string,
  ) => Promise<ReminderRemoveResult>,
): Promise<ReminderStrikeResult> {
  const daemonNoteUri = absolutePathToReminderFileUri(noteUri);
  const match = findReminderForTokenAtOffset(
    reminders,
    daemonNoteUri,
    documentText,
    tokenOffset,
    value,
  );
  if (!match) {
    return 'not-found';
  }
  return removeReminder(daemonNoteUri, match.id);
}

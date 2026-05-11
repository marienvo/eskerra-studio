/** Stable row id for in-place rename-link progress updates. */
export const SESSION_NOTIF_RENAME_PROGRESS_ID = 'session-notif-rename-progress';

export type SessionNotificationSource =
  | 'status'
  | 'manualGitSync'
  | 'renameProgress'
  | 'diskConflictBlocking'
  | 'diskConflictSoft';

export type SessionNotificationTone = 'info' | 'error';

export type SessionNotification = {
  id: string;
  tone: SessionNotificationTone;
  text: string;
  source: SessionNotificationSource;
};

export function statusMessageSignature(
  tone: SessionNotificationTone,
  text: string,
): string {
  return `${tone}\0${text}`;
}

export function shouldSkipDuplicateStatusAppend(
  lastAppendedSignature: string | null,
  tone: SessionNotificationTone,
  text: string,
): boolean {
  if (lastAppendedSignature == null) {
    return false;
  }
  return lastAppendedSignature === statusMessageSignature(tone, text);
}

export function upsertRenameProgressItem(
  items: readonly SessionNotification[],
  text: string,
): SessionNotification[] {
  const row: SessionNotification = {
    id: SESSION_NOTIF_RENAME_PROGRESS_ID,
    tone: 'info',
    text,
    source: 'renameProgress',
  };
  const idx = items.findIndex(i => i.id === SESSION_NOTIF_RENAME_PROGRESS_ID);
  if (idx === -1) {
    return [...items, row];
  }
  const next = [...items];
  next[idx] = row;
  return next;
}

/** Copy for the blocking disk conflict strip (session notification row). */
export const DISK_CONFLICT_BLOCKING_NOTIF_TEXT =
  'This note was changed on disk while you have unsaved edits. Saving is paused until you choose how to resolve it.';

/** Copy for the soft disk conflict info strip. */
export const DISK_CONFLICT_SOFT_NOTIF_TEXT =
  'A version on disk differs from your unsaved draft. Your edits stay primary until you save.';

export function appendNotification(
  items: readonly SessionNotification[],
  item: SessionNotification,
): SessionNotification[] {
  return [...items, item];
}

export function removeNotificationById(
  items: readonly SessionNotification[],
  id: string,
): SessionNotification[] {
  return items.filter(i => i.id !== id);
}

/**
 * Pure helpers for toast visibility lifecycle, decoupled from the notification
 * items list so toasts can expire without removing items from the drawer.
 */

export type DiffToastIdsArgs = {
  /** IDs that have already been shown (or expired) — not shown again. */
  seenIds: ReadonlySet<string>;
  /** IDs currently visible as a toast. */
  liveIds: ReadonlySet<string>;
  /** IDs present in the current notification items list. */
  currentIds: readonly string[];
};

export type DiffToastIdsResult = {
  /** New IDs that should start showing (and start a timer). */
  appeared: string[];
  /** IDs that were live but are no longer in `currentIds` — drop them immediately. */
  removed: string[];
};

/**
 * Compares the current notification IDs against the set of already-seen and
 * currently-live toast IDs to determine which toasts to start and which to drop.
 *
 * - `appeared`: in `currentIds` but not yet in `seenIds` → show toast + start timer.
 * - `removed`: in `liveIds` but absent from `currentIds` → notif was dismissed elsewhere,
 *   drop the toast immediately.
 */
export function diffToastIds(args: DiffToastIdsArgs): DiffToastIdsResult {
  const {seenIds, liveIds, currentIds} = args;
  const currentSet = new Set(currentIds);

  const appeared: string[] = [];
  for (const id of currentIds) {
    if (!seenIds.has(id)) {
      appeared.push(id);
    }
  }

  const removed: string[] = [];
  for (const id of liveIds) {
    if (!currentSet.has(id)) {
      removed.push(id);
    }
  }

  return {appeared, removed};
}

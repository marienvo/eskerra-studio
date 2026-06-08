/**
 * Today Hub canvas in-memory row buffer (`localRowSections`) pruning.
 *
 * The canvas keeps a per-row column buffer for the cell being edited. Once a row has been
 * opened, its buffer must be released when the row is no longer active (and not mid-persist) so
 * the preview falls back to the disk-backed `inboxContentByUri` cache — see `TodayHubCanvas`.
 */

/** Row column buffers keyed by normalized row URI. */
export type TodayHubLocalRowSections = Record<string, string[]>;

/**
 * Return a buffer map containing only the rows in `retain`. Returns the same reference when no
 * entry would be dropped, so callers can skip a state update.
 */
export function retainTodayHubLocalRowSections(
  prev: TodayHubLocalRowSections,
  retain: ReadonlySet<string>,
): TodayHubLocalRowSections {
  let changed = false;
  const next: TodayHubLocalRowSections = {};
  for (const [uri, sections] of Object.entries(prev)) {
    if (retain.has(uri)) {
      next[uri] = sections;
    } else {
      changed = true;
    }
  }
  return changed ? next : prev;
}

import type {TodayHubReminderCellOpenResult} from './reminderHubCellTarget';

/**
 * Canvas fills this object so the workspace can flush hub saves and (for future reconcile) read live merges.
 */
export type TodayHubWorkspaceBridge = {
  flushPendingEdits: () => Promise<void>;
  /** The hub's `Today.md` URI while a canvas is mounted; `null` when idle. */
  getTodayNoteUri: () => string | null;
  getLiveRowUri: () => string | null;
  getLiveRowMergedMarkdown: () => string | null;
  reloadLiveRowFromDisk: (diskBody: string) => void;
  /** True when a debounced hub row persist is scheduled or in flight (see TodayHubCanvas). */
  hasPendingHubFlush: () => boolean;
  /**
   * Normalizes markdown for every non-empty day column on hub canvas week rows, then persists
   * changed row files (see `cleanTodayHubRowColumns` + `persistTodayHubRow`).
   */
  cleanHubPageDayColumns: () => Promise<void>;
  /**
   * Opens the hub cell holding a reminder: maps the full-file caret to the column + line start, then
   * focuses the cell editor and scrolls the week row into view. `null` until a canvas is mounted.
   * Returns `out-of-window` when the row's week is not rendered (caller opens the plain note instead).
   */
  openReminderCell:
    | ((rowUri: string, caretUtf16: number) => Promise<TodayHubReminderCellOpenResult>)
    | null;
};

export function createIdleTodayHubWorkspaceBridge(): TodayHubWorkspaceBridge {
  return {
    flushPendingEdits: async () => {},
    getTodayNoteUri: () => null,
    getLiveRowUri: () => null,
    getLiveRowMergedMarkdown: () => null,
    reloadLiveRowFromDisk: () => {},
    hasPendingHubFlush: () => false,
    cleanHubPageDayColumns: async () => {},
    openReminderCell: null,
  };
}

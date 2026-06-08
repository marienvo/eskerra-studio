/**
 * Routing helpers for opening a reminder that lives inside a Today Hub cell.
 *
 * A hub row is a `YYYY-MM-DD.md` week-note that sits beside the hub's `Today.md`. A reminder token in
 * such a row resolves (via `reminders_resolve_position`) to a caret offset in the **full** week-note
 * markdown, but the hub cell editor displays a single column section split on `::today-section::`.
 * These pure helpers (a) recognise that a reminder note path is a hub row, and (b) map the full-file
 * caret to the column + the start of the line containing the token inside that column's section.
 */
import {
  parseTodayHubRowStemToLocalCalendarDate,
  splitTodayRowIntoColumnSpans,
  todayHubDirectoryUriFromTodayNoteUri,
  todayHubFolderLabelFromTodayNoteUri,
} from '@eskerra/core';

import {normalizeEditorDocUri} from '../editorDocumentHistory';

/** Decode a `file://` reminder note URI into an absolute filesystem path, or `null` if not one. */
export function reminderFileUriToAbsolutePath(noteUri: string): string | null {
  let url: URL;
  try {
    url = new URL(noteUri);
  } catch {
    return null;
  }

  if (url.protocol !== 'file:' || (url.host !== '' && url.host !== 'localhost')) {
    return null;
  }
  if (url.search !== '' || url.hash !== '') {
    return null;
  }

  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }

  return decodedPath.startsWith('/') ? decodedPath : null;
}

export type TodayHubRowMatch = {
  /** The hub's `Today.md` URI (used to switch the active hub workspace). */
  hubTodayNoteUri: string;
  /** The week-note row URI, normalized for editor-doc comparisons. */
  rowUri: string;
};

function stripTrailingSlashes(s: string): string {
  let end = s.length;
  while (end > 0 && s.charCodeAt(end - 1) === 47 /* '/' */) {
    end -= 1;
  }
  return s.slice(0, end);
}

function parentDirUri(uri: string): string {
  const norm = stripTrailingSlashes(normalizeEditorDocUri(uri));
  const i = norm.lastIndexOf('/');
  return i < 0 ? '' : norm.slice(0, i);
}

function stemFromUri(uri: string): string {
  const norm = normalizeEditorDocUri(uri);
  const base = norm.slice(norm.lastIndexOf('/') + 1);
  return base.replace(/\.md$/i, '');
}

/**
 * Returns the hub a reminder note path belongs to when it is a `YYYY-MM-DD.md` row beside a hub's
 * `Today.md`, or `null` otherwise. Whether that week actually renders in the hub's window (and so
 * whether to fall back to opening the plain note) is decided by the canvas against its live row set.
 */
export function findTodayHubRowMatch(
  rowFilePath: string,
  hubTodayNoteUris: readonly string[],
): TodayHubRowMatch | null {
  if (parseTodayHubRowStemToLocalCalendarDate(stemFromUri(rowFilePath)) == null) {
    return null;
  }
  const rowDir = parentDirUri(rowFilePath);
  for (const hub of hubTodayNoteUris) {
    if (normalizeEditorDocUri(todayHubDirectoryUriFromTodayNoteUri(hub)) === rowDir) {
      return {hubTodayNoteUri: hub, rowUri: normalizeEditorDocUri(rowFilePath)};
    }
  }
  return null;
}

/**
 * Result of asking the live hub canvas to open a reminder cell. `out-of-window` means the row's week
 * is not rendered by the hub (caller falls back to opening the plain note).
 */
/**
 * Hub display title (its folder name) for a reminder whose `file://` note URI is a `YYYY-MM-DD.md`
 * row beside a hub `Today.md`, or `null` otherwise. Used to label notifications with the hub name
 * instead of the bare date stem. Mirrors the daemon's `today_hub_row_title`.
 */
export function todayHubRowTitleForNoteUri(
  noteUri: string,
  hubTodayNoteUris: readonly string[],
): string | null {
  const path = reminderFileUriToAbsolutePath(noteUri);
  if (path == null) {
    return null;
  }
  const match = findTodayHubRowMatch(path, hubTodayNoteUris);
  return match ? todayHubFolderLabelFromTodayNoteUri(match.hubTodayNoteUri) : null;
}

export type TodayHubReminderCellOpenResult = 'handled' | 'out-of-window';

export type TodayHubCellCaretTarget = {
  /** Zero-based column index of the cell that contains the caret. */
  col: number;
  /** UTF-16 offset of the start of the caret's line within that column's section string. */
  sectionCaret: number;
};

/**
 * Maps a full-file caret offset (CRLF-normalized, as returned by the reminder resolver) to the cell
 * column and the start of the line containing it inside that column's section. Snapping to line start
 * keeps placement robust against the small offset drift that column sanitisation can introduce.
 */
export function mapFullFileCaretToHubCellLineStart(
  rowMarkdown: string,
  columnCount: number,
  caretUtf16: number,
): TodayHubCellCaretTarget {
  const spans = splitTodayRowIntoColumnSpans(rowMarkdown, columnCount);
  let col = 0;
  for (let i = 0; i < spans.length; i++) {
    const nextStart = i + 1 < spans.length ? spans[i + 1].sourceStart : Infinity;
    if (spans[i].sourceStart <= caretUtf16 && caretUtf16 < nextStart) {
      col = i;
      break;
    }
    if (spans[i].sourceStart <= caretUtf16) {
      col = i;
    }
  }
  const span = spans[col];
  const rel = Math.max(0, Math.min(caretUtf16 - span.sourceStart, span.section.length));
  const lineStart = span.section.lastIndexOf('\n', rel - 1) + 1;
  return {col, sectionCaret: lineStart};
}

import {MARKDOWN_EXTENSION} from './vaultLayout';
import {
  collapseAsciiWhitespaceRunsToSpace,
  replaceDashUnderscoreRunsWithSpace,
  stripInboxIllegalFilenameChars,
  trimLeadingDotsAndSpaces,
  trimTrailingDotsAndSpaces,
} from './stringScanners';

export function stemFromMarkdownFileName(fileName: string): string {
  return fileName.endsWith(MARKDOWN_EXTENSION)
    ? fileName.slice(0, -MARKDOWN_EXTENSION.length)
    : fileName;
}

function titleFromNoteName(fileName: string): string {
  const baseName = stemFromMarkdownFileName(fileName);

  return replaceDashUnderscoreRunsWithSpace(baseName).trim() || 'Untitled entry';
}

/** Human-readable title from an inbox markdown filename. */

export function getNoteTitle(noteName: string): string {
  return titleFromNoteName(noteName);
}

export function sanitizeInboxNoteStem(rawName: string): string | null {
  const withoutControlChars = Array.from(rawName.trim())
    .filter(ch => ch >= ' ' && ch !== '\u007f')
    .join('');
  const normalized = trimTrailingDotsAndSpaces(
    trimLeadingDotsAndSpaces(
      collapseAsciiWhitespaceRunsToSpace(stripInboxIllegalFilenameChars(withoutControlChars)),
    ),
  );
  return normalized === '' ? null : normalized;
}

export function sanitizeFileName(rawName: string): string {
  return sanitizeInboxNoteStem(rawName) ?? `note-${Date.now()}`;
}

export function pickNextInboxMarkdownFileName(
  baseStem: string,
  occupiedMarkdownNames: ReadonlySet<string>,
): string {
  let candidate = `${baseStem}${MARKDOWN_EXTENSION}`;
  let nextSuffix = 2;

  while (occupiedMarkdownNames.has(candidate)) {
    candidate = `${baseStem}-${nextSuffix}${MARKDOWN_EXTENSION}`;
    nextSuffix += 1;
  }

  return candidate;
}

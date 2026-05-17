import {ATTACHMENTS_DIRECTORY_NAME, ASSETS_DIRECTORY_NAME} from '../vaultLayout';
import {
  collapseAsciiWhitespaceRunsToSpace,
  collapseRunsOfChar,
  toAsciiLowercase,
  trimAsciiWhitespace,
  trimLeadingChars,
  trimTrailingChars,
} from '../stringScanners';

/** Lowercase image extensions we accept for inbox attachments (leading dot). */

export const ATTACHMENT_IMAGE_EXTENSIONS: readonly string[] = [
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
];

const EXTENSION_SET = new Set(ATTACHMENT_IMAGE_EXTENSIONS);

/**
 * Normalizes a file extension to a lowercase form with a leading dot.
 * Returns null if the extension is not in the allowed image set.
 */

export function normalizeImageFileExtension(ext: string): string | null {
  const trimmed = ext.trim().toLowerCase();
  if (trimmed === '') {
    return null;
  }
  const withDot = trimmed.startsWith('.') ? trimmed : `.${trimmed}`;
  return EXTENSION_SET.has(withDot) ? withDot : null;
}

/**
 * Maps common clipboard / MIME image types to a file extension.
 */

export function imageMimeToExtension(mime: string): string | null {
  const m = mime.trim().toLowerCase();
  if (m === 'image/png') {
    return '.png';
  }
  if (m === 'image/jpeg' || m === 'image/jpg') {
    return '.jpg';
  }
  if (m === 'image/gif') {
    return '.gif';
  }
  if (m === 'image/webp') {
    return '.webp';
  }
  if (m === 'image/svg+xml') {
    return '.svg';
  }
  return null;
}

/**
 * Strips a path to a base file name (last segment), then sanitizes the stem for attachment use.
 * Removes directory separators and problematic characters; falls back if empty.
 */

const ATTACHMENT_EDGE_TRIM = new Set(['-', '_']);

export function sanitizeAttachmentBaseName(rawName: string): string {
  let cleaned = '';
  for (let i = 0; i < rawName.length; i++) {
    const c = rawName[i]!;
    if (c !== '/' && c !== '\\') {
      cleaned += c;
    }
  }
  const base = trimAsciiWhitespace(cleaned);
  const dot = base.lastIndexOf('.');
  const withoutExt = dot >= 0 ? base.slice(0, dot) : base;
  const lower = toAsciiLowercase(withoutExt);
  let kept = '';
  for (let i = 0; i < lower.length; i++) {
    const c = lower.charCodeAt(i);
    const ch = lower[i]!;
    if ((c >= 48 && c <= 57) || (c >= 97 && c <= 122) || c === 45 || c === 95 || c === 32) {
      kept += ch;
    }
  }
  const spaced = trimAsciiWhitespace(collapseAsciiWhitespaceRunsToSpace(kept));
  const hyphenated = spaced.includes(' ') ? spaced.split(' ').join('-') : spaced;
  const collapsed = collapseRunsOfChar(hyphenated, '-');
  const normalized = trimLeadingChars(trimTrailingChars(collapsed, ATTACHMENT_EDGE_TRIM), ATTACHMENT_EDGE_TRIM);
  return normalized || 'image';
}

/**
 * Builds a stored attachment file name: `{stem}-{uniqueToken}{extension}`.
 * `extension` must include the leading dot (e.g. `.png`).
 */

export function buildAttachmentFileName(
  stem: string,
  extensionWithDot: string,
  uniqueToken: string,
): string {
  const ext =
    extensionWithDot.startsWith('.') ? extensionWithDot.toLowerCase() : `.${extensionWithDot.toLowerCase()}`;
  if (!EXTENSION_SET.has(ext)) {
    throw new Error(`Unsupported attachment extension: ${ext}`);
  }
  const safeStem = stem.trim() || 'image';
  const token = uniqueToken.trim() || '0';
  return `${safeStem}-${token}${ext}`;
}

/**
 * Markdown `src` for an attachment when the note lives at `Vault/Inbox/note.md`.
 * Single source: path is always relative to the inbox markdown file.
 */

export function inboxNoteRelativeAttachmentDir(): string {
  return `../${ASSETS_DIRECTORY_NAME}/${ATTACHMENTS_DIRECTORY_NAME}`;
}

/**
 * Full relative path for Markdown image syntax from an inbox note to a file in Assets/Attachments.
 */

export function buildInboxRelativeAttachmentMarkdownPath(attachmentFileName: string): string {
  if (attachmentFileName.includes('/') || attachmentFileName.includes('\\')) {
    throw new Error('Attachment file name must not contain path separators');
  }
  if (attachmentFileName === '.' || attachmentFileName === '..') {
    throw new Error('Invalid attachment file name');
  }
  return `${inboxNoteRelativeAttachmentDir()}/${attachmentFileName}`;
}

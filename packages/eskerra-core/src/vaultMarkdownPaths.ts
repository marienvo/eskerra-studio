import {
  isVaultTreeHardExcludedDirectoryName,
  isVaultTreeIgnoredEntryName,
} from './vaultVisibility';
import {
  isSyncConflictFileName,
  MARKDOWN_EXTENSION,
  normalizeVaultBaseUri,
} from './vaultLayout';
import {stripTrailingSlashes, trimAndUnixSlashes} from './stringScanners';

function normalizeSlashes(uri: string): string {
  return trimAndUnixSlashes(uri);
}

/**
 * Validates that `noteUri` is a user markdown file under `vaultRootUri` (nested allowed), then returns
 * the normalized URI string for CRUD.
 */
export function assertVaultMarkdownNoteUriForCrud(
  vaultRootUri: string,
  noteUri: string,
): string {
  const base = stripTrailingSlashes(normalizeSlashes(normalizeVaultBaseUri(vaultRootUri)));
  const uri = normalizeSlashes(noteUri);
  if (uri !== base && !uri.startsWith(`${base}/`)) {
    throw new Error('Note is outside the vault.');
  }
  const relative = uri === base ? '' : uri.slice(base.length + 1);
  if (!relative) {
    throw new Error('Invalid note path.');
  }
  const segments = relative.split('/').filter(Boolean);
  if (segments.length === 0) {
    throw new Error('Invalid note path.');
  }
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i]!;
    if (isVaultTreeIgnoredEntryName(seg)) {
      throw new Error('Invalid note path.');
    }
    if (isVaultTreeHardExcludedDirectoryName(seg)) {
      throw new Error('Note path is in an excluded folder.');
    }
  }
  const fileName = segments[segments.length - 1]!;
  if (!fileName.endsWith(MARKDOWN_EXTENSION)) {
    throw new Error('Only vault markdown notes can be changed here.');
  }
  if (isSyncConflictFileName(fileName)) {
    throw new Error('Cannot change sync conflict notes with this action.');
  }
  if (isVaultTreeIgnoredEntryName(fileName)) {
    throw new Error('Invalid note path.');
  }
  return uri;
}

/**
 * Same validation as {@link assertVaultMarkdownNoteUriForCrud}; returns normalized URI or `null`.
 */
export function tryAssertVaultMarkdownNoteUriForCrud(
  vaultRootUri: string,
  noteUri: string,
): string | null {
  try {
    return assertVaultMarkdownNoteUriForCrud(vaultRootUri, noteUri);
  } catch {
    return null;
  }
}

/**
 * Validates a `.md` URI under the vault for resolving relative / path-shaped wiki links.
 * Does not apply {@link isVaultTreeIgnoredEntryName} (so existing targets under any segment name can resolve);
 * still rejects hard-excluded product directories ({@link VAULT_TREE_HARD_EXCLUDED_DIRECTORY_NAMES}).
 * Creating or editing notes uses {@link assertVaultMarkdownNoteUriForCrud}, which rejects dot-prefixed segments.
 */
export function tryAssertVaultMarkdownNoteUriForRelativeMarkdownLink(
  vaultRootUri: string,
  noteUri: string,
): string | null {
  const base = stripTrailingSlashes(normalizeSlashes(normalizeVaultBaseUri(vaultRootUri)));
  const uri = normalizeSlashes(noteUri);
  if (uri !== base && !uri.startsWith(`${base}/`)) {
    return null;
  }
  const relative = uri === base ? '' : uri.slice(base.length + 1);
  if (!relative) {
    return null;
  }
  const segments = relative.split('/').filter(Boolean);
  if (segments.length === 0) {
    return null;
  }
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i]!;
    if (isVaultTreeHardExcludedDirectoryName(seg)) {
      return null;
    }
  }
  const fileName = segments[segments.length - 1]!;
  if (!fileName.toLowerCase().endsWith(MARKDOWN_EXTENSION.toLowerCase())) {
    return null;
  }
  return uri;
}

/**
 * Validates a vault directory path for tree CRUD (rename / delete folder). Does not require `.md`;
 * rejects vault root, ignored segments, and hard-excluded directories.
 */
export function assertVaultTreeDirectoryUriForCrud(
  vaultRootUri: string,
  dirUri: string,
): string {
  const base = stripTrailingSlashes(normalizeSlashes(normalizeVaultBaseUri(vaultRootUri)));
  const uri = stripTrailingSlashes(normalizeSlashes(dirUri));
  if (uri !== base && !uri.startsWith(`${base}/`)) {
    throw new Error('Path is outside the vault.');
  }
  const relative = uri === base ? '' : uri.slice(base.length + 1);
  if (!relative) {
    throw new Error('Cannot change the vault root folder.');
  }
  const segments = relative.split('/').filter(Boolean);
  for (const seg of segments) {
    if (isVaultTreeIgnoredEntryName(seg)) {
      throw new Error('Invalid path.');
    }
    if (isVaultTreeHardExcludedDirectoryName(seg)) {
      throw new Error('Path is in an excluded folder.');
    }
  }
  return trimAndUnixSlashes(dirUri);
}

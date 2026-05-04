/**
 * Pure helpers for keeping `inboxContentByUri` consistent with editor and disk state.
 * See specs/architecture/desktop-editor.md (cache consistency invariant).
 */

import {normalizeVaultBaseUri, trimTrailingSlashes} from '@eskerra/core';

import {normalizeEditorDocUri} from '../lib/editorDocumentHistory';

function normalizeMarkdownLineEndingsToLf(markdown: string): string {
  return markdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * Canonical shape for vault markdown reads and reconcile compares: LF line endings, one trailing `\n` stripped.
 * Matches historic `raw.replace(/\n$/, '')` after normalizing CRLF / lone CR (e.g. after git or editor quirks).
 */
export function normalizeVaultMarkdownDiskRead(raw: string): string {
  return normalizeMarkdownLineEndingsToLf(raw).replace(/\n$/, '');
}

export type LastPersistedNote = {uri: string; markdown: string};

/**
 * Deferred outgoing persist (note switch): skip the chained save when the body cache for that URI
 * no longer matches the markdown snapshot captured at leave time (user re-opened the note and
 * edited, or another path advanced the cache).
 */
export function shouldSkipOutgoingPersistAfterNoteLeave(
  cached: string | undefined,
  leaveSnapshotMarkdown: string,
): boolean {
  return cached !== undefined && cached !== leaveSnapshotMarkdown;
}

/**
 * Before writing disk for a deferred outgoing save, skip when the cache has diverged from both the
 * leave snapshot and the final markdown after `persistTransientMarkdownImages` (for example image
 * URL rewrites merged into the cache).
 */
export function shouldSkipOutgoingPersistBeforeWrite(
  cached: string | undefined,
  leaveSnapshotMarkdown: string,
  markdownToWrite: string,
): boolean {
  return (
    cached !== undefined &&
    cached !== leaveSnapshotMarkdown &&
    cached !== markdownToWrite
  );
}

/**
 * After a successful deferred outgoing save, merge disk-known markdown into the cache unless the
 * user diverged in memory while the save was in flight.
 */
export function shouldMergeCacheAfterOutgoingPersist(
  cached: string | undefined,
  persistedMarkdown: string,
  leaveSnapshotMarkdown: string,
): boolean {
  return (
    cached === undefined ||
    cached === persistedMarkdown ||
    cached === leaveSnapshotMarkdown
  );
}

/** How to reconcile the open editor when disk content may have diverged. */
export type NoteDiskReconcileKind = 'noop' | 'reload_from_disk' | 'conflict';

/**
 * Returns a new cache map with `uri` set to `body`, or `null` if unchanged.
 */
export function mergeInboxNoteBodyIntoCache(
  prev: Record<string, string>,
  uri: string,
  body: string,
): Record<string, string> | null {
  if (Object.prototype.hasOwnProperty.call(prev, uri)) {
    const prevBody = prev[uri]!;
    if (
      prevBody === body ||
      normalizeVaultMarkdownDiskRead(prevBody) === normalizeVaultMarkdownDiskRead(body)
    ) {
      return null;
    }
  }
  return {...prev, [uri]: body};
}

/**
 * When opening a note that has a cache entry, prefer `lastPersisted` if it matches
 * the same URI and disagrees with the cache (disk-known wins over stale cache).
 */
export function resolveInboxCachedBodyForEditor(
  selectedUri: string,
  cached: string,
  lastPersisted: LastPersistedNote | null,
): {markdown: string; healedCache: boolean} {
  if (
    lastPersisted != null &&
    lastPersisted.uri === selectedUri &&
    normalizeVaultMarkdownDiskRead(lastPersisted.markdown) !== normalizeVaultMarkdownDiskRead(cached)
  ) {
    return {markdown: lastPersisted.markdown, healedCache: true};
  }
  return {markdown: cached, healedCache: false};
}

/**
 * Returns whether any path in a debounced watcher batch could affect `noteUri`
 * (same file, or a parent directory).
 * When `changedPaths` is empty, callers should treat it as a full vault refresh signal.
 */
export function fsChangePathsMayAffectUri(
  changedPaths: readonly string[],
  noteUri: string,
  vaultRoot: string,
): boolean {
  if (changedPaths.length === 0) {
    return true;
  }
  const u = normalizeEditorDocUri(noteUri);
  const root = trimTrailingSlashes(normalizeVaultBaseUri(vaultRoot));
  if (u !== root && !u.startsWith(`${root}/`)) {
    return false;
  }
  for (const raw of changedPaths) {
    const p = normalizeEditorDocUri(raw);
    if (!p) {
      continue;
    }
    if (p === u) {
      return true;
    }
    const prefix = trimTrailingSlashes(p);
    if (u.startsWith(`${prefix}/`)) {
      return true;
    }
  }
  return false;
}

/**
 * Loads markdown bodies for all refs into a new map, seeded from `seed`.
 * If the active note is in the list, uses `activeBody` instead of reading disk.
 * Entries already present in `seed` are preserved without re-reading.
 */
export async function loadVaultMarkdownBodiesWithSeed(
  fs: {readFile(uri: string, opts: {encoding: 'utf8'}): Promise<string>},
  refs: ReadonlyArray<{uri: string}>,
  seed: Readonly<Record<string, string>>,
  activeUri: string | null,
  activeBody: string,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {...seed};
  for (const {uri} of refs) {
    if (activeUri != null && uri === activeUri) {
      out[uri] = activeBody;
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(out, uri)) {
      continue;
    }
    try {
      const raw = await fs.readFile(uri, {encoding: 'utf8'});
      out[uri] = normalizeVaultMarkdownDiskRead(raw);
    } catch {
      out[uri] = '';
    }
  }
  return out;
}

export function removeInboxNoteBodyFromCache(
  prev: Record<string, string>,
  uri: string,
): Record<string, string> | null {
  if (!Object.prototype.hasOwnProperty.call(prev, uri)) {
    return null;
  }
  const next: Record<string, string> = {...prev};
  delete next[uri];
  return next;
}

/**
 * Decide how to merge external disk content into the open note.
 * - `noop`: disk matches what we already treat as persisted for this URI.
 * - `reload_from_disk`: disk changed and the editor is still aligned with last persist — safe reload.
 * - `conflict`: disk changed and the user has local edits since last persist — must not autosave over disk.
 */
export function classifyNoteDiskReconcile(input: {
  noteUri: string;
  lastPersisted: LastPersistedNote | null;
  diskMarkdown: string;
  localMarkdown: string;
}): NoteDiskReconcileKind {
  const {noteUri, lastPersisted, diskMarkdown, localMarkdown} = input;
  if (lastPersisted == null || lastPersisted.uri !== noteUri) {
    const localCanon = normalizeVaultMarkdownDiskRead(localMarkdown);
    if (diskMarkdown === localCanon) {
      return 'noop';
    }
    return 'reload_from_disk';
  }
  // `diskMarkdown` comes from `normalizeVaultMarkdownDiskRead(fs.readFile)` in workspace reconcile.
  const persistedNorm = normalizeVaultMarkdownDiskRead(lastPersisted.markdown);
  const diskChanged = diskMarkdown !== persistedNorm;
  if (!diskChanged) {
    return 'noop';
  }
  const localDirty =
    normalizeMarkdownLineEndingsToLf(localMarkdown) !==
    normalizeMarkdownLineEndingsToLf(lastPersisted.markdown);
  if (localDirty) {
    return 'conflict';
  }
  return 'reload_from_disk';
}

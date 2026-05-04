/**
 * Linear browser-style document stack for the vault markdown editor.
 * URIs are normalized (trim, backslashes to slashes) for comparisons.
 */

import {trimTrailingSlashes} from '@eskerra/core';

export type EditorDocumentHistoryState = {
  entries: string[];
  /** Position of the current slot; -1 when `entries` is empty. */
  index: number;
};

export function emptyEditorDocumentHistory(): EditorDocumentHistoryState {
  return {entries: [], index: -1};
}

export function normalizeEditorDocUri(uri: string): string {
  return uri.trim().replace(/\\/g, '/');
}

/** Same path-prefix rules as vault rename/move in the main window workspace. */
export function remapVaultUriPrefix(
  uri: string,
  oldPrefix: string,
  newPrefix: string,
): string | null {
  const u = uri.replace(/\\/g, '/');
  const o = trimTrailingSlashes(oldPrefix.replace(/\\/g, '/'));
  const n = trimTrailingSlashes(newPrefix.replace(/\\/g, '/'));
  if (u === o) {
    return n;
  }
  if (u.startsWith(`${o}/`)) {
    return `${n}/${u.slice(o.length + 1)}`;
  }
  return null;
}

export function pushEditorHistoryEntry(
  state: EditorDocumentHistoryState,
  uri: string,
): EditorDocumentHistoryState {
  const n = normalizeEditorDocUri(uri);
  if (!n) {
    return state;
  }
  const {entries} = state;
  let index = state.index;
  if (entries.length === 0) {
    return {entries: [n], index: 0};
  }
  if (index < 0 || index >= entries.length) {
    index = entries.length - 1;
  }
  if (entries[index] === n) {
    return state;
  }
  const base = entries.slice(0, index + 1);
  const last = base[base.length - 1];
  if (last === n) {
    return {entries: base, index: base.length - 1};
  }
  const nextEntries = [...base, n];
  return {entries: nextEntries, index: nextEntries.length - 1};
}

export function remapEditorHistoryPrefix(
  state: EditorDocumentHistoryState,
  oldPrefix: string,
  newPrefix: string,
): EditorDocumentHistoryState {
  if (state.entries.length === 0) {
    return state;
  }
  const nextEntries = state.entries.map(uri => {
    const mapped = remapVaultUriPrefix(uri, oldPrefix, newPrefix);
    return mapped ?? normalizeEditorDocUri(uri);
  });
  return {entries: nextEntries, index: state.index};
}

export function removeEditorHistoryUris(
  state: EditorDocumentHistoryState,
  shouldRemove: (normalizedUri: string) => boolean,
): EditorDocumentHistoryState {
  const {entries, index} = state;
  if (entries.length === 0) {
    return state;
  }

  const kept: {uri: string; oldIdx: number}[] = [];
  for (let i = 0; i < entries.length; i++) {
    const uri = normalizeEditorDocUri(entries[i]!);
    if (!shouldRemove(uri)) {
      kept.push({uri, oldIdx: i});
    }
  }

  if (kept.length === 0) {
    return {entries: [], index: -1};
  }

  const newEntries = kept.map(k => k.uri);
  const newIdx = resolveHistoryIndexAfterRemovals(
    entries,
    index,
    kept,
    shouldRemove,
  );

  return {entries: newEntries, index: newIdx};
}

function resolveHistoryIndexAfterRemovals(
  entries: string[],
  index: number,
  kept: {uri: string; oldIdx: number}[],
  shouldRemove: (normalizedUri: string) => boolean,
): number {
  const newEntriesLen = kept.length;
  if (index >= 0 && index < entries.length) {
    const curNorm = normalizeEditorDocUri(entries[index]!);
    if (!shouldRemove(curNorm)) {
      const at = kept.findIndex(k => k.oldIdx === index);
      return at >= 0 ? at : 0;
    }
    const before = kept.filter(k => k.oldIdx < index);
    const after = kept.filter(k => k.oldIdx > index);
    if (before.length > 0) {
      const pick = before[before.length - 1]!;
      return kept.findIndex(k => k.oldIdx === pick.oldIdx);
    }
    if (after.length > 0) {
      return kept.findIndex(k => k.oldIdx === after[0]!.oldIdx);
    }
    return 0;
  }
  return Math.min(Math.max(0, index), newEntriesLen - 1);
}

/**
 * Predicate: remove a markdown file path or anything under a deleted folder.
 */
export function vaultUriDeletedByTreeChange(
  normalizedUri: string,
  deletedMarkdownFileUris: ReadonlySet<string>,
  deletedFolderPrefixes: ReadonlyArray<string>,
): boolean {
  if (deletedMarkdownFileUris.has(normalizedUri)) {
    return true;
  }
  for (const folder of deletedFolderPrefixes) {
    const f = trimTrailingSlashes(folder.replace(/\\/g, '/'));
    if (!f) {
      continue;
    }
    if (normalizedUri === f || normalizedUri.startsWith(`${f}/`)) {
      return true;
    }
  }
  return false;
}

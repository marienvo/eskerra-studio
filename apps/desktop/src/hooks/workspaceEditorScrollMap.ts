import {trimTrailingSlashes} from '@eskerra/core';

import {
  normalizeEditorDocUri,
  remapVaultUriPrefix,
} from '../lib/editorDocumentHistory';

export type InboxEditorShellScrollDirective =
  | {kind: 'snapTop'}
  | {kind: 'restore'; top: number; left: number};

export function snapshotEditorShellScrollForOpenNote(
  scrollEl: HTMLDivElement | null,
  selectedUri: string | null,
  composingNewEntry: boolean,
  into: Map<string, {top: number; left: number}>,
): void {
  if (!scrollEl || !selectedUri || composingNewEntry) {
    return;
  }
  into.set(normalizeEditorDocUri(selectedUri), {
    top: scrollEl.scrollTop,
    left: scrollEl.scrollLeft,
  });
}

export function remapEditorShellScrollMapExact(
  map: Map<string, {top: number; left: number}>,
  fromUri: string,
  toUri: string,
): void {
  const from = normalizeEditorDocUri(fromUri);
  const to = normalizeEditorDocUri(toUri);
  if (from === to) {
    return;
  }
  const v = map.get(from);
  if (v === undefined) {
    return;
  }
  map.delete(from);
  map.set(to, v);
}

export function remapEditorShellScrollMapTreePrefix(
  map: Map<string, {top: number; left: number}>,
  oldPrefix: string,
  newPrefix: string,
): void {
  const oldP = trimTrailingSlashes(oldPrefix.replace(/\\/g, '/'));
  const newP = trimTrailingSlashes(newPrefix.replace(/\\/g, '/'));
  if (oldP === newP) {
    return;
  }
  const next = new Map<string, {top: number; left: number}>();
  for (const [k, v] of map) {
    const mapped = remapVaultUriPrefix(k, oldP, newP);
    next.set(mapped ?? k, v);
  }
  map.clear();
  for (const [k, v] of next) {
    map.set(k, v);
  }
}

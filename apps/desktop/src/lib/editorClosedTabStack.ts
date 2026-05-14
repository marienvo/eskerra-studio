/**
 * LIFO stack of user-closed editor tabs for "Reopen closed tab".
 * Each entry records the tab URI and its index in the strip when closed.
 * URIs are normalized; callers push in the order that makes the next pop()
 * return the most recently user-relevant closed tab first.
 */

import {normalizeVaultBaseUri, trimTrailingSlashes} from '@eskerra/core';

import {normalizeEditorDocUri} from './editorDocumentHistory';
import {normalizeOpenTabList} from './editorOpenTabs';

/** One closed tab row for the in-memory reopen stack. */
export type ClosedEditorTabRecord = {
  uri: string;
  index: number;
};

export function isEditorClosedTabReopenable(
  uri: string,
  vaultRoot: string | null,
  noteUriSet: ReadonlySet<string>,
): boolean {
  if (!vaultRoot) {
    return false;
  }
  const u = normalizeEditorDocUri(uri);
  const root = trimTrailingSlashes(normalizeVaultBaseUri(vaultRoot).replace(/\\/g, '/'));
  const inVault = u === root || u.startsWith(`${root}/`);
  if (!inVault) {
    return false;
  }
  return noteUriSet.has(u) || u.toLowerCase().endsWith('.md');
}

/**
 * Push tabs removed by "close other" so the first reopen is the rightmost removed tab.
 */
export function pushClosedTabsFromCloseOther(
  stack: string[],
  prevTabs: readonly string[],
  keepUri: string,
): void {
  const list = normalizeOpenTabList(prevTabs);
  const keep = normalizeEditorDocUri(keepUri);
  for (let i = list.length - 1; i >= 0; i--) {
    const u = list[i]!;
    if (u !== keep) {
      stack.push(u);
    }
  }
}

/**
 * Push tabs removed by "close all": selected first on reopen, then strip inward from the right.
 */
export function pushClosedTabsFromCloseAll(
  stack: string[],
  prevTabs: readonly string[],
  selectedNorm: string | null,
): void {
  const list = normalizeOpenTabList(prevTabs);
  if (list.length === 0) {
    return;
  }
  const sel =
    selectedNorm && list.includes(selectedNorm) ? selectedNorm : null;
  if (sel) {
    for (let i = list.length - 1; i >= 0; i--) {
      const u = list[i]!;
      if (u !== sel) {
        stack.push(u);
      }
    }
    stack.push(sel);
  } else {
    for (let i = list.length - 1; i >= 0; i--) {
      stack.push(list[i]!);
    }
  }
}

/**
 * Returns true when at least one entry in `stack` is reopenable given the current
 * vault root and known-note set. Does not mutate `stack`.
 */
export function hasReopenableClosedEditorTab(
  stack: readonly ClosedEditorTabRecord[],
  vaultRoot: string | null,
  noteUriSet: ReadonlySet<string>,
): boolean {
  if (!vaultRoot) {
    return false;
  }
  for (let i = stack.length - 1; i >= 0; i--) {
    if (isEditorClosedTabReopenable(stack[i]!.uri, vaultRoot, noteUriSet)) {
      return true;
    }
  }
  return false;
}

/**
 * Pops records from `stack` until a reopenable record is found or the stack is exhausted.
 * Mutates `stack` in place (LIFO pop semantics).
 */
export function popNextReopenableClosedTabRecord(
  stack: ClosedEditorTabRecord[],
  vaultRoot: string | null,
  noteUriSet: ReadonlySet<string>,
): {record: ClosedEditorTabRecord | null; popped: number} {
  let popped = 0;
  while (stack.length > 0) {
    const rec = stack.pop()!;
    popped += 1;
    if (isEditorClosedTabReopenable(rec.uri, vaultRoot, noteUriSet)) {
      return {record: rec, popped};
    }
  }
  return {record: null, popped};
}

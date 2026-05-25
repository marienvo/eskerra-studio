import {normalizeVaultBaseUri, trimTrailingSlashes} from '@eskerra/core';

import type {QuickOpenUsageScores} from './quickOpenUsageStore';

function normSlashes(p: string): string {
  return p.trim().replace(/\\/g, '/');
}

/**
 * Path from vault root to the note file, using `/` separators (for display and search).
 */
export function quickOpenVaultRelativePath(vaultRoot: string, noteUri: string): string {
  const base = trimTrailingSlashes(normSlashes(normalizeVaultBaseUri(vaultRoot)));
  const path = trimTrailingSlashes(normSlashes(noteUri));
  const prefix = `${base}/`;
  if (
    path.length >= prefix.length
    && path.slice(0, prefix.length).toLowerCase() === prefix.toLowerCase()
  ) {
    return path.slice(prefix.length);
  }
  const tail = path.split('/').pop() ?? path;
  return tail;
}

export type QuickOpenNoteRef = {name: string; uri: string};

export type QuickOpenUsageScoreLookup = (uri: string) => QuickOpenUsageScores;

function compareQuickOpenNoteRefs(a: QuickOpenNoteRef, b: QuickOpenNoteRef): number {
  const byName = a.name.localeCompare(b.name);
  if (byName !== 0) {
    return byName;
  }
  return a.uri.localeCompare(b.uri);
}

function compareQuickOpenNoteRefsByUsage(
  a: QuickOpenNoteRef,
  b: QuickOpenNoteRef,
  getScores: QuickOpenUsageScoreLookup,
): number {
  const scoresA = getScores(a.uri);
  const scoresB = getScores(b.uri);
  if (scoresA.favScore !== scoresB.favScore) {
    return scoresB.favScore - scoresA.favScore;
  }
  if (scoresA.globalScore !== scoresB.globalScore) {
    return scoresB.globalScore - scoresA.globalScore;
  }
  return compareQuickOpenNoteRefs(a, b);
}

/**
 * Case-insensitive substring match on note stem (`name`) or relative vault path (`uri`).
 * Results sorted by usage scores when `getScores` is provided, otherwise name then uri.
 * Empty or whitespace-only `query` returns **no** rows (palette stays empty until the user types).
 */
export function filterVaultNotesForQuickOpen(
  query: string,
  vaultRoot: string,
  refs: readonly QuickOpenNoteRef[],
  getScores?: QuickOpenUsageScoreLookup,
): QuickOpenNoteRef[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return [];
  }
  const sorted = [...refs].sort(compareQuickOpenNoteRefs);
  const matched = sorted.filter(r => {
    const rel = quickOpenVaultRelativePath(vaultRoot, r.uri).toLowerCase();
    return r.name.toLowerCase().includes(q) || rel.includes(q);
  });
  if (getScores === undefined) {
    return matched;
  }
  return [...matched].sort((a, b) => compareQuickOpenNoteRefsByUsage(a, b, getScores));
}

import {normalizeVaultBaseUri, trimTrailingSlashes} from '@eskerra/core';

import type {UsageScores} from './usageCounts/types';

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

export type QuickOpenUsageScoreLookup = (uri: string) => UsageScores;

/** Lower tier = better textual match quality. */
export type QuickOpenMatchTier = 0 | 1 | 2 | 3;

export function quickOpenMatchTier(
  ref: QuickOpenNoteRef,
  queryLower: string,
  vaultRoot: string,
): QuickOpenMatchTier | null {
  const q = queryLower.trim().toLowerCase();
  if (!q) {
    return null;
  }
  const nameLower = ref.name.toLowerCase();
  const relLower = quickOpenVaultRelativePath(vaultRoot, ref.uri).toLowerCase();
  if (nameLower.startsWith(q)) {
    return 0;
  }
  if (nameLower.includes(q)) {
    return 1;
  }
  if (relLower.startsWith(q)) {
    return 2;
  }
  if (relLower.includes(q)) {
    return 3;
  }
  return null;
}

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
  tierA: QuickOpenMatchTier,
  tierB: QuickOpenMatchTier,
  getScores: QuickOpenUsageScoreLookup,
): number {
  const scoresA = getScores(a.uri);
  const scoresB = getScores(b.uri);
  const aFav = scoresA.favScore > 0;
  const bFav = scoresB.favScore > 0;
  if (aFav !== bFav) {
    return aFav ? -1 : 1;
  }
  if (aFav && bFav) {
    if (scoresB.favScore !== scoresA.favScore) {
      return scoresB.favScore - scoresA.favScore;
    }
    if (scoresB.globalScore !== scoresA.globalScore) {
      return scoresB.globalScore - scoresA.globalScore;
    }
    return compareQuickOpenNoteRefs(a, b);
  }
  if (tierA !== tierB) {
    return tierA - tierB;
  }
  if (scoresB.globalScore !== scoresA.globalScore) {
    return scoresB.globalScore - scoresA.globalScore;
  }
  return compareQuickOpenNoteRefs(a, b);
}

/**
 * Case-insensitive substring match on note stem (`name`) or relative vault path (`uri`).
 * Results sorted by match tier, then usage scores when `getScores` is provided, otherwise
 * name then uri within each tier.
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
  const matched: {readonly ref: QuickOpenNoteRef; readonly tier: QuickOpenMatchTier}[] = [];
  for (const ref of refs) {
    const tier = quickOpenMatchTier(ref, q, vaultRoot);
    if (tier !== null) {
      matched.push({ref, tier});
    }
  }
  if (getScores === undefined) {
    matched.sort((a, b) => {
      if (a.tier !== b.tier) {
        return a.tier - b.tier;
      }
      return compareQuickOpenNoteRefs(a.ref, b.ref);
    });
    return matched.map(entry => entry.ref);
  }
  matched.sort((a, b) =>
    compareQuickOpenNoteRefsByUsage(a.ref, b.ref, a.tier, b.tier, getScores),
  );
  return matched.map(entry => entry.ref);
}

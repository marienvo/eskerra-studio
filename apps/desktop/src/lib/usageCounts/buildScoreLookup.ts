import {normalizeQueryKey} from './normalizeQueryKey';
import {queryRelationWeight} from './queryRelationWeight';
import type {ScoreLookupMemo, UsageScores} from './types';

/** Build once per query refresh; sums exact + prefix-related query keys. */
export function buildUsageScoreLookup(
  queryLower: string,
  globalCounts: Map<string, number>,
  byQueryCounts: Map<string, Map<string, number>>,
  normalizeItemKey: (key: string) => string,
  prefixQueryWeight: number,
  memo: ScoreLookupMemo,
): (itemKey: string) => UsageScores {
  const Q = normalizeQueryKey(queryLower);
  if (memo.query === Q && memo.fn !== null) {
    return memo.fn;
  }
  const favByItem = new Map<string, number>();
  if (Q.length > 0) {
    for (const [storedQ, counts] of byQueryCounts) {
      const weight = queryRelationWeight(Q, storedQ, prefixQueryWeight);
      if (weight === null) {
        continue;
      }
      for (const [k, n] of counts) {
        const add = n * weight;
        favByItem.set(k, (favByItem.get(k) ?? 0) + add);
      }
    }
  }
  const fn = (itemKey: string): UsageScores => {
    const key = normalizeItemKey(itemKey);
    return {
      favScore: favByItem.get(key) ?? 0,
      globalScore: globalCounts.get(key) ?? 0,
    };
  };
  memo.query = Q;
  memo.fn = fn;
  return fn;
}

export function invalidateScoreLookupCache(memo: ScoreLookupMemo): void {
  memo.query = null;
  memo.fn = null;
}

export function getUsageScores(
  itemKey: string,
  queryLower: string | undefined,
  globalCounts: Map<string, number>,
  byQueryCounts: Map<string, Map<string, number>>,
  normalizeItemKey: (key: string) => string,
  prefixQueryWeight: number,
  memo: ScoreLookupMemo,
): UsageScores {
  if (queryLower === undefined || queryLower.length === 0) {
    const key = normalizeItemKey(itemKey);
    return {favScore: 0, globalScore: globalCounts.get(key) ?? 0};
  }
  return buildUsageScoreLookup(
    queryLower,
    globalCounts,
    byQueryCounts,
    normalizeItemKey,
    prefixQueryWeight,
    memo,
  )(itemKey);
}

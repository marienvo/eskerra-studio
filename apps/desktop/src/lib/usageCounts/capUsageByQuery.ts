import {normalizeQueryKey} from './normalizeQueryKey';
import {capUsageCounts} from './capUsageCounts';

type UsageByQueryInput = Record<string, Record<string, number>>;

function mergeUsageCountRecords(
  into: Record<string, number>,
  from: Readonly<Record<string, number>>,
  normalizeItemKey: (key: string) => string,
): void {
  for (const [k, n] of Object.entries(from)) {
    if (
      typeof k !== 'string'
      || k.length === 0
      || typeof n !== 'number'
      || !Number.isFinite(n)
      || n <= 0
    ) {
      continue;
    }
    const nk = normalizeItemKey(k);
    into[nk] = Math.min(
      Number.MAX_SAFE_INTEGER,
      (into[nk] ?? 0) + Math.floor(n),
    );
  }
}

export function capUsageByQuery(
  raw: UsageByQueryInput,
  maxQueries: number,
  maxPerQuery: number,
  normalizeItemKey: (key: string) => string,
): Record<string, Record<string, number>> {
  const queryEntries = Object.entries(raw).filter(
    ([q, counts]) =>
      typeof q === 'string'
      && q.length > 0
      && counts !== null
      && typeof counts === 'object'
      && !Array.isArray(counts),
  );
  const mergedByQuery = new Map<string, Record<string, number>>();
  for (const [q, counts] of queryEntries) {
    const nq = normalizeQueryKey(q);
    const acc = mergedByQuery.get(nq) ?? {};
    mergeUsageCountRecords(acc, counts as Record<string, number>, normalizeItemKey);
    mergedByQuery.set(nq, acc);
  }
  const cappedPerQuery = [...mergedByQuery.entries()].map(([q, counts]) => [
    q,
    capUsageCounts(counts, maxPerQuery, normalizeItemKey),
  ] as const);
  if (cappedPerQuery.length <= maxQueries) {
    return Object.fromEntries(cappedPerQuery);
  }
  cappedPerQuery.sort((a, b) => {
    const sumA = Object.values(a[1]).reduce((s, n) => s + n, 0);
    const sumB = Object.values(b[1]).reduce((s, n) => s + n, 0);
    if (sumB !== sumA) {
      return sumB - sumA;
    }
    return a[0].localeCompare(b[0]);
  });
  return Object.fromEntries(cappedPerQuery.slice(0, maxQueries));
}

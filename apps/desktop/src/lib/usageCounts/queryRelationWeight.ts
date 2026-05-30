import {normalizeQueryKey} from './normalizeQueryKey';

/**
 * Weight for picks recorded under `storedQ` when the user is typing query `Q`.
 * Returns null when the queries are unrelated.
 */
export function queryRelationWeight(
  activeQuery: string,
  storedQuery: string,
  prefixQueryWeight: number,
): number | null {
  const Q = normalizeQueryKey(activeQuery);
  const stored = normalizeQueryKey(storedQuery);
  if (Q.length === 0 || stored.length === 0) {
    return null;
  }
  if (Q === stored) {
    return 1;
  }
  if (stored.startsWith(Q) || Q.startsWith(stored)) {
    return prefixQueryWeight;
  }
  return null;
}

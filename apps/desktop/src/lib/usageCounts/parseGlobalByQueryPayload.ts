import {capUsageByQuery} from './capUsageByQuery';
import {capUsageCounts} from './capUsageCounts';
import type {UsageByQuery, UsageCountLimits} from './types';

export function parseGlobalByQueryPayload(
  parsed: unknown,
  expectedVersion: number,
  limits: UsageCountLimits,
  normalizeItemKey: (key: string) => string,
): {global: Record<string, number>; byQuery: Record<string, Record<string, number>>} | null {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  const o = parsed as Record<string, unknown>;
  if (o.v !== expectedVersion) {
    return null;
  }
  if (o.global === null || typeof o.global !== 'object' || Array.isArray(o.global)) {
    return null;
  }
  if (o.byQuery === null || typeof o.byQuery !== 'object' || Array.isArray(o.byQuery)) {
    return null;
  }
  return {
    global: capUsageCounts(
      o.global as Record<string, number>,
      limits.maxGlobal,
      normalizeItemKey,
    ),
    byQuery: capUsageByQuery(
      o.byQuery as UsageByQuery,
      limits.maxQueries,
      limits.maxPerQuery,
      normalizeItemKey,
    ),
  };
}

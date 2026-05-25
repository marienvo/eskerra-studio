import {load} from '@tauri-apps/plugin-store';

import {invalidateScoreLookupCache} from './buildScoreLookup';
import {evictLowestCountKey} from './evictLowestCountKey';
import {normalizeQueryKey} from './normalizeQueryKey';
import type {UsageCountLimits, UsageCountMaps, UsageScores, ScoreLookupMemo} from './types';

function evictLowestQueryKey(
  byQueryCounts: Map<string, Map<string, number>>,
  maxQueries: number,
): void {
  if (byQueryCounts.size < maxQueries) {
    return;
  }
  let victim: string | null = null;
  let victimSum = Number.POSITIVE_INFINITY;
  for (const [q, counts] of byQueryCounts) {
    const sum = [...counts.values()].reduce((s, n) => s + n, 0);
    if (
      victim === null
      || sum < victimSum
      || (sum === victimSum && q.localeCompare(victim) < 0)
    ) {
      victim = q;
      victimSum = sum;
    }
  }
  if (victim !== null) {
    byQueryCounts.delete(victim);
  }
}

export function recordUsagePick(opts: {
  itemKey: string;
  queryLower?: string;
  maps: UsageCountMaps;
  limits: UsageCountLimits;
  normalizeItemKey: (key: string) => string;
  onAfterMutation: () => void;
}): void {
  const {maps, limits, normalizeItemKey, onAfterMutation} = opts;
  const k = normalizeItemKey(opts.itemKey);
  if (k.length === 0) {
    return;
  }
  if (!maps.globalCounts.has(k) && maps.globalCounts.size >= limits.maxGlobal) {
    evictLowestCountKey(maps.globalCounts, limits.maxGlobal);
  }
  maps.globalCounts.set(
    k,
    Math.min(Number.MAX_SAFE_INTEGER, (maps.globalCounts.get(k) ?? 0) + 1),
  );

  if (opts.queryLower !== undefined && opts.queryLower.length > 0) {
    const qKey = normalizeQueryKey(opts.queryLower);
    let qMap = maps.byQueryCounts.get(qKey);
    if (!qMap) {
      if (maps.byQueryCounts.size >= limits.maxQueries) {
        evictLowestQueryKey(maps.byQueryCounts, limits.maxQueries);
      }
      qMap = new Map();
      maps.byQueryCounts.set(qKey, qMap);
    }
    if (!qMap.has(k) && qMap.size >= limits.maxPerQuery) {
      evictLowestCountKey(qMap, limits.maxPerQuery);
    }
    qMap.set(k, Math.min(Number.MAX_SAFE_INTEGER, (qMap.get(k) ?? 0) + 1));
  }

  onAfterMutation();
}

export function loadUsageMapsFromParsed(
  parsed: {global: Record<string, number>; byQuery: Record<string, Record<string, number>>},
  maps: UsageCountMaps,
): void {
  maps.globalCounts.clear();
  maps.byQueryCounts.clear();
  for (const [k, n] of Object.entries(parsed.global)) {
    maps.globalCounts.set(k, n);
  }
  for (const [q, counts] of Object.entries(parsed.byQuery)) {
    const qMap = new Map<string, number>();
    for (const [k, n] of Object.entries(counts)) {
      qMap.set(k, n);
    }
    maps.byQueryCounts.set(q, qMap);
  }
}

export function loadUsageMapsFromGlobalOnly(
  global: Record<string, number>,
  maps: UsageCountMaps,
): void {
  maps.globalCounts.clear();
  maps.byQueryCounts.clear();
  for (const [k, n] of Object.entries(global)) {
    maps.globalCounts.set(k, n);
  }
}

export type DebouncedUsageSaveHandle = {
  timer: ReturnType<typeof setTimeout> | null;
};

export function cancelPendingUsageSave(handle: DebouncedUsageSaveHandle): void {
  if (handle.timer !== null) {
    clearTimeout(handle.timer);
    handle.timer = null;
  }
}

export function scheduleDebouncedUsageSave(
  handle: DebouncedUsageSaveHandle,
  debounceMs: number,
  flush: () => Promise<void>,
): void {
  cancelPendingUsageSave(handle);
  handle.timer = setTimeout(() => {
    handle.timer = null;
    void flush();
  }, debounceMs);
}

export async function flushUsageCountsToStore(opts: {
  storePath: string;
  storeKey: string;
  payloadVersion: number;
  maps: UsageCountMaps;
  saveHandle: DebouncedUsageSaveHandle;
}): Promise<void> {
  cancelPendingUsageSave(opts.saveHandle);
  try {
    const store = await load(opts.storePath);
    const byQuery: Record<string, Record<string, number>> = {};
    for (const [q, counts] of [...opts.maps.byQueryCounts.entries()].sort((a, b) =>
      a[0].localeCompare(b[0]),
    )) {
      byQuery[q] = Object.fromEntries(
        [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0])),
      );
    }
    const payload = {
      v: opts.payloadVersion,
      global: Object.fromEntries(
        [...opts.maps.globalCounts.entries()].sort((a, b) => a[0].localeCompare(b[0])),
      ),
      byQuery,
    };
    await store.set(opts.storeKey, JSON.stringify(payload));
    await store.save();
  } catch {
    /* Store unavailable (e.g. plain web dev) — ignore. */
  }
}

export async function hydrateUsageCountsFromStoreKey(opts: {
  storePath: string;
  storeKey: string;
  maps: UsageCountMaps;
  memo: ScoreLookupMemo;
  parseRaw: (raw: string) => {global: Record<string, number>; byQuery: Record<string, Record<string, number>>} | null;
}): Promise<boolean> {
  try {
    const store = await load(opts.storePath);
    const raw = await store.get<string>(opts.storeKey);
    if (typeof raw === 'string' && raw.trim()) {
      const parsed = opts.parseRaw(raw);
      if (parsed) {
        invalidateScoreLookupCache(opts.memo);
        loadUsageMapsFromParsed(parsed, opts.maps);
        return true;
      }
    }
  } catch {
    /* Ignore corrupt or missing store. */
  }
  return false;
}

export type UsageScoresGetter = (itemKey: string, queryLower?: string) => UsageScores;

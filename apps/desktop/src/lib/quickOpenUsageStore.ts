import {
  buildUsageScoreLookup,
  cancelPendingUsageSave,
  capUsageByQuery,
  capUsageCounts,
  evictLowestCountKey,
  flushUsageCountsToStore,
  getUsageScores,
  hydrateUsageCountsFromStoreKey,
  invalidateScoreLookupCache,
  parseGlobalByQueryPayload,
  queryRelationWeight,
  recordUsagePick,
  scheduleDebouncedUsageSave,
  type DebouncedUsageSaveHandle,
  type ScoreLookupMemo,
  type UsageCountLimits,
  type UsageCountMaps,
} from './usageCounts';

/** Same file as layout / main window UI — not the vault. */
export const QUICK_OPEN_USAGE_STORE_PATH = 'eskerra-desktop.json';
export const QUICK_OPEN_USAGE_STORE_KEY = 'quickOpenUsageV1';

export const QUICK_OPEN_USAGE_MAX_URIS = 1000;
export const QUICK_OPEN_USAGE_MAX_QUERIES = 200;
export const QUICK_OPEN_USAGE_MAX_URIS_PER_QUERY = 100;

/** Weight when a stored query key shares a prefix with the active query (not exact). */
export const QUICK_OPEN_USAGE_PREFIX_QUERY_WEIGHT = 0.5;

export const QUICK_OPEN_USAGE_DEBOUNCE_SAVE_MS = 1500;

export type QuickOpenUsageScores = {
  readonly favScore: number;
  readonly globalScore: number;
};

const limits: UsageCountLimits = {
  maxGlobal: QUICK_OPEN_USAGE_MAX_URIS,
  maxQueries: QUICK_OPEN_USAGE_MAX_QUERIES,
  maxPerQuery: QUICK_OPEN_USAGE_MAX_URIS_PER_QUERY,
};

const maps: UsageCountMaps = {
  globalCounts: new Map<string, number>(),
  byQueryCounts: new Map<string, Map<string, number>>(),
};

const saveHandle: DebouncedUsageSaveHandle = {timer: null};
const scoreMemo: ScoreLookupMemo = {query: null, fn: null};

let usageRevision = 0;
const usageRevisionListeners = new Set<() => void>();

function bumpQuickOpenUsageRevision(): void {
  usageRevision += 1;
  for (const listener of usageRevisionListeners) {
    listener();
  }
}

function normalizeUriKey(uri: string): string {
  return uri.trim();
}

function onAfterUsageMutation(): void {
  invalidateScoreLookupCache(scoreMemo);
  bumpQuickOpenUsageRevision();
  scheduleDebouncedUsageSave(saveHandle, QUICK_OPEN_USAGE_DEBOUNCE_SAVE_MS, flushQuickOpenUsageToStore);
}

export function getQuickOpenUsageRevision(): number {
  return usageRevision;
}

export function subscribeQuickOpenUsageRevision(listener: () => void): () => void {
  usageRevisionListeners.add(listener);
  return () => {
    usageRevisionListeners.delete(listener);
  };
}

export function capQuickOpenUsageCounts(
  raw: Readonly<Record<string, number>>,
  maxKeys: number,
): Record<string, number> {
  return capUsageCounts(raw, maxKeys, normalizeUriKey);
}

export function capQuickOpenUsageByQuery(
  raw: Record<string, Record<string, number>>,
  maxQueries: number,
  maxUrisPerQuery: number,
): Record<string, Record<string, number>> {
  return capUsageByQuery(raw, maxQueries, maxUrisPerQuery, normalizeUriKey);
}

export function parseQuickOpenUsagePayloadV1(
  parsed: unknown,
): {global: Record<string, number>; byQuery: Record<string, Record<string, number>>} | null {
  return parseGlobalByQueryPayload(parsed, 1, limits, normalizeUriKey);
}

export {evictLowestCountKey};

export function quickOpenUsageQueryRelationWeight(
  activeQuery: string,
  storedQuery: string,
): number | null {
  return queryRelationWeight(activeQuery, storedQuery, QUICK_OPEN_USAGE_PREFIX_QUERY_WEIGHT);
}

export function buildQuickOpenUsageScoreLookup(
  queryLower: string,
): (uri: string) => QuickOpenUsageScores {
  return buildUsageScoreLookup(
    queryLower,
    maps.globalCounts,
    maps.byQueryCounts,
    normalizeUriKey,
    QUICK_OPEN_USAGE_PREFIX_QUERY_WEIGHT,
    scoreMemo,
  );
}

export function getQuickOpenUsageScores(
  uri: string,
  queryLower?: string,
): QuickOpenUsageScores {
  return getUsageScores(
    uri,
    queryLower,
    maps.globalCounts,
    maps.byQueryCounts,
    normalizeUriKey,
    QUICK_OPEN_USAGE_PREFIX_QUERY_WEIGHT,
    scoreMemo,
  );
}

export async function flushQuickOpenUsageToStore(): Promise<void> {
  await flushUsageCountsToStore({
    storePath: QUICK_OPEN_USAGE_STORE_PATH,
    storeKey: QUICK_OPEN_USAGE_STORE_KEY,
    payloadVersion: 1,
    maps,
    saveHandle,
  });
}

export function recordQuickOpenNoteUsage(uri: string, queryLower?: string): void {
  recordUsagePick({
    itemKey: uri,
    queryLower,
    maps,
    limits,
    normalizeItemKey: normalizeUriKey,
    onAfterMutation: onAfterUsageMutation,
  });
}

function parseQuickOpenUsageRaw(raw: string): ReturnType<typeof parseQuickOpenUsagePayloadV1> {
  const parsed: unknown = JSON.parse(raw);
  return parseQuickOpenUsagePayloadV1(parsed);
}

export async function hydrateQuickOpenUsageFromStore(): Promise<void> {
  const loaded = await hydrateUsageCountsFromStoreKey({
    storePath: QUICK_OPEN_USAGE_STORE_PATH,
    storeKey: QUICK_OPEN_USAGE_STORE_KEY,
    maps,
    memo: scoreMemo,
    parseRaw: parseQuickOpenUsageRaw,
  });
  if (loaded) {
    bumpQuickOpenUsageRevision();
  }
}

/** Vitest harness: clears in-memory counts and pending debounced save timer. */
export function __resetForTests(): void {
  cancelPendingUsageSave(saveHandle);
  invalidateScoreLookupCache(scoreMemo);
  maps.globalCounts.clear();
  maps.byQueryCounts.clear();
  usageRevision = 0;
  usageRevisionListeners.clear();
}

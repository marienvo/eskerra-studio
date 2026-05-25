import {load} from '@tauri-apps/plugin-store';

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

type QuickOpenUsageByQuery = Record<string, Record<string, number>>;

type QuickOpenUsagePayloadV1 = {
  readonly v: 1;
  readonly global: Readonly<Record<string, number>>;
  readonly byQuery: QuickOpenUsageByQuery;
};

const globalCounts = new Map<string, number>();
const byQueryCounts = new Map<string, Map<string, number>>();

let saveTimer: ReturnType<typeof setTimeout> | null = null;

/** Last `normalizeQueryKey` passed to `buildQuickOpenUsageScoreLookup` (one-entry memo). */
let scoreLookupCacheQuery: string | null = null;
let scoreLookupCacheFn: ((uri: string) => QuickOpenUsageScores) | null = null;

function invalidateScoreLookupCache(): void {
  scoreLookupCacheQuery = null;
  scoreLookupCacheFn = null;
}

function normalizeUriKey(uri: string): string {
  return uri.trim();
}

function normalizeQueryKey(query: string): string {
  return query.trim().toLowerCase();
}

/** Keep top `maxKeys` entries by count (then key) when trimming loaded data. */
export function capQuickOpenUsageCounts(
  raw: Readonly<Record<string, number>>,
  maxKeys: number,
): Record<string, number> {
  const entries = Object.entries(raw).filter(
    ([k, n]) =>
      typeof k === 'string'
      && k.length > 0
      && typeof n === 'number'
      && Number.isFinite(n)
      && n > 0,
  );
  if (entries.length <= maxKeys) {
    const out: Record<string, number> = {};
    for (const [k, n] of entries) {
      out[normalizeUriKey(k)] = Math.min(Number.MAX_SAFE_INTEGER, Math.floor(n));
    }
    return out;
  }
  entries.sort((a, b) => {
    if (b[1] !== a[1]) {
      return b[1] - a[1];
    }
    return a[0].localeCompare(b[0]);
  });
  const out: Record<string, number> = {};
  for (const [k, n] of entries.slice(0, maxKeys)) {
    out[normalizeUriKey(k)] = Math.min(Number.MAX_SAFE_INTEGER, Math.floor(n));
  }
  return out;
}

function mergeQuickOpenUsageCountRecords(
  into: Record<string, number>,
  from: Readonly<Record<string, number>>,
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
    const nk = normalizeUriKey(k);
    into[nk] = Math.min(
      Number.MAX_SAFE_INTEGER,
      (into[nk] ?? 0) + Math.floor(n),
    );
  }
}

export function capQuickOpenUsageByQuery(
  raw: QuickOpenUsageByQuery,
  maxQueries: number,
  maxUrisPerQuery: number,
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
    mergeQuickOpenUsageCountRecords(acc, counts as Record<string, number>);
    mergedByQuery.set(nq, acc);
  }
  const cappedPerQuery = [...mergedByQuery.entries()].map(([q, counts]) => [
    q,
    capQuickOpenUsageCounts(counts, maxUrisPerQuery),
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

export function parseQuickOpenUsagePayloadV1(
  parsed: unknown,
): {global: Record<string, number>; byQuery: Record<string, Record<string, number>>} | null {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  const o = parsed as Record<string, unknown>;
  if (o.v !== 1) {
    return null;
  }
  if (o.global === null || typeof o.global !== 'object' || Array.isArray(o.global)) {
    return null;
  }
  if (o.byQuery === null || typeof o.byQuery !== 'object' || Array.isArray(o.byQuery)) {
    return null;
  }
  return {
    global: capQuickOpenUsageCounts(
      o.global as Record<string, number>,
      QUICK_OPEN_USAGE_MAX_URIS,
    ),
    byQuery: capQuickOpenUsageByQuery(
      o.byQuery as Record<string, Record<string, number>>,
      QUICK_OPEN_USAGE_MAX_QUERIES,
      QUICK_OPEN_USAGE_MAX_URIS_PER_QUERY,
    ),
  };
}

/**
 * Drop one existing key with the lowest count (lexicographically smallest key on ties).
 * Call only when `map.size >= maxKeys` and a new key will be added.
 */
export function evictLowestCountKey(map: Map<string, number>, maxKeys: number): void {
  if (map.size < maxKeys) {
    return;
  }
  let victim: string | null = null;
  let victimCount = Number.POSITIVE_INFINITY;
  for (const [k, n] of map) {
    if (
      victim === null
      || n < victimCount
      || (n === victimCount && k.localeCompare(victim) < 0)
    ) {
      victim = k;
      victimCount = n;
    }
  }
  if (victim !== null) {
    map.delete(victim);
  }
}

function evictLowestQueryKey(): void {
  if (byQueryCounts.size < QUICK_OPEN_USAGE_MAX_QUERIES) {
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

/**
 * Weight for picks recorded under `storedQ` when the user is typing query `Q`.
 * Returns null when the queries are unrelated.
 */
export function quickOpenUsageQueryRelationWeight(
  activeQuery: string,
  storedQuery: string,
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
    return QUICK_OPEN_USAGE_PREFIX_QUERY_WEIGHT;
  }
  return null;
}

/** Build once per Quick Open query refresh; sums exact + prefix-related query keys. */
export function buildQuickOpenUsageScoreLookup(
  queryLower: string,
): (uri: string) => QuickOpenUsageScores {
  const Q = normalizeQueryKey(queryLower);
  if (scoreLookupCacheQuery === Q && scoreLookupCacheFn !== null) {
    return scoreLookupCacheFn;
  }
  const favByUri = new Map<string, number>();
  if (Q.length > 0) {
    for (const [storedQ, counts] of byQueryCounts) {
      const weight = quickOpenUsageQueryRelationWeight(Q, storedQ);
      if (weight === null) {
        continue;
      }
      for (const [k, n] of counts) {
        const add = n * weight;
        favByUri.set(k, (favByUri.get(k) ?? 0) + add);
      }
    }
  }
  const fn = (uri: string): QuickOpenUsageScores => {
    const key = normalizeUriKey(uri);
    return {
      favScore: favByUri.get(key) ?? 0,
      globalScore: globalCounts.get(key) ?? 0,
    };
  };
  scoreLookupCacheQuery = Q;
  scoreLookupCacheFn = fn;
  return fn;
}

export function getQuickOpenUsageScores(
  uri: string,
  queryLower?: string,
): QuickOpenUsageScores {
  if (queryLower === undefined || queryLower.length === 0) {
    const key = normalizeUriKey(uri);
    return {favScore: 0, globalScore: globalCounts.get(key) ?? 0};
  }
  return buildQuickOpenUsageScoreLookup(queryLower)(uri);
}

function cancelPendingQuickOpenUsageSave(): void {
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
}

export async function flushQuickOpenUsageToStore(): Promise<void> {
  cancelPendingQuickOpenUsageSave();
  try {
    const store = await load(QUICK_OPEN_USAGE_STORE_PATH);
    const byQuery: Record<string, Record<string, number>> = {};
    for (const [q, counts] of [...byQueryCounts.entries()].sort((a, b) =>
      a[0].localeCompare(b[0]),
    )) {
      byQuery[q] = Object.fromEntries(
        [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0])),
      );
    }
    const payload: QuickOpenUsagePayloadV1 = {
      v: 1,
      global: Object.fromEntries(
        [...globalCounts.entries()].sort((a, b) => a[0].localeCompare(b[0])),
      ),
      byQuery,
    };
    await store.set(QUICK_OPEN_USAGE_STORE_KEY, JSON.stringify(payload));
    await store.save();
  } catch {
    /* Store unavailable (e.g. plain web dev) — ignore. */
  }
}

function scheduleQuickOpenUsageSave(): void {
  cancelPendingQuickOpenUsageSave();
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void flushQuickOpenUsageToStore();
  }, QUICK_OPEN_USAGE_DEBOUNCE_SAVE_MS);
}

export function recordQuickOpenNoteUsage(uri: string, queryLower?: string): void {
  const k = normalizeUriKey(uri);
  if (k.length === 0) {
    return;
  }
  if (!globalCounts.has(k) && globalCounts.size >= QUICK_OPEN_USAGE_MAX_URIS) {
    evictLowestCountKey(globalCounts, QUICK_OPEN_USAGE_MAX_URIS);
  }
  globalCounts.set(k, Math.min(Number.MAX_SAFE_INTEGER, (globalCounts.get(k) ?? 0) + 1));

  if (queryLower !== undefined && queryLower.length > 0) {
    const qKey = normalizeQueryKey(queryLower);
    let qMap = byQueryCounts.get(qKey);
    if (!qMap) {
      if (byQueryCounts.size >= QUICK_OPEN_USAGE_MAX_QUERIES) {
        evictLowestQueryKey();
      }
      qMap = new Map();
      byQueryCounts.set(qKey, qMap);
    }
    if (!qMap.has(k) && qMap.size >= QUICK_OPEN_USAGE_MAX_URIS_PER_QUERY) {
      evictLowestCountKey(qMap, QUICK_OPEN_USAGE_MAX_URIS_PER_QUERY);
    }
    qMap.set(k, Math.min(Number.MAX_SAFE_INTEGER, (qMap.get(k) ?? 0) + 1));
  }

  invalidateScoreLookupCache();
  scheduleQuickOpenUsageSave();
}

async function loadQuickOpenUsageFromRaw(raw: string): Promise<void> {
  const parsed: unknown = JSON.parse(raw);
  const v1 = parseQuickOpenUsagePayloadV1(parsed);
  if (v1) {
    invalidateScoreLookupCache();
    globalCounts.clear();
    byQueryCounts.clear();
    for (const [k, n] of Object.entries(v1.global)) {
      globalCounts.set(k, n);
    }
    for (const [q, counts] of Object.entries(v1.byQuery)) {
      const qMap = new Map<string, number>();
      for (const [k, n] of Object.entries(counts)) {
        qMap.set(k, n);
      }
      byQueryCounts.set(q, qMap);
    }
  }
}

export async function hydrateQuickOpenUsageFromStore(): Promise<void> {
  try {
    const store = await load(QUICK_OPEN_USAGE_STORE_PATH);
    const raw = await store.get<string>(QUICK_OPEN_USAGE_STORE_KEY);
    if (typeof raw === 'string' && raw.trim()) {
      await loadQuickOpenUsageFromRaw(raw);
    }
  } catch {
    /* Ignore corrupt or missing store. */
  }
}

/** Vitest harness: clears in-memory counts and pending debounced save timer. */
export function __resetForTests(): void {
  cancelPendingQuickOpenUsageSave();
  invalidateScoreLookupCache();
  globalCounts.clear();
  byQueryCounts.clear();
}

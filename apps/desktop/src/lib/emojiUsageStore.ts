import {load} from '@tauri-apps/plugin-store';

/** Same file as layout / main window UI — not the vault. */
export const EMOJI_USAGE_STORE_PATH = 'eskerra-desktop.json';
export const EMOJI_USAGE_STORE_KEY_V1 = 'emojiUsageV1';
export const EMOJI_USAGE_STORE_KEY = 'emojiUsageV2';

export const EMOJI_USAGE_MAX_SHORTCODES = 300;
export const EMOJI_USAGE_MAX_QUERIES = 200;
export const EMOJI_USAGE_MAX_SHORTCODES_PER_QUERY = 50;

/** Per-query counts dominate within-tier ordering over global picks. */
export const EMOJI_USAGE_QUERY_BOOST = 1000;

export const EMOJI_USAGE_DEBOUNCE_SAVE_MS = 1500;

type EmojiUsagePayloadV1 = {
  readonly v: 1;
  readonly counts: Readonly<Record<string, number>>;
};

type EmojiUsageByQuery = Record<string, Record<string, number>>;

type EmojiUsagePayloadV2 = {
  readonly v: 2;
  readonly global: Readonly<Record<string, number>>;
  readonly byQuery: EmojiUsageByQuery;
};

const globalCounts = new Map<string, number>();
const byQueryCounts = new Map<string, Map<string, number>>();

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function normalizeShortcodeKey(shortcode: string): string {
  return shortcode.trim().toLowerCase();
}

function normalizeQueryKey(query: string): string {
  return query.trim().toLowerCase();
}

/** Keep top `maxKeys` entries by count (then key) when trimming loaded data. */
export function capEmojiUsageCounts(
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
      out[normalizeShortcodeKey(k)] = Math.min(Number.MAX_SAFE_INTEGER, Math.floor(n));
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
    out[normalizeShortcodeKey(k)] = Math.min(Number.MAX_SAFE_INTEGER, Math.floor(n));
  }
  return out;
}

export function capEmojiUsageByQuery(
  raw: EmojiUsageByQuery,
  maxQueries: number,
  maxShortcodesPerQuery: number,
): Record<string, Record<string, number>> {
  const queryEntries = Object.entries(raw).filter(
    ([q, counts]) =>
      typeof q === 'string'
      && q.length > 0
      && counts !== null
      && typeof counts === 'object'
      && !Array.isArray(counts),
  );
  const cappedPerQuery = queryEntries.map(([q, counts]) => [
    normalizeQueryKey(q),
    capEmojiUsageCounts(counts as Record<string, number>, maxShortcodesPerQuery),
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

export function parseEmojiUsagePayloadV1(parsed: unknown): Record<string, number> | null {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  const o = parsed as Record<string, unknown>;
  if (o.v !== 1) {
    return null;
  }
  if (o.counts === null || typeof o.counts !== 'object' || Array.isArray(o.counts)) {
    return null;
  }
  return capEmojiUsageCounts(o.counts as Record<string, number>, EMOJI_USAGE_MAX_SHORTCODES);
}

export function parseEmojiUsagePayloadV2(
  parsed: unknown,
): {global: Record<string, number>; byQuery: Record<string, Record<string, number>>} | null {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  const o = parsed as Record<string, unknown>;
  if (o.v !== 2) {
    return null;
  }
  if (o.global === null || typeof o.global !== 'object' || Array.isArray(o.global)) {
    return null;
  }
  if (o.byQuery === null || typeof o.byQuery !== 'object' || Array.isArray(o.byQuery)) {
    return null;
  }
  return {
    global: capEmojiUsageCounts(
      o.global as Record<string, number>,
      EMOJI_USAGE_MAX_SHORTCODES,
    ),
    byQuery: capEmojiUsageByQuery(
      o.byQuery as Record<string, Record<string, number>>,
      EMOJI_USAGE_MAX_QUERIES,
      EMOJI_USAGE_MAX_SHORTCODES_PER_QUERY,
    ),
  };
}

/** @deprecated Use parseEmojiUsagePayloadV1 — kept for tests. */
export function parseEmojiUsagePayload(parsed: unknown): Record<string, number> | null {
  return parseEmojiUsagePayloadV1(parsed);
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
  if (byQueryCounts.size < EMOJI_USAGE_MAX_QUERIES) {
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

export function getEmojiUsageCount(shortcode: string, queryLower?: string): number {
  const key = normalizeShortcodeKey(shortcode);
  const global = globalCounts.get(key) ?? 0;
  if (queryLower === undefined || queryLower.length === 0) {
    return global;
  }
  const qKey = normalizeQueryKey(queryLower);
  const perQuery = byQueryCounts.get(qKey)?.get(key) ?? 0;
  return perQuery * EMOJI_USAGE_QUERY_BOOST + global;
}

export async function flushEmojiUsageToStore(): Promise<void> {
  try {
    const store = await load(EMOJI_USAGE_STORE_PATH);
    const byQuery: Record<string, Record<string, number>> = {};
    for (const [q, counts] of [...byQueryCounts.entries()].sort((a, b) =>
      a[0].localeCompare(b[0]),
    )) {
      byQuery[q] = Object.fromEntries(
        [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0])),
      );
    }
    const payload: EmojiUsagePayloadV2 = {
      v: 2,
      global: Object.fromEntries(
        [...globalCounts.entries()].sort((a, b) => a[0].localeCompare(b[0])),
      ),
      byQuery,
    };
    await store.set(EMOJI_USAGE_STORE_KEY, JSON.stringify(payload));
    await store.save();
  } catch {
    /* Store unavailable (e.g. plain web dev) — ignore. */
  }
}

function scheduleEmojiUsageSave(): void {
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
  }
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void flushEmojiUsageToStore();
  }, EMOJI_USAGE_DEBOUNCE_SAVE_MS);
}

export function recordEmojiUsage(shortcode: string, queryLower?: string): void {
  const k = normalizeShortcodeKey(shortcode);
  if (k.length === 0) {
    return;
  }
  if (!globalCounts.has(k) && globalCounts.size >= EMOJI_USAGE_MAX_SHORTCODES) {
    evictLowestCountKey(globalCounts, EMOJI_USAGE_MAX_SHORTCODES);
  }
  globalCounts.set(k, Math.min(Number.MAX_SAFE_INTEGER, (globalCounts.get(k) ?? 0) + 1));

  if (queryLower !== undefined && queryLower.length > 0) {
    const qKey = normalizeQueryKey(queryLower);
    let qMap = byQueryCounts.get(qKey);
    if (!qMap) {
      if (byQueryCounts.size >= EMOJI_USAGE_MAX_QUERIES) {
        evictLowestQueryKey();
      }
      qMap = new Map();
      byQueryCounts.set(qKey, qMap);
    }
    if (!qMap.has(k) && qMap.size >= EMOJI_USAGE_MAX_SHORTCODES_PER_QUERY) {
      evictLowestCountKey(qMap, EMOJI_USAGE_MAX_SHORTCODES_PER_QUERY);
    }
    qMap.set(k, Math.min(Number.MAX_SAFE_INTEGER, (qMap.get(k) ?? 0) + 1));
  }

  scheduleEmojiUsageSave();
}

async function loadEmojiUsageFromRaw(raw: string): Promise<void> {
  const parsed: unknown = JSON.parse(raw);
  const v2 = parseEmojiUsagePayloadV2(parsed);
  if (v2) {
    globalCounts.clear();
    byQueryCounts.clear();
    for (const [k, n] of Object.entries(v2.global)) {
      globalCounts.set(k, n);
    }
    for (const [q, counts] of Object.entries(v2.byQuery)) {
      const qMap = new Map<string, number>();
      for (const [k, n] of Object.entries(counts)) {
        qMap.set(k, n);
      }
      byQueryCounts.set(q, qMap);
    }
    return;
  }
  const v1 = parseEmojiUsagePayloadV1(parsed);
  if (v1) {
    globalCounts.clear();
    byQueryCounts.clear();
    for (const [k, n] of Object.entries(v1)) {
      globalCounts.set(k, n);
    }
  }
}

export async function hydrateEmojiUsageFromStore(): Promise<void> {
  try {
    const store = await load(EMOJI_USAGE_STORE_PATH);
    const rawV2 = await store.get<string>(EMOJI_USAGE_STORE_KEY);
    if (typeof rawV2 === 'string' && rawV2.trim()) {
      await loadEmojiUsageFromRaw(rawV2);
      return;
    }
    const rawV1 = await store.get<string>(EMOJI_USAGE_STORE_KEY_V1);
    if (typeof rawV1 === 'string' && rawV1.trim()) {
      await loadEmojiUsageFromRaw(rawV1);
    }
  } catch {
    /* Ignore corrupt or missing store. */
  }
}

/** Vitest harness: clears in-memory counts and pending debounced save timer. */
export function __resetForTests(): void {
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  globalCounts.clear();
  byQueryCounts.clear();
}

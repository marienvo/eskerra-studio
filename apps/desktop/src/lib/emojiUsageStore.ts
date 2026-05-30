import {load} from '@tauri-apps/plugin-store';

import {
  buildUsageScoreLookup,
  cancelPendingUsageSave,
  capUsageByQuery,
  capUsageCounts,
  evictLowestCountKey,
  flushUsageCountsToStore,
  getUsageScores,
  invalidateScoreLookupCache,
  loadUsageMapsFromGlobalOnly,
  loadUsageMapsFromParsed,
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
export const EMOJI_USAGE_STORE_PATH = 'eskerra-desktop.json';
export const EMOJI_USAGE_STORE_KEY_V1 = 'emojiUsageV1';
export const EMOJI_USAGE_STORE_KEY = 'emojiUsageV2';

export const EMOJI_USAGE_MAX_SHORTCODES = 300;
export const EMOJI_USAGE_MAX_QUERIES = 200;
export const EMOJI_USAGE_MAX_SHORTCODES_PER_QUERY = 50;

/** Weight when a stored query key shares a prefix with the active query (not exact). */
export const EMOJI_USAGE_PREFIX_QUERY_WEIGHT = 0.5;

export const EMOJI_USAGE_DEBOUNCE_SAVE_MS = 1500;

export type EmojiUsageScores = {
  readonly favScore: number;
  readonly globalScore: number;
};

type EmojiUsagePayloadV1 = {
  readonly v: 1;
  readonly counts: Readonly<Record<string, number>>;
};

const limits: UsageCountLimits = {
  maxGlobal: EMOJI_USAGE_MAX_SHORTCODES,
  maxQueries: EMOJI_USAGE_MAX_QUERIES,
  maxPerQuery: EMOJI_USAGE_MAX_SHORTCODES_PER_QUERY,
};

const maps: UsageCountMaps = {
  globalCounts: new Map<string, number>(),
  byQueryCounts: new Map<string, Map<string, number>>(),
};

const saveHandle: DebouncedUsageSaveHandle = {timer: null};
const scoreMemo: ScoreLookupMemo = {query: null, fn: null};

function normalizeShortcodeKey(shortcode: string): string {
  return shortcode.trim().toLowerCase();
}

function onAfterUsageMutation(): void {
  invalidateScoreLookupCache(scoreMemo);
  scheduleDebouncedUsageSave(saveHandle, EMOJI_USAGE_DEBOUNCE_SAVE_MS, flushEmojiUsageToStore);
}

export function capEmojiUsageCounts(
  raw: Readonly<Record<string, number>>,
  maxKeys: number,
): Record<string, number> {
  return capUsageCounts(raw, maxKeys, normalizeShortcodeKey);
}

export function capEmojiUsageByQuery(
  raw: Record<string, Record<string, number>>,
  maxQueries: number,
  maxShortcodesPerQuery: number,
): Record<string, Record<string, number>> {
  return capUsageByQuery(raw, maxQueries, maxShortcodesPerQuery, normalizeShortcodeKey);
}

export function parseEmojiUsagePayloadV1(parsed: unknown): Record<string, number> | null {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  const o = parsed as EmojiUsagePayloadV1;
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
  return parseGlobalByQueryPayload(parsed, 2, limits, normalizeShortcodeKey);
}

/** @deprecated Use parseEmojiUsagePayloadV1 — kept for tests. */
export function parseEmojiUsagePayload(parsed: unknown): Record<string, number> | null {
  return parseEmojiUsagePayloadV1(parsed);
}

export {evictLowestCountKey};

export function emojiUsageQueryRelationWeight(
  activeQuery: string,
  storedQuery: string,
): number | null {
  return queryRelationWeight(activeQuery, storedQuery, EMOJI_USAGE_PREFIX_QUERY_WEIGHT);
}

export function buildEmojiUsageScoreLookup(
  queryLower: string,
): (shortcode: string) => EmojiUsageScores {
  return buildUsageScoreLookup(
    queryLower,
    maps.globalCounts,
    maps.byQueryCounts,
    normalizeShortcodeKey,
    EMOJI_USAGE_PREFIX_QUERY_WEIGHT,
    scoreMemo,
  );
}

export function getEmojiUsageScores(
  shortcode: string,
  queryLower?: string,
): EmojiUsageScores {
  return getUsageScores(
    shortcode,
    queryLower,
    maps.globalCounts,
    maps.byQueryCounts,
    normalizeShortcodeKey,
    EMOJI_USAGE_PREFIX_QUERY_WEIGHT,
    scoreMemo,
  );
}

export async function flushEmojiUsageToStore(): Promise<void> {
  await flushUsageCountsToStore({
    storePath: EMOJI_USAGE_STORE_PATH,
    storeKey: EMOJI_USAGE_STORE_KEY,
    payloadVersion: 2,
    maps,
    saveHandle,
  });
}

export function recordEmojiUsage(shortcode: string, queryLower?: string): void {
  recordUsagePick({
    itemKey: shortcode,
    queryLower,
    maps,
    limits,
    normalizeItemKey: normalizeShortcodeKey,
    onAfterMutation: onAfterUsageMutation,
  });
}

async function loadEmojiUsageFromRaw(raw: string): Promise<void> {
  const parsed: unknown = JSON.parse(raw);
  const v2 = parseEmojiUsagePayloadV2(parsed);
  if (v2) {
    invalidateScoreLookupCache(scoreMemo);
    loadUsageMapsFromParsed(v2, maps);
    return;
  }
  const v1 = parseEmojiUsagePayloadV1(parsed);
  if (v1) {
    invalidateScoreLookupCache(scoreMemo);
    loadUsageMapsFromGlobalOnly(v1, maps);
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
  cancelPendingUsageSave(saveHandle);
  invalidateScoreLookupCache(scoreMemo);
  maps.globalCounts.clear();
  maps.byQueryCounts.clear();
}

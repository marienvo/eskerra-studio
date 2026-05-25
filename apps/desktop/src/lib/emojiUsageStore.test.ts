import {describe, expect, test} from 'vitest';

import {
  capEmojiUsageByQuery,
  capEmojiUsageCounts,
  emojiUsageQueryRelationWeight,
  EMOJI_USAGE_PREFIX_QUERY_WEIGHT,
  evictLowestCountKey,
  getEmojiUsageScores,
  parseEmojiUsagePayload,
  parseEmojiUsagePayloadV1,
  parseEmojiUsagePayloadV2,
  recordEmojiUsage,
  __resetForTests,
} from './emojiUsageStore';

describe('capEmojiUsageCounts', () => {
  test('keeps all when under cap', () => {
    expect(capEmojiUsageCounts({a: 1, b: 2}, 10)).toEqual({a: 1, b: 2});
  });

  test('normalizes keys to lowercase', () => {
    expect(capEmojiUsageCounts({Smile: 3}, 10)).toEqual({smile: 3});
  });

  test('drops non-positive and non-finite', () => {
    expect(
      capEmojiUsageCounts({a: 0, b: -1, c: Number.NaN, d: 2}, 10),
    ).toEqual({d: 2});
  });

  test('keeps highest counts when over cap', () => {
    const raw = Object.fromEntries(
      Array.from({length: 10}, (_, i) => [`e${i}`, i + 1]),
    );
    expect(Object.keys(capEmojiUsageCounts(raw, 3)).length).toBe(3);
    const capped = capEmojiUsageCounts(raw, 3);
    expect(capped.e9).toBe(10);
    expect(capped.e8).toBe(9);
    expect(capped.e7).toBe(8);
  });
});

describe('parseEmojiUsagePayloadV1', () => {
  test('accepts v1 payload', () => {
    expect(parseEmojiUsagePayloadV1({v: 1, counts: {smile: 2}})).toEqual({smile: 2});
  });

  test('rejects wrong version', () => {
    expect(parseEmojiUsagePayloadV1({v: 2, counts: {}})).toBeNull();
  });

  test('rejects invalid shape', () => {
    expect(parseEmojiUsagePayloadV1(null)).toBeNull();
    expect(parseEmojiUsagePayloadV1({v: 1})).toBeNull();
    expect(parseEmojiUsagePayloadV1({v: 1, counts: []})).toBeNull();
  });
});

describe('parseEmojiUsagePayload (deprecated alias)', () => {
  test('delegates to v1', () => {
    expect(parseEmojiUsagePayload({v: 1, counts: {grin: 1}})).toEqual({grin: 1});
  });
});

describe('parseEmojiUsagePayloadV2', () => {
  test('accepts v2 payload', () => {
    expect(
      parseEmojiUsagePayloadV2({
        v: 2,
        global: {smile: 2},
        byQuery: {heart: {heart: 5}},
      }),
    ).toEqual({
      global: {smile: 2},
      byQuery: {heart: {heart: 5}},
    });
  });

  test('rejects v1 shape', () => {
    expect(parseEmojiUsagePayloadV2({v: 1, counts: {a: 1}})).toBeNull();
  });
});

describe('capEmojiUsageByQuery', () => {
  test('caps shortcodes per query', () => {
    const raw = {
      q: Object.fromEntries(Array.from({length: 10}, (_, i) => [`s${i}`, i + 1])),
    };
    const capped = capEmojiUsageByQuery(raw, 5, 3);
    expect(Object.keys(capped.q).length).toBe(3);
  });
});

describe('emojiUsageQueryRelationWeight', () => {
  test('exact match is weight 1', () => {
    expect(emojiUsageQueryRelationWeight('ch', 'ch')).toBe(1);
  });

  test('prefix relation is half weight', () => {
    expect(emojiUsageQueryRelationWeight('ch', 'check')).toBe(
      EMOJI_USAGE_PREFIX_QUERY_WEIGHT,
    );
    expect(emojiUsageQueryRelationWeight('check', 'ch')).toBe(
      EMOJI_USAGE_PREFIX_QUERY_WEIGHT,
    );
  });

  test('unrelated queries return null', () => {
    expect(emojiUsageQueryRelationWeight('ch', 'smile')).toBeNull();
  });
});

describe('getEmojiUsageScores / recordEmojiUsage', () => {
  test('exact query pick gives favScore 1', () => {
    __resetForTests();
    recordEmojiUsage('heavy_check_mark', 'ch');
    expect(getEmojiUsageScores('heavy_check_mark', 'ch')).toEqual({
      favScore: 1,
      globalScore: 1,
    });
    __resetForTests();
  });

  test('prefix-related stored query gives half weight', () => {
    __resetForTests();
    recordEmojiUsage('heavy_check_mark', 'check');
    expect(getEmojiUsageScores('heavy_check_mark', 'ch')).toEqual({
      favScore: EMOJI_USAGE_PREFIX_QUERY_WEIGHT,
      globalScore: 1,
    });
    __resetForTests();
  });

  test('sums exact and prefix-related query picks', () => {
    __resetForTests();
    recordEmojiUsage('heavy_check_mark', 'checkmark');
    recordEmojiUsage('heavy_check_mark', 'ch');
    expect(getEmojiUsageScores('heavy_check_mark', 'ch')).toEqual({
      favScore: 1 + EMOJI_USAGE_PREFIX_QUERY_WEIGHT,
      globalScore: 2,
    });
    __resetForTests();
  });

  test('unrelated query has zero favScore but keeps global', () => {
    __resetForTests();
    recordEmojiUsage('smile_a', 'heart');
    expect(getEmojiUsageScores('smile_a', 'other')).toEqual({
      favScore: 0,
      globalScore: 1,
    });
    __resetForTests();
  });
});

describe('evictLowestCountKey', () => {
  test('removes lowest count', () => {
    const m = new Map([
      ['a', 5],
      ['b', 1],
      ['c', 3],
    ]);
    evictLowestCountKey(m, 3);
    expect(m.has('b')).toBe(false);
    expect(m.size).toBe(2);
  });

  test('tie-breaks by lexicographic key', () => {
    const m = new Map([
      ['z', 2],
      ['a', 2],
      ['m', 2],
    ]);
    evictLowestCountKey(m, 3);
    expect(m.has('a')).toBe(false);
    expect(m.size).toBe(2);
  });

  test('no-op when under maxKeys', () => {
    const m = new Map([['x', 1]]);
    evictLowestCountKey(m, 5);
    expect(m.size).toBe(1);
  });
});

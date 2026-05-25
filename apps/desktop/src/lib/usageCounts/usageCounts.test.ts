import {describe, expect, test} from 'vitest';

import {
  buildUsageScoreLookup,
  capUsageByQuery,
  capUsageCounts,
  evictLowestCountKey,
  parseGlobalByQueryPayload,
  queryRelationWeight,
  type ScoreLookupMemo,
  type UsageCountLimits,
} from './index';

const trimItemKey = (key: string) => key.trim();
const lowerItemKey = (key: string) => key.trim().toLowerCase();

const uriLimits: UsageCountLimits = {
  maxGlobal: 1000,
  maxQueries: 200,
  maxPerQuery: 100,
};

describe('capUsageCounts', () => {
  test('keeps all when under cap', () => {
    expect(capUsageCounts({a: 1, b: 2}, 10, lowerItemKey)).toEqual({a: 1, b: 2});
  });

  test('normalizes keys via callback', () => {
    expect(capUsageCounts({Smile: 3}, 10, lowerItemKey)).toEqual({smile: 3});
    expect(capUsageCounts({' file:///v/a.md ': 3}, 10, trimItemKey)).toEqual({
      'file:///v/a.md': 3,
    });
  });

  test('drops non-positive and non-finite', () => {
    expect(
      capUsageCounts({a: 0, b: -1, c: Number.NaN, d: 2}, 10, lowerItemKey),
    ).toEqual({d: 2});
  });

  test('keeps highest counts when over cap', () => {
    const raw = Object.fromEntries(
      Array.from({length: 10}, (_, i) => [`file:///v/n${i}.md`, i + 1]),
    );
    const capped = capUsageCounts(raw, 3, trimItemKey);
    expect(Object.keys(capped).length).toBe(3);
    expect(capped['file:///v/n9.md']).toBe(10);
    expect(capped['file:///v/n8.md']).toBe(9);
    expect(capped['file:///v/n7.md']).toBe(8);
  });
});

describe('parseGlobalByQueryPayload', () => {
  test('accepts matching version payload', () => {
    expect(
      parseGlobalByQueryPayload(
        {
          v: 1,
          global: {'file:///v/a.md': 2},
          byQuery: {alpha: {'file:///v/a.md': 5}},
        },
        1,
        uriLimits,
        trimItemKey,
      ),
    ).toEqual({
      global: {'file:///v/a.md': 2},
      byQuery: {alpha: {'file:///v/a.md': 5}},
    });
  });

  test('rejects wrong version', () => {
    expect(
      parseGlobalByQueryPayload({v: 2, global: {}, byQuery: {}}, 1, uriLimits, trimItemKey),
    ).toBeNull();
  });

  test('rejects invalid shape', () => {
    expect(parseGlobalByQueryPayload(null, 1, uriLimits, trimItemKey)).toBeNull();
    expect(parseGlobalByQueryPayload({v: 1}, 1, uriLimits, trimItemKey)).toBeNull();
    expect(
      parseGlobalByQueryPayload({v: 1, global: {}, byQuery: []}, 1, uriLimits, trimItemKey),
    ).toBeNull();
  });
});

describe('capUsageByQuery', () => {
  test('caps items per query', () => {
    const raw = {
      q: Object.fromEntries(
        Array.from({length: 10}, (_, i) => [`file:///v/n${i}.md`, i + 1]),
      ),
    };
    const capped = capUsageByQuery(raw, 5, 3, trimItemKey);
    expect(Object.keys(capped.q).length).toBe(3);
  });

  test('merges sibling keys that normalize to the same query', () => {
    const capped = capUsageByQuery(
      {
        ALP: {'file:///v/a.md': 5},
        alp: {'file:///v/b.md': 3},
      },
      10,
      50,
      trimItemKey,
    );
    expect(capped).toEqual({
      alp: {'file:///v/a.md': 5, 'file:///v/b.md': 3},
    });
  });
});

describe('buildUsageScoreLookup', () => {
  test('returns the same lookup function for repeated calls with the same query', () => {
    const globalCounts = new Map<string, number>();
    const byQueryCounts = new Map<string, Map<string, number>>();
    const memo: ScoreLookupMemo = {query: null, fn: null};
    const fn1 = buildUsageScoreLookup('alp', globalCounts, byQueryCounts, trimItemKey, 0.5, memo);
    const fn2 = buildUsageScoreLookup('alp', globalCounts, byQueryCounts, trimItemKey, 0.5, memo);
    expect(fn1).toBe(fn2);
  });

  test('sums prefix-related query weights', () => {
    const globalCounts = new Map([['file:///v/a.md', 1]]);
    const byQueryCounts = new Map([
      ['alpha', new Map([['file:///v/a.md', 1]])],
    ]);
    const memo: ScoreLookupMemo = {query: null, fn: null};
    const lookup = buildUsageScoreLookup(
      'alp',
      globalCounts,
      byQueryCounts,
      trimItemKey,
      0.5,
      memo,
    );
    expect(lookup('file:///v/a.md')).toEqual({favScore: 0.5, globalScore: 1});
  });
});

describe('queryRelationWeight', () => {
  test('exact match is weight 1', () => {
    expect(queryRelationWeight('alp', 'alp', 0.5)).toBe(1);
  });

  test('prefix relation uses configured weight', () => {
    expect(queryRelationWeight('alp', 'alpha', 0.5)).toBe(0.5);
    expect(queryRelationWeight('alpha', 'alp', 0.5)).toBe(0.5);
  });

  test('unrelated queries return null', () => {
    expect(queryRelationWeight('alp', 'beta', 0.5)).toBeNull();
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

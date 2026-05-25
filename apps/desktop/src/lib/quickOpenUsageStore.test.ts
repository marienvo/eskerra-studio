import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';

const storeSave = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('@tauri-apps/plugin-store', () => ({
  load: vi.fn(async () => ({
    get: vi.fn(async () => undefined),
    set: vi.fn(async () => {}),
    save: storeSave,
  })),
}));

import {
  buildQuickOpenUsageScoreLookup,
  capQuickOpenUsageByQuery,
  capQuickOpenUsageCounts,
  evictLowestCountKey,
  flushQuickOpenUsageToStore,
  getQuickOpenUsageScores,
  parseQuickOpenUsagePayloadV1,
  quickOpenUsageQueryRelationWeight,
  QUICK_OPEN_USAGE_DEBOUNCE_SAVE_MS,
  QUICK_OPEN_USAGE_PREFIX_QUERY_WEIGHT,
  recordQuickOpenNoteUsage,
  __resetForTests,
} from './quickOpenUsageStore';

beforeEach(() => {
  storeSave.mockClear();
  __resetForTests();
});

afterEach(() => {
  __resetForTests();
  vi.useRealTimers();
});

describe('capQuickOpenUsageCounts', () => {
  test('keeps all when under cap', () => {
    expect(capQuickOpenUsageCounts({a: 1, b: 2}, 10)).toEqual({a: 1, b: 2});
  });

  test('trims whitespace from keys', () => {
    expect(capQuickOpenUsageCounts({' file:///v/a.md ': 3}, 10)).toEqual({
      'file:///v/a.md': 3,
    });
  });

  test('keeps highest counts when over cap', () => {
    const raw = Object.fromEntries(
      Array.from({length: 10}, (_, i) => [`file:///v/n${i}.md`, i + 1]),
    );
    const capped = capQuickOpenUsageCounts(raw, 3);
    expect(Object.keys(capped).length).toBe(3);
    expect(capped['file:///v/n9.md']).toBe(10);
    expect(capped['file:///v/n8.md']).toBe(9);
    expect(capped['file:///v/n7.md']).toBe(8);
  });
});

describe('parseQuickOpenUsagePayloadV1', () => {
  test('accepts v1 payload', () => {
    expect(
      parseQuickOpenUsagePayloadV1({
        v: 1,
        global: {'file:///v/a.md': 2},
        byQuery: {alpha: {'file:///v/a.md': 5}},
      }),
    ).toEqual({
      global: {'file:///v/a.md': 2},
      byQuery: {alpha: {'file:///v/a.md': 5}},
    });
  });

  test('rejects wrong version', () => {
    expect(parseQuickOpenUsagePayloadV1({v: 2, global: {}, byQuery: {}})).toBeNull();
  });

  test('rejects invalid shape', () => {
    expect(parseQuickOpenUsagePayloadV1(null)).toBeNull();
    expect(parseQuickOpenUsagePayloadV1({v: 1})).toBeNull();
    expect(parseQuickOpenUsagePayloadV1({v: 1, global: {}, byQuery: []})).toBeNull();
  });
});

describe('capQuickOpenUsageByQuery', () => {
  test('caps URIs per query', () => {
    const raw = {
      q: Object.fromEntries(
        Array.from({length: 10}, (_, i) => [`file:///v/n${i}.md`, i + 1]),
      ),
    };
    const capped = capQuickOpenUsageByQuery(raw, 5, 3);
    expect(Object.keys(capped.q).length).toBe(3);
  });

  test('merges sibling keys that normalize to the same query', () => {
    const capped = capQuickOpenUsageByQuery(
      {
        ALP: {'file:///v/a.md': 5},
        alp: {'file:///v/b.md': 3},
      },
      10,
      50,
    );
    expect(capped).toEqual({
      alp: {'file:///v/a.md': 5, 'file:///v/b.md': 3},
    });
  });
});

describe('buildQuickOpenUsageScoreLookup', () => {
  test('returns the same lookup function for repeated calls with the same query', () => {
    const fn1 = buildQuickOpenUsageScoreLookup('alp');
    const fn2 = buildQuickOpenUsageScoreLookup('alp');
    expect(fn1).toBe(fn2);
  });

  test('invalidates cache after recording a new pick', () => {
    const before = buildQuickOpenUsageScoreLookup('alp');
    recordQuickOpenNoteUsage('file:///v/a.md', 'alp');
    const after = buildQuickOpenUsageScoreLookup('alp');
    expect(after).not.toBe(before);
    expect(after('file:///v/a.md').favScore).toBe(1);
  });
});

describe('quickOpenUsageQueryRelationWeight', () => {
  test('exact match is weight 1', () => {
    expect(quickOpenUsageQueryRelationWeight('alp', 'alp')).toBe(1);
  });

  test('prefix relation is half weight', () => {
    expect(quickOpenUsageQueryRelationWeight('alp', 'alpha')).toBe(
      QUICK_OPEN_USAGE_PREFIX_QUERY_WEIGHT,
    );
    expect(quickOpenUsageQueryRelationWeight('alpha', 'alp')).toBe(
      QUICK_OPEN_USAGE_PREFIX_QUERY_WEIGHT,
    );
  });

  test('unrelated queries return null', () => {
    expect(quickOpenUsageQueryRelationWeight('alp', 'beta')).toBeNull();
  });
});

describe('flushQuickOpenUsageToStore', () => {
  test('explicit flush cancels a pending debounced save', async () => {
    vi.useFakeTimers();
    recordQuickOpenNoteUsage('file:///v/a.md', 'alp');
    expect(storeSave).not.toHaveBeenCalled();
    await flushQuickOpenUsageToStore();
    expect(storeSave).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(QUICK_OPEN_USAGE_DEBOUNCE_SAVE_MS);
    expect(storeSave).toHaveBeenCalledTimes(1);
  });
});

describe('getQuickOpenUsageScores / recordQuickOpenNoteUsage', () => {
  test('exact query pick gives favScore 1', () => {
    recordQuickOpenNoteUsage('file:///v/a.md', 'alp');
    expect(getQuickOpenUsageScores('file:///v/a.md', 'alp')).toEqual({
      favScore: 1,
      globalScore: 1,
    });
  });

  test('prefix-related stored query gives half weight', () => {
    recordQuickOpenNoteUsage('file:///v/a.md', 'alpha');
    expect(getQuickOpenUsageScores('file:///v/a.md', 'alp')).toEqual({
      favScore: QUICK_OPEN_USAGE_PREFIX_QUERY_WEIGHT,
      globalScore: 1,
    });
  });

  test('sums exact and prefix-related query picks', () => {
    recordQuickOpenNoteUsage('file:///v/a.md', 'alpha');
    recordQuickOpenNoteUsage('file:///v/a.md', 'alp');
    expect(getQuickOpenUsageScores('file:///v/a.md', 'alp')).toEqual({
      favScore: 1 + QUICK_OPEN_USAGE_PREFIX_QUERY_WEIGHT,
      globalScore: 2,
    });
  });

  test('unrelated query has zero favScore but keeps global', () => {
    recordQuickOpenNoteUsage('file:///v/a.md', 'beta');
    expect(getQuickOpenUsageScores('file:///v/a.md', 'other')).toEqual({
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
});

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
  flushQuickOpenUsageToStore,
  getQuickOpenUsageScores,
  getQuickOpenUsageRevision,
  hydrateQuickOpenUsageFromStore,
  QUICK_OPEN_USAGE_DEBOUNCE_SAVE_MS,
  QUICK_OPEN_USAGE_PREFIX_QUERY_WEIGHT,
  recordQuickOpenNoteUsage,
  subscribeQuickOpenUsageRevision,
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

describe('usage revision', () => {
  test('record and hydrate bump revision and notify subscribers', async () => {
    let revision = getQuickOpenUsageRevision();
    const seen: number[] = [];
    const unsubscribe = subscribeQuickOpenUsageRevision(() => {
      revision = getQuickOpenUsageRevision();
      seen.push(revision);
    });

    recordQuickOpenNoteUsage('file:///v/a.md', 'alp');
    expect(revision).toBe(1);
    expect(seen).toEqual([1]);

    await hydrateQuickOpenUsageFromStore();
    expect(revision).toBe(2);
    expect(seen).toEqual([1, 2]);

    unsubscribe();
  });
});

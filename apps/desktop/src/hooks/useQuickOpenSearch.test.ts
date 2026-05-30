import type {VaultMarkdownRef} from '@eskerra/core';
import {act, renderHook} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {QUICK_OPEN_SEARCH_DEBOUNCE_MS, useQuickOpenSearch} from './useQuickOpenSearch';
import * as quickOpenUsageStore from '../lib/quickOpenUsageStore';
import {
  getQuickOpenUsageRevision,
  hydrateQuickOpenUsageFromStore,
  recordQuickOpenNoteUsage,
  __resetForTests,
} from '../lib/quickOpenUsageStore';

vi.mock('@tauri-apps/plugin-store', () => ({
  load: vi.fn(async () => ({
    get: vi.fn(async () => undefined),
    set: vi.fn(async () => {}),
    save: vi.fn(async () => {}),
  })),
}));

const VAULT = 'file:///v';
const REFS: VaultMarkdownRef[] = [
  {name: 'Alpha', uri: 'file:///v/Inbox/Alpha.md'},
  {name: 'Beta', uri: 'file:///v/General/Beta.md'},
];
const ALP_REFS: VaultMarkdownRef[] = [
  {name: 'Alpha', uri: 'file:///v/Inbox/Alpha.md'},
  {name: 'Alpine', uri: 'file:///v/Inbox/Alpine.md'},
  {name: 'Beta', uri: 'file:///v/General/Beta.md'},
];
const ALP_TIER_REFS: VaultMarkdownRef[] = [
  {name: 'Alpha', uri: 'file:///v/Inbox/Alpha.md'},
  {name: 'Salp', uri: 'file:///v/Inbox/Salp.md'},
];

describe('useQuickOpenSearch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __resetForTests();
  });

  afterEach(() => {
    __resetForTests();
    vi.useRealTimers();
  });

  it('shows no results before the first debounce fires', () => {
    const {result} = renderHook(
      ({search}) => useQuickOpenSearch(search, VAULT, REFS),
      {initialProps: {search: 'alp'}},
    );
    expect(result.current.searchPending).toBe(true);
    expect(result.current.displayed).toEqual([]);
  });

  it('updates displayed results after debounce', () => {
    const {result} = renderHook(
      ({search}) => useQuickOpenSearch(search, VAULT, REFS),
      {initialProps: {search: 'alp'}},
    );
    act(() => {
      vi.advanceTimersByTime(QUICK_OPEN_SEARCH_DEBOUNCE_MS);
    });
    expect(result.current.searchPending).toBe(false);
    expect(result.current.displayed).toEqual([
      {name: 'Alpha', uri: 'file:///v/Inbox/Alpha.md'},
    ]);
  });

  it('keeps previous results while a new query is pending (regression)', () => {
    const {result, rerender} = renderHook(
      ({search}) => useQuickOpenSearch(search, VAULT, REFS),
      {initialProps: {search: 'alp'}},
    );
    act(() => {
      vi.advanceTimersByTime(QUICK_OPEN_SEARCH_DEBOUNCE_MS);
    });
    expect(result.current.displayed).toHaveLength(1);

    rerender({search: 'alpz'});
    expect(result.current.searchPending).toBe(true);
    expect(result.current.displayed).toEqual([
      {name: 'Alpha', uri: 'file:///v/Inbox/Alpha.md'},
    ]);

    act(() => {
      vi.advanceTimersByTime(QUICK_OPEN_SEARCH_DEBOUNCE_MS);
    });
    expect(result.current.searchPending).toBe(false);
    expect(result.current.displayed).toEqual([]);
  });

  it('clears results when search is cleared', async () => {
    const {result, rerender} = renderHook(
      ({search}) => useQuickOpenSearch(search, VAULT, REFS),
      {initialProps: {search: 'alp'}},
    );
    act(() => {
      vi.advanceTimersByTime(QUICK_OPEN_SEARCH_DEBOUNCE_MS);
    });
    expect(result.current.displayed).toHaveLength(1);

    rerender({search: ''});
    expect(result.current.searchTrimmed).toBe('');
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.displayed).toEqual([]);
    expect(result.current.appliedQuery).toBe('');
  });

  it('exposes appliedQuery after debounce', () => {
    const {result} = renderHook(
      ({search}) => useQuickOpenSearch(search, VAULT, REFS),
      {initialProps: {search: 'alp'}},
    );
    expect(result.current.appliedQuery).toBe('');
    act(() => {
      vi.advanceTimersByTime(QUICK_OPEN_SEARCH_DEBOUNCE_MS);
    });
    expect(result.current.appliedQuery).toBe('alp');
  });

  it('ranks matching notes by Quick Open usage after debounce', () => {
    recordQuickOpenNoteUsage('file:///v/Inbox/Alpine.md', 'alp');
    recordQuickOpenNoteUsage('file:///v/Inbox/Alpine.md', 'alp');
    recordQuickOpenNoteUsage('file:///v/Inbox/Alpha.md', 'alp');

    const {result} = renderHook(
      ({search}) => useQuickOpenSearch(search, VAULT, ALP_REFS),
      {initialProps: {search: 'alp'}},
    );
    act(() => {
      vi.advanceTimersByTime(QUICK_OPEN_SEARCH_DEBOUNCE_MS);
    });
    expect(result.current.displayed).toEqual([
      {name: 'Alpine', uri: 'file:///v/Inbox/Alpine.md'},
      {name: 'Alpha', uri: 'file:///v/Inbox/Alpha.md'},
    ]);
  });

  it('re-sorts when usage hydration completes after the first query', async () => {
    const {result} = renderHook(
      ({search}) => useQuickOpenSearch(search, VAULT, ALP_REFS),
      {initialProps: {search: 'alp'}},
    );
    act(() => {
      vi.advanceTimersByTime(QUICK_OPEN_SEARCH_DEBOUNCE_MS);
    });
    expect(result.current.displayed.map(r => r.name)).toEqual(['Alpha', 'Alpine']);

    recordQuickOpenNoteUsage('file:///v/Inbox/Alpine.md', 'alp');
    recordQuickOpenNoteUsage('file:///v/Inbox/Alpine.md', 'alp');
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.displayed.map(r => r.name)).toEqual(['Alpine', 'Alpha']);
  });

  it('re-sorts after hydrateQuickOpenUsageFromStore bumps usage revision', async () => {
    const storeGet = vi.fn(async () =>
      JSON.stringify({
        v: 1,
        global: {'file:///v/Inbox/Alpine.md': 2},
        byQuery: {alp: {'file:///v/Inbox/Alpine.md': 2}},
      }),
    );
    const {load} = await import('@tauri-apps/plugin-store');
    vi.mocked(load).mockResolvedValueOnce({
      get: storeGet,
      set: vi.fn(async () => {}),
      save: vi.fn(async () => {}),
    } as never);

    const {result} = renderHook(
      ({search}) => useQuickOpenSearch(search, VAULT, ALP_REFS),
      {initialProps: {search: 'alp'}},
    );
    act(() => {
      vi.advanceTimersByTime(QUICK_OPEN_SEARCH_DEBOUNCE_MS);
    });
    expect(result.current.displayed.map(r => r.name)).toEqual(['Alpha', 'Alpine']);
    expect(getQuickOpenUsageRevision()).toBe(0);

    await act(async () => {
      await hydrateQuickOpenUsageFromStore();
    });
    expect(getQuickOpenUsageRevision()).toBe(1);
    expect(result.current.displayed.map(r => r.name)).toEqual(['Alpine', 'Alpha']);
  });

  it('re-sorts by hydrated query favorite over a better match tier', async () => {
    const storeGet = vi.fn(async () =>
      JSON.stringify({
        v: 1,
        global: {},
        byQuery: {alp: {'file:///v/Inbox/Salp.md': 1}},
      }),
    );
    const {load} = await import('@tauri-apps/plugin-store');
    vi.mocked(load).mockResolvedValueOnce({
      get: storeGet,
      set: vi.fn(async () => {}),
      save: vi.fn(async () => {}),
    } as never);

    const {result} = renderHook(
      ({search}) => useQuickOpenSearch(search, VAULT, ALP_TIER_REFS),
      {initialProps: {search: 'alp'}},
    );
    act(() => {
      vi.advanceTimersByTime(QUICK_OPEN_SEARCH_DEBOUNCE_MS);
    });
    expect(result.current.displayed.map(r => r.name)).toEqual(['Alpha', 'Salp']);

    await act(async () => {
      await hydrateQuickOpenUsageFromStore();
    });
    expect(result.current.displayed.map(r => r.name)).toEqual(['Salp', 'Alpha']);
  });

  it('re-reads usage revision on render after hydrate without subscribe notify', async () => {
    const storeGet = vi.fn(async () =>
      JSON.stringify({
        v: 1,
        global: {'file:///v/Inbox/Alpine.md': 2},
        byQuery: {alp: {'file:///v/Inbox/Alpine.md': 2}},
      }),
    );
    const {load} = await import('@tauri-apps/plugin-store');
    vi.mocked(load).mockResolvedValueOnce({
      get: storeGet,
      set: vi.fn(async () => {}),
      save: vi.fn(async () => {}),
    } as never);
    vi.spyOn(quickOpenUsageStore, 'subscribeQuickOpenUsageRevision').mockImplementation(
      () => () => {},
    );

    const {result, rerender} = renderHook(
      ({search}) => useQuickOpenSearch(search, VAULT, ALP_REFS),
      {initialProps: {search: 'alp'}},
    );
    act(() => {
      vi.advanceTimersByTime(QUICK_OPEN_SEARCH_DEBOUNCE_MS);
    });
    expect(result.current.displayed.map(r => r.name)).toEqual(['Alpha', 'Alpine']);

    await act(async () => {
      await hydrateQuickOpenUsageFromStore();
    });
    expect(getQuickOpenUsageRevision()).toBe(1);

    rerender({search: 'alp'});
    expect(result.current.displayed.map(r => r.name)).toEqual(['Alpine', 'Alpha']);
  });
});

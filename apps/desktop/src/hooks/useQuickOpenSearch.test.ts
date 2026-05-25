import type {VaultMarkdownRef} from '@eskerra/core';
import {act, renderHook} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {QUICK_OPEN_SEARCH_DEBOUNCE_MS, useQuickOpenSearch} from './useQuickOpenSearch';
import {recordQuickOpenNoteUsage, __resetForTests} from '../lib/quickOpenUsageStore';

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
});

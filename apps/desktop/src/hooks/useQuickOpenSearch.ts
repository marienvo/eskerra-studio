import type {VaultMarkdownRef} from '@eskerra/core';
import {useEffect, useMemo, useState, useSyncExternalStore} from 'react';

import {filterVaultNotesForQuickOpen} from '../lib/quickOpenNoteFilter';
import {
  buildQuickOpenUsageScoreLookup,
  getQuickOpenUsageRevision,
  subscribeQuickOpenUsageRevision,
} from '../lib/quickOpenUsageStore';

export const QUICK_OPEN_SEARCH_DEBOUNCE_MS = 300;

/**
 * Debounced quick-open query over vault note refs. Keeps showing the last applied
 * filter results while the user types (until debounce catches up), matching full
 * vault search UX.
 */
export function useQuickOpenSearch(
  search: string,
  vaultRoot: string,
  refs: readonly VaultMarkdownRef[],
) {
  const [appliedQuery, setAppliedQuery] = useState('');
  const usageRevision = useSyncExternalStore(
    subscribeQuickOpenUsageRevision,
    getQuickOpenUsageRevision,
    getQuickOpenUsageRevision,
  );
  const searchTrimmed = search.trim();

  useEffect(() => {
    if (!searchTrimmed) {
      queueMicrotask(() => {
        setAppliedQuery('');
      });
      return;
    }
    const t = window.setTimeout(() => {
      setAppliedQuery(searchTrimmed);
    }, QUICK_OPEN_SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [search, searchTrimmed]);

  const filtered = useMemo(() => {
    const getScores =
      appliedQuery.length > 0 && usageRevision >= 0
        ? buildQuickOpenUsageScoreLookup(appliedQuery)
        : undefined;
    return filterVaultNotesForQuickOpen(appliedQuery, vaultRoot, refs, getScores);
  }, [appliedQuery, refs, usageRevision, vaultRoot]);

  const searchPending =
    searchTrimmed.length > 0 && appliedQuery !== searchTrimmed;

  const displayed = filtered;

  return {appliedQuery, displayed, searchPending, searchTrimmed};
}

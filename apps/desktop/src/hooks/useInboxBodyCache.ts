import {
  useCallback,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';

import type {LastPersisted} from './workspaceFsWatchReconcile';
import {normalizeVaultMarkdownDiskRead} from './inboxNoteBodyCache';

export function hasLastPersistedCacheMismatch(
  cache: Record<string, string>,
  lastPersisted: LastPersisted | null,
): boolean {
  if (lastPersisted == null) {
    return false;
  }
  const cached = cache[lastPersisted.uri];
  if (cached === undefined) {
    return false;
  }
  return (
    normalizeVaultMarkdownDiskRead(cached)
    !== normalizeVaultMarkdownDiskRead(lastPersisted.markdown)
  );
}

export type UseInboxBodyCacheResult = {
  inboxContentByUri: Record<string, string>;
  setInboxContentByUri: Dispatch<SetStateAction<Record<string, string>>>;
  inboxContentByUriRef: MutableRefObject<Record<string, string>>;
  lastPersistedRef: MutableRefObject<LastPersisted | null>;
  lastPersistedExternalMutationSeqRef: MutableRefObject<number>;
  /**
   * Updates disk-known snapshot without bumping `lastPersistedExternalMutationSeqRef`. Pair with
   * {@link bumpLastPersistedExternalMutationSeq} except for vault-watch open-tab probe, which
   * overrides the bump to detect silent disk drift without treating it as an external mutation.
   */
  writeLastPersistedSnapshotWithoutSeqBump: (next: LastPersisted | null) => void;
  bumpLastPersistedExternalMutationSeq: () => void;
  setLastPersistedSnapshot: (next: LastPersisted) => void;
  clearLastPersistedSnapshot: () => void;
};

export function useInboxBodyCache(): UseInboxBodyCacheResult {
  const [inboxContentByUriState, setInboxContentByUriState] = useState<Record<string, string>>({});
  const inboxContentByUriRef = useRef<Record<string, string>>({});
  const lastPersistedRef = useRef<LastPersisted | null>(null);
  const lastPersistedExternalMutationSeqRef = useRef(0);

  const setInboxContentByUri = useCallback(
    (next: SetStateAction<Record<string, string>>) => {
      setInboxContentByUriState(prev => {
        const resolved = typeof next === 'function' ? next(prev) : next;
        inboxContentByUriRef.current = resolved;
        return resolved;
      });
    },
    [],
  );

  const writeLastPersistedSnapshotWithoutSeqBump = useCallback((next: LastPersisted | null) => {
    lastPersistedRef.current = next;
  }, []);

  const bumpLastPersistedExternalMutationSeq = useCallback(() => {
    lastPersistedExternalMutationSeqRef.current += 1;
  }, []);

  const setLastPersistedSnapshot = useCallback(
    (next: LastPersisted) => {
      writeLastPersistedSnapshotWithoutSeqBump(next);
      bumpLastPersistedExternalMutationSeq();
    },
    [bumpLastPersistedExternalMutationSeq, writeLastPersistedSnapshotWithoutSeqBump],
  );

  const clearLastPersistedSnapshot = useCallback(() => {
    writeLastPersistedSnapshotWithoutSeqBump(null);
    bumpLastPersistedExternalMutationSeq();
  }, [bumpLastPersistedExternalMutationSeq, writeLastPersistedSnapshotWithoutSeqBump]);

  return {
    inboxContentByUri: inboxContentByUriState,
    setInboxContentByUri,
    inboxContentByUriRef,
    lastPersistedRef,
    lastPersistedExternalMutationSeqRef,
    writeLastPersistedSnapshotWithoutSeqBump,
    bumpLastPersistedExternalMutationSeq,
    setLastPersistedSnapshot,
    clearLastPersistedSnapshot,
  };
}

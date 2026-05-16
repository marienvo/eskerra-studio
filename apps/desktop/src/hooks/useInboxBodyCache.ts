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

  const setLastPersistedSnapshot = useCallback((next: LastPersisted) => {
    lastPersistedRef.current = next;
    lastPersistedExternalMutationSeqRef.current += 1;
  }, []);

  const clearLastPersistedSnapshot = useCallback(() => {
    lastPersistedRef.current = null;
    lastPersistedExternalMutationSeqRef.current += 1;
  }, []);

  return {
    inboxContentByUri: inboxContentByUriState,
    setInboxContentByUri,
    inboxContentByUriRef,
    lastPersistedRef,
    lastPersistedExternalMutationSeqRef,
    setLastPersistedSnapshot,
    clearLastPersistedSnapshot,
  };
}

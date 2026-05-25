import type {Dispatch, MutableRefObject, SetStateAction} from 'react';

import {mergeInboxNoteBodyIntoCache} from '../inboxNoteBodyCache';

export function mergeInboxNoteBodyCacheRefAndState(
  inboxContentByUriRef: MutableRefObject<Record<string, string>>,
  setInboxContentByUri: Dispatch<SetStateAction<Record<string, string>>>,
  norm: string,
  body: string,
): void {
  const nextCache = mergeInboxNoteBodyIntoCache(
    inboxContentByUriRef.current,
    norm,
    body,
  );
  if (!nextCache) {
    return;
  }
  inboxContentByUriRef.current = nextCache;
  setInboxContentByUri(prev => mergeInboxNoteBodyIntoCache(prev, norm, body) ?? prev);
}

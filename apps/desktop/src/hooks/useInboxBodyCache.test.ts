import {act, renderHook} from '@testing-library/react';
import {describe, expect, it} from 'vitest';

import {
  hasLastPersistedCacheMismatch,
  useInboxBodyCache,
} from './useInboxBodyCache';

describe('useInboxBodyCache', () => {
  it('keeps inboxContentByUri state and ref aligned through setter updates', () => {
    const {result} = renderHook(() => useInboxBodyCache());

    act(() => {
      result.current.setInboxContentByUri({'/vault/Inbox/a.md': '# a'});
    });

    expect(result.current.inboxContentByUri).toEqual({'/vault/Inbox/a.md': '# a'});
    expect(result.current.inboxContentByUriRef.current).toEqual({'/vault/Inbox/a.md': '# a'});

    act(() => {
      result.current.setInboxContentByUri(prev => ({
        ...prev,
        '/vault/Inbox/b.md': '# b',
      }));
    });

    expect(result.current.inboxContentByUri).toEqual({
      '/vault/Inbox/a.md': '# a',
      '/vault/Inbox/b.md': '# b',
    });
    expect(result.current.inboxContentByUriRef.current).toEqual({
      '/vault/Inbox/a.md': '# a',
      '/vault/Inbox/b.md': '# b',
    });
  });

  it('tracks lastPersisted snapshot with mutation sequence bumps', () => {
    const {result} = renderHook(() => useInboxBodyCache());

    act(() => {
      result.current.setLastPersistedSnapshot({
        uri: '/vault/Inbox/a.md',
        markdown: '# disk-known',
      });
    });

    expect(result.current.lastPersistedRef.current).toEqual({
      uri: '/vault/Inbox/a.md',
      markdown: '# disk-known',
    });
    expect(result.current.lastPersistedExternalMutationSeqRef.current).toBe(1);

    act(() => {
      result.current.clearLastPersistedSnapshot();
    });

    expect(result.current.lastPersistedRef.current).toBeNull();
    expect(result.current.lastPersistedExternalMutationSeqRef.current).toBe(2);
  });

  it('detects mismatches between cache and lastPersisted for the same URI', () => {
    expect(
      hasLastPersistedCacheMismatch(
        {'/vault/Inbox/a.md': '# cached'},
        {uri: '/vault/Inbox/a.md', markdown: '# disk-known'},
      ),
    ).toBe(true);

    expect(
      hasLastPersistedCacheMismatch(
        {'/vault/Inbox/a.md': '# same\r\n'},
        {uri: '/vault/Inbox/a.md', markdown: '# same\n'},
      ),
    ).toBe(false);

    expect(
      hasLastPersistedCacheMismatch(
        {'/vault/Inbox/b.md': '# other'},
        {uri: '/vault/Inbox/a.md', markdown: '# disk-known'},
      ),
    ).toBe(false);
  });
});

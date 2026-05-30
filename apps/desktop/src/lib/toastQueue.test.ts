import {describe, expect, it} from 'vitest';

import {diffToastIds} from './toastQueue';

describe('diffToastIds', () => {
  it('returns an empty result when nothing changed', () => {
    const seenIds = new Set(['a', 'b']);
    const liveIds = new Set(['a', 'b']);
    const currentIds = ['a', 'b'];

    const result = diffToastIds({seenIds, liveIds, currentIds});

    expect(result.appeared).toEqual([]);
    expect(result.removed).toEqual([]);
  });

  it('marks a newly added id as appeared', () => {
    const seenIds = new Set(['a']);
    const liveIds = new Set(['a']);
    const currentIds = ['a', 'b'];

    const result = diffToastIds({seenIds, liveIds, currentIds});

    expect(result.appeared).toEqual(['b']);
    expect(result.removed).toEqual([]);
  });

  it('marks a live id absent from currentIds as removed', () => {
    const seenIds = new Set(['a', 'b']);
    const liveIds = new Set(['a', 'b']);
    const currentIds = ['a'];

    const result = diffToastIds({seenIds, liveIds, currentIds});

    expect(result.appeared).toEqual([]);
    expect(result.removed).toEqual(['b']);
  });

  it('does not re-appear an id that is in seenIds even if live', () => {
    const seenIds = new Set(['a', 'b']);
    const liveIds = new Set(['a']);
    const currentIds = ['a', 'b'];

    const result = diffToastIds({seenIds, liveIds, currentIds});

    // 'b' is in seenIds so it must not appear again (it already expired as a toast)
    expect(result.appeared).toEqual([]);
    expect(result.removed).toEqual([]);
  });

  it('does not re-appear a mount-backlog id that was pre-seeded', () => {
    // Simulates the mount scenario: seenIds is pre-populated with existing items
    // so they never flash as new toasts on first render.
    const seenIds = new Set(['existing-1', 'existing-2']);
    const liveIds: ReadonlySet<string> = new Set();
    const currentIds = ['existing-1', 'existing-2'];

    const result = diffToastIds({seenIds, liveIds, currentIds});

    expect(result.appeared).toEqual([]);
    expect(result.removed).toEqual([]);
  });

  it('handles a combination of appeared and removed simultaneously', () => {
    const seenIds = new Set(['a', 'b']);
    const liveIds = new Set(['a', 'b']);
    const currentIds = ['b', 'c'];

    const result = diffToastIds({seenIds, liveIds, currentIds});

    // 'c' is new; 'a' was removed from currentIds
    expect(result.appeared).toEqual(['c']);
    expect(result.removed).toEqual(['a']);
  });

  it('handles an empty items list (clearAll scenario)', () => {
    const seenIds = new Set(['a', 'b']);
    const liveIds = new Set(['a', 'b']);
    const currentIds: string[] = [];

    const result = diffToastIds({seenIds, liveIds, currentIds});

    expect(result.appeared).toEqual([]);
    expect(result.removed).toContain('a');
    expect(result.removed).toContain('b');
    expect(result.removed).toHaveLength(2);
  });
});

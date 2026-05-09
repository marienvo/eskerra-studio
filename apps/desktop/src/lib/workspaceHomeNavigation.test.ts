import {describe, expect, it} from 'vitest';

import {
  createWorkspaceHomeState,
  homeCanGoBack,
  homeCanGoForward,
  homeCurrentUri,
  homeGoBack,
  homeGoForward,
  homeIsAtHub,
  homeRemapPrefix,
  homeRemoveUris,
  pushHomeNavigate,
} from './workspaceHomeNavigation';

describe('workspaceHomeNavigation', () => {
  it('starts at the hub Today URI', () => {
    const state = createWorkspaceHomeState('/vault/Daily/Today.md');

    expect(homeCurrentUri(state)).toBe('/vault/Daily/Today.md');
    expect(homeIsAtHub(state)).toBe(true);
    expect(homeCanGoBack(state)).toBe(false);
    expect(homeCanGoForward(state)).toBe(false);
  });

  it('pushes entries and navigates back and forward', () => {
    const state = pushHomeNavigate(
      pushHomeNavigate(createWorkspaceHomeState('/vault/Daily/Today.md'), '/vault/A.md'),
      '/vault/B.md',
    );

    expect(homeCurrentUri(state)).toBe('/vault/B.md');
    expect(homeCanGoBack(state)).toBe(true);
    expect(homeCanGoForward(state)).toBe(false);

    const back = homeGoBack(state);
    expect(homeCurrentUri(back)).toBe('/vault/A.md');
    expect(homeIsAtHub(back)).toBe(false);
    expect(homeCanGoForward(back)).toBe(true);

    const forward = homeGoForward(back);
    expect(homeCurrentUri(forward)).toBe('/vault/B.md');
  });

  it('drops forward history when pushing from the middle', () => {
    const state = pushHomeNavigate(
      pushHomeNavigate(createWorkspaceHomeState('/vault/Daily/Today.md'), '/vault/A.md'),
      '/vault/B.md',
    );
    const back = homeGoBack(state);
    const pushed = pushHomeNavigate(back, '/vault/C.md');

    expect(pushed.history).toEqual({
      entries: ['/vault/Daily/Today.md', '/vault/A.md', '/vault/C.md'],
      index: 2,
    });
  });

  it('remaps URI prefixes', () => {
    const state = pushHomeNavigate(
      createWorkspaceHomeState('/vault/Daily/Today.md'),
      '/vault/Daily/Note.md',
    );

    expect(homeRemapPrefix(state, '/vault/Daily', '/vault/Archive').history).toEqual({
      entries: ['/vault/Archive/Today.md', '/vault/Archive/Note.md'],
      index: 1,
    });
  });

  it('removes matching non-hub entries', () => {
    const state = pushHomeNavigate(
      pushHomeNavigate(createWorkspaceHomeState('/vault/Daily/Today.md'), '/vault/A.md'),
      '/vault/B.md',
    );

    const next = homeRemoveUris(state, uri => uri === '/vault/B.md');

    expect(next?.history).toEqual({
      entries: ['/vault/Daily/Today.md', '/vault/A.md'],
      index: 1,
    });
  });

  it('returns null when the hub itself is removed', () => {
    const state = pushHomeNavigate(
      createWorkspaceHomeState('/vault/Daily/Today.md'),
      '/vault/A.md',
    );

    expect(homeRemoveUris(state, uri => uri === '/vault/Daily/Today.md')).toBeNull();
  });
});

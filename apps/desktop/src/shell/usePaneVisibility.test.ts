import {act, renderHook} from '@testing-library/react';
import {describe, expect, it} from 'vitest';

import {usePaneVisibility} from './usePaneVisibility';

describe('usePaneVisibility', () => {
  it('starts with defaults from DEFAULT_MAIN_WINDOW_PANE_VISIBILITY plus notifications=true', () => {
    const {result} = renderHook(() => usePaneVisibility());
    expect(result.current.visibility).toEqual({
      vault: false,
      episodes: true,
      inbox: true,
      notifications: true,
    });
  });

  it('setVisibility merges a partial update', () => {
    const {result} = renderHook(() => usePaneVisibility());
    act(() => result.current.setVisibility({inbox: false, notifications: false}));
    expect(result.current.visibility).toEqual({
      vault: false,
      episodes: true,
      inbox: false,
      notifications: false,
    });
  });

  it('togglePane flips a single key', () => {
    const {result} = renderHook(() => usePaneVisibility());
    act(() => result.current.togglePane('vault'));
    expect(result.current.visibility.vault).toBe(true);
    act(() => result.current.togglePane('vault'));
    expect(result.current.visibility.vault).toBe(false);
  });

  it('setVisibility and togglePane preserve referential stability across renders', () => {
    const {result, rerender} = renderHook(() => usePaneVisibility());
    const set1 = result.current.setVisibility;
    const toggle1 = result.current.togglePane;
    rerender();
    expect(result.current.setVisibility).toBe(set1);
    expect(result.current.togglePane).toBe(toggle1);
  });
});

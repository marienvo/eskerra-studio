import {act, renderHook} from '@testing-library/react';
import {afterEach, describe, expect, it, vi} from 'vitest';

import {useGitSyncTransientStatus} from './useGitSyncTransientStatus';

describe('useGitSyncTransientStatus', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows a transient status and clears it after the visible window', () => {
    vi.useFakeTimers();
    const {result} = renderHook(() => useGitSyncTransientStatus({visibleMs: 500}));

    act(() => {
      result.current.show({tone: 'success', label: 'Synced', icon: 'check_circle'});
    });

    expect(result.current.transient?.label).toBe('Synced');

    act(() => {
      vi.advanceTimersByTime(499);
    });
    expect(result.current.transient?.label).toBe('Synced');

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.transient).toBeNull();
  });

  it('resets the timer when show is called again', () => {
    vi.useFakeTimers();
    const {result} = renderHook(() => useGitSyncTransientStatus({visibleMs: 500}));

    act(() => {
      result.current.show({tone: 'success', label: 'Synced', icon: 'check_circle'});
      vi.advanceTimersByTime(300);
      result.current.show({tone: 'success', label: 'Synced • abcdef1', icon: 'check_circle'});
    });

    act(() => {
      vi.advanceTimersByTime(499);
    });
    expect(result.current.transient?.label).toBe('Synced • abcdef1');

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.transient).toBeNull();
  });

  it('clear cancels the timer and removes the transient status', () => {
    vi.useFakeTimers();
    const {result} = renderHook(() => useGitSyncTransientStatus({visibleMs: 500}));

    act(() => {
      result.current.show({tone: 'success', label: 'Synced', icon: 'check_circle'});
      result.current.clear();
      vi.advanceTimersByTime(500);
    });

    expect(result.current.transient).toBeNull();
  });
});

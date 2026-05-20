import {act, renderHook} from '@testing-library/react';
import {describe, expect, it} from 'vitest';

import {useLiveRef} from './useLiveRef';

describe('useLiveRef', () => {
  it('keeps the latest value in ref.current after rerender', () => {
    const {result, rerender} = renderHook(
      ({value}: {value: string}) => useLiveRef(value),
      {initialProps: {value: 'first'}},
    );
    expect(result.current.current).toBe('first');
    rerender({value: 'second'});
    expect(result.current.current).toBe('second');
  });

  it('returns a stable ref object identity', () => {
    const {result, rerender} = renderHook(
      ({value}: {value: number}) => useLiveRef(value),
      {initialProps: {value: 1}},
    );
    const firstRef = result.current;
    rerender({value: 2});
    expect(result.current).toBe(firstRef);
    expect(result.current.current).toBe(2);
  });

  it('supports object values and tracks latest assignment', () => {
    const {result, rerender} = renderHook(
      ({value}: {value: {count: number}}) => useLiveRef(value),
      {initialProps: {value: {count: 1}}},
    );
    act(() => {
      rerender({value: {count: 2}});
    });
    expect(result.current.current).toEqual({count: 2});
  });
});

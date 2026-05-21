import {useLayoutEffect, useRef} from 'react';

export function useLiveRef<T>(value: T) {
  const valueRef = useRef(value);
  useLayoutEffect(() => {
    valueRef.current = value;
  }, [value]);
  return valueRef;
}

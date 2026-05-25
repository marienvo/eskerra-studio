import {useLayoutEffect, type MutableRefObject} from 'react';

type RefBridge<T> = {
  target: MutableRefObject<T>;
  value: T;
};

/**
 * Fills imperative refs for async children (Today hub, vault bootstrap, open-note routing).
 */
export function useWorkspaceRefBridges<T extends readonly RefBridge<unknown>[]>(
  bridges: T,
  deps: readonly unknown[],
): void {
  useLayoutEffect(() => {
    for (const bridge of bridges) {
      // eslint-disable-next-line react-hooks/immutability -- imperative ref bridge for async children
      bridge.target.current = bridge.value;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bridges list is ephemeral; values tracked via deps
  }, deps);
}

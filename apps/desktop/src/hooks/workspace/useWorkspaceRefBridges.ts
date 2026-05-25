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
      // Ref assignment is intentional; bridge list is ephemeral per render.
      // eslint-disable-next-line react-hooks/immutability
      bridge.target.current = bridge.value;
    }
    // bridges identity is intentional each render; values tracked via deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

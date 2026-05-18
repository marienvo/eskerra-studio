import {useEffect, useRef} from 'react';

import {fireInboxClearedConfetti} from '../../lib/fireInboxClearedConfetti';

type UseVaultTabInboxPaneLifecycleInput = {
  vaultRoot: string;
  inboxHasItems: boolean;
  inboxPaneVisible: boolean;
  onCloseInboxPane: () => void;
};

export function useVaultTabInboxPaneLifecycle({
  vaultRoot,
  inboxHasItems,
  inboxPaneVisible,
  onCloseInboxPane,
}: UseVaultTabInboxPaneLifecycleInput) {
  const prevInboxHadItemsRef = useRef(false);
  useEffect(() => {
    const wasNonEmpty = prevInboxHadItemsRef.current;
    prevInboxHadItemsRef.current = inboxHasItems;
    if (wasNonEmpty && !inboxHasItems && inboxPaneVisible) {
      fireInboxClearedConfetti();
      const raf = requestAnimationFrame(() => {
        onCloseInboxPane();
      });
      return () => cancelAnimationFrame(raf);
    }
  }, [inboxHasItems, inboxPaneVisible, onCloseInboxPane]);

  const prevVaultRootForInboxTrackingRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevVaultRootForInboxTrackingRef.current;
    prevVaultRootForInboxTrackingRef.current = vaultRoot;
    if (prev != null && prev !== vaultRoot) {
      prevInboxHadItemsRef.current = false;
    }
  }, [vaultRoot]);
}

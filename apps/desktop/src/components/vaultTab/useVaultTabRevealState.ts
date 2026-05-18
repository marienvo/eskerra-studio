import {useCallback, useMemo, useState} from 'react';

import {
  getInboxDirectoryUri,
  normalizeVaultBaseUri,
  trimTrailingSlashes,
} from '@eskerra/core';

type UseVaultTabRevealStateInput = {
  vaultRoot: string;
  selectedUri: string | null;
  onOpenInboxPane: () => void;
};

export function useVaultTabRevealState({
  vaultRoot,
  selectedUri,
  onOpenInboxPane,
}: UseVaultTabRevealStateInput) {
  const [revealTreeNonce, setRevealTreeNonce] = useState(0);
  const normalizedVaultRootForTree = useMemo(
    () => trimTrailingSlashes(normalizeVaultBaseUri(vaultRoot).replace(/\\/g, '/')),
    [vaultRoot],
  );
  const inboxDirectoryUriForTree = useMemo(
    () =>
      trimTrailingSlashes(getInboxDirectoryUri(normalizedVaultRootForTree).replace(/\\/g, '/')),
    [normalizedVaultRootForTree],
  );

  const revealActiveNoteDisabled =
    selectedUri == null
    || (
      selectedUri !== normalizedVaultRootForTree
      && !selectedUri.startsWith(`${normalizedVaultRootForTree}/`)
    );

  const revealInInboxTreeDisabled =
    selectedUri == null
    || (
      selectedUri !== inboxDirectoryUriForTree
      && !selectedUri.startsWith(`${inboxDirectoryUriForTree}/`)
    );

  const bumpRevealActiveNoteInTree = useCallback(() => {
    if (
      selectedUri != null
      && (selectedUri === inboxDirectoryUriForTree
        || selectedUri.startsWith(`${inboxDirectoryUriForTree}/`))
    ) {
      onOpenInboxPane();
    }
    setRevealTreeNonce(n => n + 1);
  }, [selectedUri, inboxDirectoryUriForTree, onOpenInboxPane]);

  return {
    revealTreeNonce,
    revealActiveNoteDisabled,
    revealInInboxTreeDisabled,
    bumpRevealActiveNoteInTree,
  };
}

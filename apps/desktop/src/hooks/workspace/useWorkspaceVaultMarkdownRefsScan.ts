import {useEffect, useLayoutEffect, useRef, useState, type MutableRefObject} from 'react';

import {collectVaultMarkdownRefs, type VaultFilesystem, type VaultMarkdownRef} from '@eskerra/core';

type UseWorkspaceVaultMarkdownRefsScanInput = {
  vaultRoot: string | null;
  fs: VaultFilesystem;
  fsRefreshNonce: number;
  vaultMarkdownRefsRef: MutableRefObject<VaultMarkdownRef[]>;
};

export function useWorkspaceVaultMarkdownRefsScan({
  vaultRoot,
  fs,
  fsRefreshNonce,
  vaultMarkdownRefsRef,
}: UseWorkspaceVaultMarkdownRefsScanInput) {
  const [vaultMarkdownRefs, setVaultMarkdownRefs] = useState<VaultMarkdownRef[]>([]);
  /**
   * False while `vaultMarkdownRefs` for the current `{vaultRoot, fsRefreshNonce}` fetch has not
   * completed. `vaultMarkdownRefs` stays `[]` until the async scan finishes, so without this flag
   * `syncHubWorkspacesToVaultTodayRefsAction` could prune restored hub state on an empty URI
   * list during startup.
   */
  const [vaultMarkdownRefsReady, setVaultMarkdownRefsReady] = useState(false);
  const vaultRefsBuildGenRef = useRef(0);
  const vaultMarkdownRefsFetchKeyRef = useRef<{
    root: string | null;
    nonce: number;
  } | null>(null);

  useLayoutEffect(() => {
    const prev = vaultMarkdownRefsFetchKeyRef.current;
    const next = {root: vaultRoot, nonce: fsRefreshNonce};
    if (
      prev == null ||
      prev.root !== next.root ||
      prev.nonce !== next.nonce
    ) {
      vaultMarkdownRefsFetchKeyRef.current = next;
      setVaultMarkdownRefsReady(vaultRoot == null);
    }
  }, [vaultRoot, fsRefreshNonce]);

  useEffect(() => {
    vaultMarkdownRefsRef.current = vaultMarkdownRefs;
  }, [vaultMarkdownRefs, vaultMarkdownRefsRef]);

  useEffect(() => {
    if (!vaultRoot) {
      queueMicrotask(() => {
        setVaultMarkdownRefs([]);
      });
      return;
    }
    const gen = ++vaultRefsBuildGenRef.current;
    const ac = new AbortController();
    void (async () => {
      try {
        const refs = await collectVaultMarkdownRefs(vaultRoot, fs, {signal: ac.signal});
        if (gen !== vaultRefsBuildGenRef.current) {
          return;
        }
        setVaultMarkdownRefs(refs);
        setVaultMarkdownRefsReady(true);
      } catch (e) {
        if (ac.signal.aborted) {
          return;
        }
        console.warn('[vaultMarkdownRefs]', e);
      }
    })();
    return () => {
      ac.abort();
    };
  }, [vaultRoot, fs, fsRefreshNonce]);

  return {
    vaultMarkdownRefs,
    vaultMarkdownRefsReady,
  };
}

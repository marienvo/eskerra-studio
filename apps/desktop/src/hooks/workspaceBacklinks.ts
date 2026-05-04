import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';

import type {VaultFilesystem, VaultMarkdownRef} from '@eskerra/core';

import {listInboxAllBacklinkReferrersForTarget} from '../lib/inboxAllBacklinkIndex';
import {mergeVaultBacklinkBodySeed} from '../lib/vaultBacklinkBodySeed';

import {loadVaultMarkdownBodiesWithSeed} from './inboxNoteBodyCache';

/** Debounce vault-wide backlink computation after selection / ref list changes (reads note bodies from disk). */
const VAULT_BACKLINK_COMPUTE_DEBOUNCE_MS = 320;

function equalReadonlyStringArrays(
  a: readonly string[],
  b: readonly string[],
): boolean {
  if (a === b) {
    return true;
  }
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

function refToNameAndUri(ref: {name: string; uri: string}): {name: string; uri: string} {
  return {name: ref.name, uri: ref.uri};
}

function refToNameAndUriList(
  refs: ReadonlyArray<{name: string; uri: string}>,
): {name: string; uri: string}[] {
  return refs.map(refToNameAndUri);
}

export async function computeSelectedNoteBacklinkUris(args: {
  fs: VaultFilesystem;
  vaultRoot: string;
  targetUri: string;
  refs: VaultMarkdownRef[];
  diskBodyCache: Record<string, string>;
  inboxContentByUri: Readonly<Record<string, string>>;
  activeUri: string | null;
  activeBody: string;
}): Promise<{uris: readonly string[]; pruned: Record<string, string>}> {
  const {
    fs,
    vaultRoot,
    targetUri,
    refs,
    diskBodyCache,
    inboxContentByUri,
    activeUri,
    activeBody,
  } = args;
  const seed = mergeVaultBacklinkBodySeed(diskBodyCache, inboxContentByUri);
  const expanded = await loadVaultMarkdownBodiesWithSeed(
    fs,
    refs,
    seed,
    activeUri,
    activeBody,
  );
  const pruned: Record<string, string> = {};
  for (const {uri} of refs) {
    pruned[uri] = expanded[uri] ?? '';
  }
  const uris = listInboxAllBacklinkReferrersForTarget({
    vaultRoot,
    targetUri,
    notes: refToNameAndUriList(refs),
    contentByUri: expanded,
    activeUri,
    activeBody,
  });
  return {uris, pruned};
}

export function useWorkspaceBacklinks(args: {
  fs: VaultFilesystem;
  vaultRoot: string | null;
  composingNewEntry: boolean;
  selectedUri: string | null;
  vaultMarkdownRefs: VaultMarkdownRef[];
  inboxContentByUri: Record<string, string>;
  selectedUriRef: MutableRefObject<string | null>;
  vaultMarkdownRefsRef: MutableRefObject<VaultMarkdownRef[]>;
  inboxContentByUriRef: MutableRefObject<Record<string, string>>;
}): {
  selectedNoteBacklinkUris: readonly string[];
  inboxBacklinksDeferNonce: number;
  backlinksActiveBodyRef: MutableRefObject<string>;
  setBacklinksActiveBody: Dispatch<SetStateAction<string>>;
  scheduleBacklinksDeferOneFrameAfterLoad: () => void;
  clearInboxBacklinksDeferAfterLoad: () => void;
  clearBacklinkDiskBodyCache: () => void;
} {
  const {
    fs,
    vaultRoot,
    composingNewEntry,
    selectedUri,
    vaultMarkdownRefs,
    inboxContentByUri,
    selectedUriRef,
    vaultMarkdownRefsRef,
    inboxContentByUriRef,
  } = args;
  const [backlinksActiveBody, setBacklinksActiveBody] = useState('');
  const [selectedNoteBacklinkUris, setSelectedNoteBacklinkUris] = useState<
    readonly string[]
  >([]);
  const [inboxBacklinksDeferNonce, setInboxBacklinksDeferNonce] = useState(0);
  /** Bodies read from disk for vault-wide backlink scan; avoids re-reading every note on each selection change. */
  const vaultBacklinkDiskBodyCacheRef = useRef<Record<string, string>>({});
  const backlinksActiveBodyRef = useRef('');
  const inboxBacklinksDeferAfterLoadRafRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    backlinksActiveBodyRef.current = backlinksActiveBody;
  }, [backlinksActiveBody]);

  const scheduleBacklinksDeferOneFrameAfterLoad = useCallback(() => {
    if (inboxBacklinksDeferAfterLoadRafRef.current != null) {
      cancelAnimationFrame(inboxBacklinksDeferAfterLoadRafRef.current);
      inboxBacklinksDeferAfterLoadRafRef.current = null;
    }
    setInboxBacklinksDeferNonce(n => n + 1);
    inboxBacklinksDeferAfterLoadRafRef.current = requestAnimationFrame(() => {
      inboxBacklinksDeferAfterLoadRafRef.current = null;
    });
  }, []);

  const clearInboxBacklinksDeferAfterLoad = useCallback(() => {
    if (inboxBacklinksDeferAfterLoadRafRef.current != null) {
      cancelAnimationFrame(inboxBacklinksDeferAfterLoadRafRef.current);
      inboxBacklinksDeferAfterLoadRafRef.current = null;
    }
  }, []);

  const clearBacklinkDiskBodyCache = useCallback(() => {
    vaultBacklinkDiskBodyCacheRef.current = {};
  }, []);

  useEffect(() => {
    return () => {
      if (inboxBacklinksDeferAfterLoadRafRef.current != null) {
        cancelAnimationFrame(inboxBacklinksDeferAfterLoadRafRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (composingNewEntry || !selectedUri || !vaultRoot) {
      queueMicrotask(() => {
        setSelectedNoteBacklinkUris([]);
      });
      return;
    }

    const selected = selectedUri;
    let cancelled = false;

    const runBacklinkScan = async () => {
      const activeUri = selectedUriRef.current;
      const activeBody = backlinksActiveBodyRef.current;
      if (cancelled || activeUri !== selected) {
        return;
      }
      try {
        const {uris, pruned} = await computeSelectedNoteBacklinkUris({
          fs,
          vaultRoot,
          targetUri: selected,
          refs: vaultMarkdownRefsRef.current,
          diskBodyCache: vaultBacklinkDiskBodyCacheRef.current,
          inboxContentByUri: inboxContentByUriRef.current,
          activeUri,
          activeBody,
        });
        vaultBacklinkDiskBodyCacheRef.current = pruned;
        if (cancelled || selectedUriRef.current !== selected) {
          return;
        }
        setSelectedNoteBacklinkUris(prev =>
          equalReadonlyStringArrays(prev, uris) ? prev : uris,
        );
      } catch {
        if (cancelled || selectedUriRef.current !== selected) {
          return;
        }
        setSelectedNoteBacklinkUris(prev => (prev.length === 0 ? prev : []));
      }
    };

    const tid = window.setTimeout(() => {
      if (cancelled) {
        return;
      }
      void runBacklinkScan();
    }, VAULT_BACKLINK_COMPUTE_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(tid);
    };
  }, [
    composingNewEntry,
    selectedUri,
    vaultRoot,
    vaultMarkdownRefs,
    inboxContentByUri,
    backlinksActiveBody,
    fs,
    selectedUriRef,
    vaultMarkdownRefsRef,
    inboxContentByUriRef,
  ]);

  return {
    selectedNoteBacklinkUris,
    inboxBacklinksDeferNonce,
    backlinksActiveBodyRef,
    setBacklinksActiveBody,
    scheduleBacklinksDeferOneFrameAfterLoad,
    clearInboxBacklinksDeferAfterLoad,
    clearBacklinkDiskBodyCache,
  };
}

import {listen} from '@tauri-apps/api/event';
import {
  getThemesDirectoryUri,
  listVaultThemes,
  normalizeVaultBaseUri,
  type VaultFilesystem,
  type VaultThemeListItem,
} from '@eskerra/core';
import {useCallback, useEffect, useMemo, useState} from 'react';

import {
  type VaultFilesChangedPayload,
  vaultFilesChangedIsCoarse,
} from '../lib/vaultFilesChangedPayload';

type UseVaultThemesParams = {
  vaultRoot: string | null;
  fs: VaultFilesystem;
  initialItems?: VaultThemeListItem[];
};

function normalizeFsPath(p: string): string {
  return p.replace(/\\/g, '/');
}

function themesDirHit(vaultRoot: string, changedPaths: readonly string[]): boolean {
  const dir = normalizeFsPath(getThemesDirectoryUri(normalizeVaultBaseUri(vaultRoot)));
  const prefix = dir.endsWith('/') ? dir : `${dir}/`;
  return changedPaths.some(p => {
    const n = normalizeFsPath(p);
    return n === dir || n.startsWith(prefix);
  });
}

export function useVaultThemes({vaultRoot, fs, initialItems = []}: UseVaultThemesParams): {
  items: VaultThemeListItem[];
  ready: boolean;
  reload: () => Promise<void>;
} {
  const [items, setItems] = useState<VaultThemeListItem[]>(initialItems);
  const [ready, setReady] = useState(initialItems.length > 0);

  const reload = useCallback(async () => {
    if (!vaultRoot) {
      setItems([]);
      setReady(true);
      return;
    }
    try {
      const next = await listVaultThemes(vaultRoot, fs);
      setItems(next);
    } catch {
      setItems([]);
    }
    setReady(true);
  }, [vaultRoot, fs]);

  useEffect(() => {
    queueMicrotask(() => {
      void reload();
    });
  }, [reload]);

  useEffect(() => {
    if (!vaultRoot) {
      return;
    }
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    listen<VaultFilesChangedPayload>('vault-files-changed', event => {
      const paths = event.payload?.paths ?? [];
      const coarse = vaultFilesChangedIsCoarse(event.payload);
      if (!coarse && !themesDirHit(vaultRoot, paths)) {
        return;
      }
      void reload();
    }).then(fn => {
      if (!cancelled) {
        unlisten = fn;
      } else {
        fn();
      }
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [vaultRoot, reload]);

  return useMemo(() => ({items, ready, reload}), [items, ready, reload]);
}

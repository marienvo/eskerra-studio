import {Suspense} from 'react';

import type {VaultMarkdownRef} from '@eskerra/core';

import {
  LazyQuickOpenNotePalette,
  LazyVaultSearchPalette,
} from './AppLazyUi';

export type AppPaletteLayerProps = {
  vaultRoot: string;
  vaultMarkdownRefs: readonly VaultMarkdownRef[];
  onPickNote: (uri: string) => void;
  quickOpenOpen: boolean;
  setQuickOpenOpen: (open: boolean) => void;
  vaultSearchOpen: boolean;
  setVaultSearchOpen: (open: boolean) => void;
};

export function AppPaletteLayer({
  vaultRoot,
  vaultMarkdownRefs,
  onPickNote,
  quickOpenOpen,
  setQuickOpenOpen,
  vaultSearchOpen,
  setVaultSearchOpen,
}: AppPaletteLayerProps) {
  return (
    <Suspense fallback={null}>
      {quickOpenOpen ? (
        <LazyQuickOpenNotePalette
          open={quickOpenOpen}
          onOpenChange={setQuickOpenOpen}
          vaultRoot={vaultRoot}
          refs={vaultMarkdownRefs}
          onPickNote={onPickNote}
        />
      ) : null}
      {vaultSearchOpen ? (
        <LazyVaultSearchPalette
          open={vaultSearchOpen}
          onOpenChange={setVaultSearchOpen}
          vaultRoot={vaultRoot}
          onPickNote={onPickNote}
        />
      ) : null}
    </Suspense>
  );
}

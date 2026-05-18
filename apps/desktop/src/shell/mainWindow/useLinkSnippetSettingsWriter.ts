import {useCallback} from 'react';

import type {EskerraSettings, VaultFilesystem} from '@eskerra/core';

import {writeVaultSettings} from '../../lib/vaultBootstrap';

type UseLinkSnippetSettingsWriterInput = {
  vaultRoot: string | null;
  vaultSettings: EskerraSettings | null;
  fs: VaultFilesystem;
  setVaultSettings: (next: EskerraSettings) => void;
};

export function useLinkSnippetSettingsWriter({
  vaultRoot,
  vaultSettings,
  fs,
  setVaultSettings,
}: UseLinkSnippetSettingsWriterInput) {
  return useCallback(
    async (domain: string) => {
      if (!vaultRoot || !vaultSettings) return;
      const current = new Set(vaultSettings.linkSnippetBlockedDomains ?? []);
      if (current.has(domain)) return;
      current.add(domain);
      const next = {...vaultSettings, linkSnippetBlockedDomains: [...current]};
      setVaultSettings(next);
      await writeVaultSettings(vaultRoot, fs, next);
    },
    [vaultRoot, vaultSettings, fs, setVaultSettings],
  );
}

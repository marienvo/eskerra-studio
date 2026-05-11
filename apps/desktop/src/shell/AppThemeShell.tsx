import type {EskerraSettings} from '@eskerra/core';
import type {ReactNode, SetStateAction} from 'react';

import {ThemeProvider} from '../theme/ThemeProvider';
import type {createTauriVaultFilesystem} from '../lib/tauriVault';

type AppThemeShellProps = {
  vaultRoot: string | null;
  vaultSettings: EskerraSettings | null;
  setVaultSettings: (s: SetStateAction<EskerraSettings | null>) => void;
  fs: ReturnType<typeof createTauriVaultFilesystem>;
  children: ReactNode;
};

export function AppThemeShell({
  vaultRoot,
  vaultSettings,
  setVaultSettings,
  fs,
  children,
}: AppThemeShellProps) {
  return (
    <ThemeProvider
      vaultRoot={vaultRoot}
      vaultSettings={vaultSettings}
      setVaultSettings={setVaultSettings}
      fs={fs}>
      {children}
    </ThemeProvider>
  );
}

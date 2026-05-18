import type {EskerraSettings} from '@eskerra/core';
import type {RefObject, SetStateAction} from 'react';

import type {createTauriVaultFilesystem} from '../../lib/tauriVault';
import type {WindowTilingState} from '../../lib/windowTiling';
import type {SessionNotification} from '../../lib/sessionNotifications';
import {AppBootstrapShell} from './AppBootstrapShell';

type AppLayoutsLoadingScreenProps = {
  appRootRef: RefObject<HTMLDivElement | null>;
  appRootClassName: string;
  vaultRoot: string;
  vaultSettings: EskerraSettings | null;
  setVaultSettings: (s: SetStateAction<EskerraSettings | null>) => void;
  fs: ReturnType<typeof createTauriVaultFilesystem>;
  tiling: WindowTilingState;
  closeSyncing: boolean;
  onCloseRequest: (input: {instant: boolean}) => void;
  closeSyncInProgress: boolean;
  notificationItems: readonly SessionNotification[];
  onDismissNotification: (id: string) => void;
};

export function AppLayoutsLoadingScreen({
  appRootRef,
  appRootClassName,
  vaultRoot,
  vaultSettings,
  setVaultSettings,
  fs,
  tiling,
  closeSyncing,
  onCloseRequest,
  closeSyncInProgress,
  notificationItems,
  onDismissNotification,
}: AppLayoutsLoadingScreenProps) {
  return (
    <AppBootstrapShell
      appRootRef={appRootRef}
      appRootClassName={appRootClassName}
      vaultRoot={vaultRoot}
      vaultSettings={vaultSettings}
      setVaultSettings={setVaultSettings}
      fs={fs}
      tiling={tiling}
      closeSyncing={closeSyncing}
      onCloseRequest={onCloseRequest}
      closeSyncInProgress={closeSyncInProgress}
      notificationItems={notificationItems}
      onDismissNotification={onDismissNotification}
    >
      <div className="shell setup-shell">
        <p className="muted">Loading…</p>
      </div>
    </AppBootstrapShell>
  );
}

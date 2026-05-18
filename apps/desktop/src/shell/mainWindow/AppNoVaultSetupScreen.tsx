import type {EskerraSettings} from '@eskerra/core';
import type {RefObject, SetStateAction} from 'react';

import type {createTauriVaultFilesystem} from '../../lib/tauriVault';
import type {WindowTilingState} from '../../lib/windowTiling';
import type {SessionNotification} from '../../lib/sessionNotifications';
import {AppBootstrapShell} from './AppBootstrapShell';

type AppNoVaultSetupScreenProps = {
  appRootRef: RefObject<HTMLDivElement | null>;
  appRootClassName: string;
  vaultSettings: EskerraSettings | null;
  setVaultSettings: (s: SetStateAction<EskerraSettings | null>) => void;
  fs: ReturnType<typeof createTauriVaultFilesystem>;
  tiling: WindowTilingState;
  closeSyncing: boolean;
  onCloseRequest: (input: {instant: boolean}) => void;
  closeSyncInProgress: boolean;
  notificationItems: readonly SessionNotification[];
  onDismissNotification: (id: string) => void;
  settingsName: string;
  busy: boolean;
  err: string | null;
  onPickFolder: () => void;
};

export function AppNoVaultSetupScreen({
  appRootRef,
  appRootClassName,
  vaultSettings,
  setVaultSettings,
  fs,
  tiling,
  closeSyncing,
  onCloseRequest,
  closeSyncInProgress,
  notificationItems,
  onDismissNotification,
  settingsName,
  busy,
  err,
  onPickFolder,
}: AppNoVaultSetupScreenProps) {
  return (
    <AppBootstrapShell
      appRootRef={appRootRef}
      appRootClassName={appRootClassName}
      vaultRoot={null}
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
        <h1>{settingsName}</h1>
        <p className="muted">Choose your notes folder (vault root). Settings are stored in `.eskerra/` inside it.</p>
        <button type="button" className="primary" onClick={onPickFolder} disabled={busy}>
          Choose folder…
        </button>
        {err ? <p className="error">{err}</p> : null}
      </div>
    </AppBootstrapShell>
  );
}

import type {EskerraSettings} from '@eskerra/core';
import type {ReactNode, RefObject, SetStateAction} from 'react';

import {AppSetupTagline} from '../../components/AppStatusBar';
import {ToastStack} from '../../components/ToastStack';
import {WindowTitleBar} from '../../components/WindowTitleBar';
import {ThemedChromeBackground} from '../../theme/ThemedChromeBackground';
import type {WindowTilingState} from '../../lib/windowTiling';
import type {SessionNotification} from '../../lib/sessionNotifications';
import type {createTauriVaultFilesystem} from '../../lib/tauriVault';
import {AppThemeShell} from '../AppThemeShell';
import {CloseSyncProgressOverlay} from '../CloseSyncProgressOverlay';

type AppBootstrapShellProps = {
  appRootRef: RefObject<HTMLDivElement | null>;
  appRootClassName: string;
  vaultRoot: string | null;
  vaultSettings: EskerraSettings | null;
  setVaultSettings: (s: SetStateAction<EskerraSettings | null>) => void;
  fs: ReturnType<typeof createTauriVaultFilesystem>;
  tiling: WindowTilingState;
  closeSyncing: boolean;
  onCloseRequest: (input: {instant: boolean}) => void;
  closeSyncInProgress: boolean;
  notificationItems: readonly SessionNotification[];
  onDismissNotification: (id: string) => void;
  children: ReactNode;
};

export function AppBootstrapShell({
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
  children,
}: AppBootstrapShellProps) {
  return (
    <AppThemeShell
      vaultRoot={vaultRoot}
      vaultSettings={vaultSettings}
      setVaultSettings={setVaultSettings}
      fs={fs}>
      <div ref={appRootRef} className={appRootClassName}>
        <ThemedChromeBackground />
        <CloseSyncProgressOverlay visible={closeSyncInProgress} />
        <div className="app-root-chrome">
          <WindowTitleBar
            tiling={tiling}
            closeSyncing={closeSyncing}
            onCloseRequest={onCloseRequest}
          />
          {children}
          <AppSetupTagline />
          <ToastStack
            items={notificationItems}
            onDismiss={onDismissNotification}
          />
        </div>
      </div>
    </AppThemeShell>
  );
}

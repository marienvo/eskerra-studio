import type {ComponentProps} from 'react';
import {Suspense} from 'react';

import {LazySettingsPage} from './AppLazyUi';

const settingsLazyFallback = <div aria-busy="true" />;
import {MainWindowVaultTab} from './MainWindowVaultTab';

export type AppMainStageProps = {
  activePage: 'vault' | 'settings';
  onCloseSettings: () => void;
  settingsPageProps: {
    vaultRoot: ComponentProps<typeof LazySettingsPage>['vaultRoot'];
    fs: ComponentProps<typeof LazySettingsPage>['fs'];
    vaultSettings: ComponentProps<typeof MainWindowVaultTab>['vaultSettings'];
    setVaultSettings: ComponentProps<typeof LazySettingsPage>['setVaultSettings'];
    onChangeVaultFolder: ComponentProps<typeof LazySettingsPage>['onChangeVaultFolder'];
  };
  vaultTabProps: ComponentProps<typeof MainWindowVaultTab>;
};

export function AppMainStage({
  activePage,
  onCloseSettings,
  settingsPageProps: {
    vaultRoot,
    fs,
    vaultSettings,
    setVaultSettings,
    onChangeVaultFolder,
  },
  vaultTabProps,
}: AppMainStageProps) {
  return (
    <div className="app-body">
      <div className="main-shell-stage panel-group fill">
        <div className="main-column">
          <main className="main-stage">
            {activePage === 'settings' && vaultSettings ? (
              <Suspense fallback={settingsLazyFallback}>
                <LazySettingsPage
                  onClose={onCloseSettings}
                  vaultRoot={vaultRoot}
                  fs={fs}
                  vaultSettings={vaultSettings}
                  setVaultSettings={setVaultSettings}
                  onChangeVaultFolder={onChangeVaultFolder}
                />
              </Suspense>
            ) : (
              <MainWindowVaultTab {...vaultTabProps} />
            )}
          </main>
        </div>
      </div>
    </div>
  );
}

import type {ComponentProps, ReactNode} from 'react';
import {Suspense} from 'react';

import {LazySettingsPage} from './AppLazyUi';

const settingsLazyFallback = <div aria-busy="true" />;

export type AppMainStageProps = {
  activePage: 'vault' | 'settings';
  onCloseSettings: () => void;
  settingsPageProps: Omit<
    ComponentProps<typeof LazySettingsPage>,
    'onClose' | 'vaultSettings'
  > & {
    vaultSettings: ComponentProps<typeof LazySettingsPage>['vaultSettings'] | null;
  };
  children: ReactNode;
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
  children,
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
              children
            )}
          </main>
        </div>
      </div>
    </div>
  );
}

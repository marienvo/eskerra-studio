import {open} from '@tauri-apps/plugin-dialog';
import {useCallback} from 'react';

type AppPage = 'vault' | 'settings';

export type UseAppPickFolderArgs = {
  setErr: (value: string | null) => void;
  hydrateVault: (vaultRoot: string) => Promise<void>;
  setActivePage: (page: AppPage) => void;
};

export function useAppPickFolder({
  setErr,
  hydrateVault,
  setActivePage,
}: UseAppPickFolderArgs) {
  return useCallback(async () => {
    setErr(null);
    const dir = await open({directory: true, multiple: false});
    if (dir === null || Array.isArray(dir)) {
      return;
    }
    await hydrateVault(dir);
    setActivePage('vault');
  }, [hydrateVault, setActivePage, setErr]);
}

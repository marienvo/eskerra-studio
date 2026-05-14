import {useEffect} from 'react';

type UseVaultGitLocalWriteStatusRefreshArgs = {
  saveSettledNonce: number;
  refreshGitStatus: () => void;
};

/**
 * Refreshes local Git status after durable vault writes so the status chip can
 * show local changes promptly. This does not fetch or run sync.
 */
export function useVaultGitLocalWriteStatusRefresh({
  saveSettledNonce,
  refreshGitStatus,
}: UseVaultGitLocalWriteStatusRefreshArgs): void {
  useEffect(() => {
    if (saveSettledNonce === 0) return;
    refreshGitStatus();
  }, [saveSettledNonce, refreshGitStatus]);
}

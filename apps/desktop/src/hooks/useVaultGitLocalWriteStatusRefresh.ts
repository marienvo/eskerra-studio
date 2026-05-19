import {useEffect} from 'react';

export const GIT_LOCAL_WRITE_REFRESH_DEBOUNCE_MS = 500;

type UseVaultGitLocalWriteStatusRefreshArgs = {
  saveSettledNonce: number;
  refreshGitStatus: (opts?: {readonly silent?: boolean}) => void;
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
    const id = window.setTimeout(() => {
      refreshGitStatus({silent: true});
    }, GIT_LOCAL_WRITE_REFRESH_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [saveSettledNonce, refreshGitStatus]);
}

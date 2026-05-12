import {useCallback, useEffect, useRef, useState} from 'react';

import type {GitStatusResult, SyncError} from '../lib/tauriVaultGitSync';
import {getVaultGitStatus} from '../lib/tauriVaultGitSync';

type UseVaultGitStatusInput = {
  vaultPath: string | null;
  remote: string;
  branch: string | null;
};

type UseVaultGitStatusResult = {
  status: GitStatusResult | null;
  loading: boolean;
  error: string | null;
  /** Trigger a fresh load. Not exposed in UI yet — available for future use. */
  refresh: () => void;
};

export function useVaultGitStatus({
  vaultPath,
  remote,
  branch,
}: UseVaultGitStatusInput): UseVaultGitStatusResult {
  const [status, setStatus] = useState<GitStatusResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const load = useCallback(
    async (path: string, expectedBranch: string) => {
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      setLoading(true);
      setError(null);
      try {
        const result = await getVaultGitStatus({vaultPath: path, remote, branch: expectedBranch});
        if (requestId !== requestIdRef.current) return;
        setStatus(result);
      } catch (e) {
        if (requestId !== requestIdRef.current) return;
        setError(formatSyncError(e));
      } finally {
        if (requestId === requestIdRef.current) setLoading(false);
      }
    },
    [remote],
  );

  useEffect(() => {
    if (!vaultPath || !branch) {
      requestIdRef.current += 1;
      setStatus(null);
      setLoading(false);
      setError(null);
      return;
    }

    void load(vaultPath, branch);

    return () => {
      requestIdRef.current += 1;
    };
  }, [vaultPath, branch, load]);

  const refresh = useCallback(() => {
    if (!vaultPath || !branch) return;
    void load(vaultPath, branch);
  }, [vaultPath, branch, load]);

  return {status, loading, error, refresh};
}

function formatSyncError(e: unknown): string {
  if (typeof e === 'object' && e != null && 'type' in e) {
    const err = e as SyncError;
    switch (err.type) {
      case 'notGitRepository':
        return 'Not a Git repository';
      case 'lockAlreadyHeld':
        return 'Sync already running';
      case 'gitCommandFailed':
        return `Git command failed: ${err.stderr.split('\n')[0]}`;
      default:
        return `Git status failed (${err.type})`;
    }
  }
  return typeof e === 'string' ? e : 'Git status failed';
}

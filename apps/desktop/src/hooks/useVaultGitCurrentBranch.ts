import {useCallback, useEffect, useRef, useState} from 'react';

import type {SyncError} from '../lib/tauriVaultGitSync';
import {getVaultGitCurrentBranch} from '../lib/tauriVaultGitSync';

type UseVaultGitCurrentBranchInput = {
  vaultPath: string | null;
};

type UseVaultGitCurrentBranchResult = {
  branch: string | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
};

export function useVaultGitCurrentBranch({
  vaultPath,
}: UseVaultGitCurrentBranchInput): UseVaultGitCurrentBranchResult {
  const [branch, setBranch] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const load = useCallback(async (path: string) => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);
    setError(null);
    try {
      const result = await getVaultGitCurrentBranch({vaultPath: path});
      if (requestId !== requestIdRef.current) return;
      setBranch(result);
    } catch (e) {
      if (requestId !== requestIdRef.current) return;
      setBranch(null);
      setError(formatBranchError(e));
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!vaultPath) {
      requestIdRef.current += 1;
      setBranch(null);
      setLoading(false);
      setError(null);
      return;
    }

    void load(vaultPath);

    return () => {
      requestIdRef.current += 1;
    };
  }, [vaultPath, load]);

  const refresh = useCallback(() => {
    if (!vaultPath) return;
    void load(vaultPath);
  }, [vaultPath, load]);

  return {branch, loading, error, refresh};
}

function formatBranchError(e: unknown): string {
  if (typeof e === 'object' && e != null && 'type' in e) {
    const err = e as SyncError;
    switch (err.type) {
      case 'notGitRepository':
        return 'Not a Git repository';
      case 'gitCommandFailed':
        return `Git command failed: ${err.stderr.split('\n')[0]}`;
      default:
        return `Git branch unavailable (${err.type})`;
    }
  }
  return typeof e === 'string' ? e : 'Git branch unavailable';
}

import {useCallback, useEffect, useState} from 'react';

import type {GitStatusResult, SyncError} from '../lib/tauriVaultGitSync';
import {getVaultGitStatus} from '../lib/tauriVaultGitSync';

type UseVaultGitStatusInput = {
  vaultPath: string | null;
  remote: string;
  branch: string;
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

  const load = useCallback(
    async (path: string, cancelled: {value: boolean}) => {
      setLoading(true);
      setError(null);
      try {
        const result = await getVaultGitStatus({vaultPath: path, remote, branch});
        if (cancelled.value) return;
        setStatus(result);
      } catch (e) {
        if (cancelled.value) return;
        setError(formatSyncError(e));
      } finally {
        if (!cancelled.value) setLoading(false);
      }
    },
    [remote, branch],
  );

  useEffect(() => {
    if (!vaultPath) {
      setStatus(null);
      setLoading(false);
      setError(null);
      return;
    }

    const cancelled = {value: false};
    void load(vaultPath, cancelled);

    return () => {
      cancelled.value = true;
    };
  }, [vaultPath, load]);

  const refresh = useCallback(() => {
    if (!vaultPath) return;
    const cancelled = {value: false};
    void load(vaultPath, cancelled);
  }, [vaultPath, load]);

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

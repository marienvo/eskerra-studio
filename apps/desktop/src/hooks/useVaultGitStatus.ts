import {useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react';

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
  /**
   * Increments when an accepted status load updates status/error for the current
   * vault/remote/branch key. Used to detect stale snapshots (e.g. before post-save refresh).
   */
  statusRevision: number;
  /** Trigger a fresh load. Not exposed in UI yet — available for future use. */
  refresh: (opts?: {readonly silent?: boolean}) => void;
};

export function useVaultGitStatus({
  vaultPath,
  remote,
  branch,
}: UseVaultGitStatusInput): UseVaultGitStatusResult {
  const [status, setStatus] = useState<GitStatusResult | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusRevision, setStatusRevision] = useState(0);
  const requestIdRef = useRef(0);
  const statusRef = useRef(status);
  const loadedKeyRef = useRef(loadedKey);
  useLayoutEffect(() => {
    statusRef.current = status;
    loadedKeyRef.current = loadedKey;
  }, [status, loadedKey]);

  const load = useCallback(
    async (path: string, expectedBranch: string) => {
      const requestKey = statusRequestKey(path, remote, expectedBranch);
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      try {
        const result = await getVaultGitStatus({vaultPath: path, remote, branch: expectedBranch});
        if (requestId !== requestIdRef.current) return;
        setError(null);
        setStatus(result);
        setLoadedKey(requestKey);
        setStatusRevision(r => r + 1);
      } catch (e) {
        if (requestId !== requestIdRef.current) return;
        setError(formatSyncError(e));
        setLoadedKey(requestKey);
        setStatusRevision(r => r + 1);
      } finally {
        if (requestId === requestIdRef.current) setLoading(false);
      }
    },
    [remote],
  );

  useEffect(() => {
    if (!vaultPath || !branch) {
      requestIdRef.current += 1;
      return;
    }

    const requestKey = statusRequestKey(vaultPath, remote, branch);
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    getVaultGitStatus({vaultPath, remote, branch})
      .then(result => {
        if (requestId !== requestIdRef.current) return;
        setError(null);
        setStatus(result);
        setLoadedKey(requestKey);
        setStatusRevision(r => r + 1);
      })
      .catch((e: unknown) => {
        if (requestId !== requestIdRef.current) return;
        setError(formatSyncError(e));
        setLoadedKey(requestKey);
        setStatusRevision(r => r + 1);
      })
      .finally(() => {
        if (requestId === requestIdRef.current) setLoading(false);
      });

    return () => {
      requestIdRef.current += 1;
    };
  }, [vaultPath, remote, branch, load]);

  const refresh = useCallback((opts?: {readonly silent?: boolean}) => {
    if (!vaultPath || !branch) return;
    const currentRequestKey = statusRequestKey(vaultPath, remote, branch);
    const hasLoadedCurrentStatus =
      statusRef.current != null && loadedKeyRef.current === currentRequestKey;
    if (!opts?.silent || !hasLoadedCurrentStatus) {
      setLoading(true);
    }
    setError(null);
    load(vaultPath, branch).catch(() => undefined);
  }, [vaultPath, remote, branch, load]);

  const currentKey = vaultPath && branch ? statusRequestKey(vaultPath, remote, branch) : null;
  const hasCurrentStatusResult = currentKey != null && loadedKey === currentKey;
  return {
    status: hasCurrentStatusResult ? status : null,
    loading: currentKey != null && (loading || !hasCurrentStatusResult),
    error: hasCurrentStatusResult ? error : null,
    statusRevision: hasCurrentStatusResult ? statusRevision : 0,
    refresh,
  };
}

function statusRequestKey(vaultPath: string, remote: string, branch: string): string {
  return JSON.stringify([vaultPath, remote, branch]);
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

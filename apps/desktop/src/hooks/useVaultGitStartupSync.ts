import {useEffect, useEffectEvent, useRef} from 'react';

import {shouldRunVaultGitSync} from '../lib/gitSyncPreflight';
import type {SessionNotificationTone} from '../lib/sessionNotifications';
import type {GitStatusResult} from '../lib/tauriVaultGitSync';

type UseVaultGitStartupSyncArgs = {
  vaultPath: string | null;
  gitStatusLoading: boolean;
  gitStatusError: string | null;
  gitStatus?: GitStatusResult | null;
  manualSyncDisabledReason: string | null;
  manualSyncRunning: boolean;
  runManualSync: (opts?: {readonly silent?: boolean}) => Promise<boolean>;
  notify: (tone: SessionNotificationTone, text: string) => void;
};

/**
 * Runs one guarded sync automatically after a vault becomes ready.
 * Fires at most once per vault path per app session. Resets for a new vault path.
 * Uses the same `runManualSync` path as the button, Ctrl+S, and close sync.
 */
export function useVaultGitStartupSync({
  vaultPath,
  gitStatusLoading,
  gitStatusError,
  gitStatus,
  manualSyncDisabledReason,
  manualSyncRunning,
  runManualSync,
  notify,
}: UseVaultGitStartupSyncArgs): void {
  // Tracks all vault paths that have already triggered startup sync this session.
  const attemptedVaultPathsRef = useRef(new Set<string>());

  const runStartupSync = useEffectEvent(async () => {
    const success = await runManualSync({silent: true});
    if (!success) {
      notify('error', 'Startup sync failed. You can retry manually.');
    }
  });

  useEffect(() => {
    if (vaultPath == null) return;
    if (gitStatusLoading) return;
    if (gitStatusError != null) return;
    if (manualSyncDisabledReason != null) return;
    if (manualSyncRunning) return;

    // Preflight: skip silently if status is provided and shows nothing to sync.
    if (gitStatus !== undefined && !shouldRunVaultGitSync(gitStatus, 'startup')) return;

    // Already ran (or is running) for this vault — do not repeat.
    if (attemptedVaultPathsRef.current.has(vaultPath)) return;

    // Mark before the async run to guard against re-entry from intermediate rerenders.
    attemptedVaultPathsRef.current.add(vaultPath);

    runStartupSync();
  }, [vaultPath, gitStatusLoading, gitStatusError, gitStatus, manualSyncDisabledReason, manualSyncRunning]);
}

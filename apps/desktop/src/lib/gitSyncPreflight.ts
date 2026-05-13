import type {GitStatusResult} from './tauriVaultGitSync';

export type SyncIntent = 'manual' | 'keyboard' | 'close' | 'startup' | 'autosync';

/**
 * Determines whether a vault Git sync should actually run for a given intent.
 *
 * This is a pure function over the most recent GitStatusResult — no Tauri calls,
 * no round trips. It is consulted by Ctrl/Cmd+S, close sync, startup sync, and
 * autosync before calling vault_git_sync_run.
 *
 * The manual sync button does NOT consult this helper (explicit user action).
 *
 * Rules:
 * 1. null status:     manual → true (let it surface errors); all others → false.
 * 2. clean/synced:    all intents → false (nothing to do).
 * 3. local work:      all intents → true.
 * 4. ahead-only:      all intents → true (need to push).
 * 5. behind-only:     manual/keyboard → true; close/startup/autosync → false.
 * 6. diverged:        all intents → true.
 * 7. error state:     manual → true; all others → false.
 * 8. wrong branch / unsafe / unsupported: manual → true; all others → false.
 *    (These will be rejected by the existing manualSyncDisabledReason gates anyway.)
 */
export function shouldRunVaultGitSync(
  status: GitStatusResult | null,
  intent: SyncIntent,
): boolean {
  // Rule 1: status unknown — only manual can proceed
  if (status == null) {
    return intent === 'manual';
  }

  // Rule 7/8: error state or wrong-branch / unsafe — only manual proceeds
  if (status.unsafeState != null || status.isWrongBranch) {
    return intent === 'manual';
  }

  const hasLocalWork =
    status.hasUncommittedChanges ||
    status.hasStagedChanges ||
    status.hasUntrackedFiles;

  // Rule 3: any local work → sync for all intents
  if (hasLocalWork) {
    return true;
  }

  // Rule 6: diverged (ahead > 0 AND behind > 0) → sync for all intents
  const diverged = status.ahead > 0 && status.behind > 0;
  if (diverged) {
    return true;
  }

  // Rule 4: ahead-only → sync for all intents (need to push)
  if (status.ahead > 0) {
    return true;
  }

  // Rule 5: behind-only → only manual/keyboard; close/startup/autosync skip
  if (status.behind > 0) {
    return intent === 'manual' || intent === 'keyboard';
  }

  // Rule 2: clean/synced (no local work, ahead === 0, behind === 0, no unsafe) → false for all
  return false;
}

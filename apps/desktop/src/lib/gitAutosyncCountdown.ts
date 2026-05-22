import {mapGitStatusToView} from './gitStatusView';
import {shouldRunVaultGitSync} from './gitSyncPreflight';
import type {GitStatusResult} from './tauriVaultGitSync';

export type AutosyncPreflightResult = 'run' | 'skip-keep-pending' | 'skip-clear-pending';

/**
 * Checks whether an autosync should run given the current git status.
 * Returns 'run' to proceed, 'skip-clear-pending' when repo is clean (discard pending),
 * or 'skip-keep-pending' when status is unknown/error (retry next interval).
 * Returns 'run' when gitStatus is undefined (no preflight wired up yet).
 */
export function getAutosyncPreflight(
  gitStatus: GitStatusResult | null | undefined,
): AutosyncPreflightResult {
  if (gitStatus === undefined) return 'run';
  if (shouldRunVaultGitSync(gitStatus, 'autosync')) return 'run';
  const isCleanSynced =
    gitStatus != null &&
    gitStatus.unsafeState == null &&
    !gitStatus.isWrongBranch &&
    !gitStatus.hasUncommittedChanges &&
    !gitStatus.hasStagedChanges &&
    !gitStatus.hasUntrackedFiles &&
    gitStatus.ahead === 0 &&
    gitStatus.behind === 0;
  return isCleanSynced ? 'skip-clear-pending' : 'skip-keep-pending';
}

export function remainingMsUntil(targetMs: number, nowMs: number): number {
  return Math.max(0, targetMs - nowMs);
}

/** Formats remaining time as "M:SS" (seconds ceil, sec zero-padded). */
export function formatAutosyncCountdownTime(remainingMs: number): string {
  const totalSec = Math.max(0, Math.ceil(remainingMs / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${String(sec).padStart(2, '0')}`;
}

/** Formats remaining time as "Syncs in M:SS". */
export function formatAutosyncCountdownLabel(remainingMs: number): string {
  return `Syncs in ${formatAutosyncCountdownTime(remainingMs)}`;
}

export type ShouldShowAutosyncCountdownInput = {
  autosyncPending: boolean;
  gitStatus: GitStatusResult | null;
  gitStatusLoading: boolean;
  gitStatusError: string | null;
  manualSyncDisabledReason: string | null;
  manualSyncRunning: boolean;
  gitOperationBusy: boolean;
};

export function shouldShowAutosyncCountdown(input: ShouldShowAutosyncCountdownInput): boolean {
  if (!input.autosyncPending) return false;
  if (input.gitStatusLoading) return false;
  if (input.gitStatusError != null) return false;
  if (input.manualSyncDisabledReason != null) return false;
  if (input.manualSyncRunning) return false;
  if (input.gitOperationBusy) return false;
  if (input.gitStatus == null) return false;
  if (getAutosyncPreflight(input.gitStatus) !== 'run') return false;
  return mapGitStatusToView(input.gitStatus).label === 'Local changes';
}

export function resolveAutosyncCountdownLabel(
  nextAutosyncAtMs: number,
  nowMs: number,
): string {
  return formatAutosyncCountdownLabel(remainingMsUntil(nextAutosyncAtMs, nowMs));
}

export function resolveAutosyncCountdownTime(
  nextAutosyncAtMs: number,
  nowMs: number,
): string {
  return formatAutosyncCountdownTime(remainingMsUntil(nextAutosyncAtMs, nowMs));
}

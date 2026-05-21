import {useMemo, useSyncExternalStore} from 'react';

import {
  resolveAutosyncCountdownLabel,
  shouldShowAutosyncCountdown,
  type ShouldShowAutosyncCountdownInput,
} from '../lib/gitAutosyncCountdown';
import type {VaultGitAutosyncSchedulerState} from './useVaultGitAutosyncScheduler';

const COUNTDOWN_TICK_MS = 1000;

function subscribeCountdownClock(onStoreChange: () => void): () => void {
  const id = window.setInterval(onStoreChange, COUNTDOWN_TICK_MS);
  return () => window.clearInterval(id);
}

function subscribeStableCountdownClock(): () => void {
  return () => {};
}

function getCountdownClockSnapshot(): number {
  return Date.now();
}

function getStableCountdownClockSnapshot(): number {
  return 0;
}

type UseVaultGitAutosyncCountdownArgs = ShouldShowAutosyncCountdownInput &
  VaultGitAutosyncSchedulerState;

/**
 * Returns a live "Syncs in M:SS" label when autosync is pending and the chip
 * would otherwise show "Local changes", or null when the countdown should not display.
 */
export function useVaultGitAutosyncCountdown(
  args: UseVaultGitAutosyncCountdownArgs,
): string | null {
  const showCountdown = shouldShowAutosyncCountdown(args);
  const nowMs = useSyncExternalStore(
    showCountdown ? subscribeCountdownClock : subscribeStableCountdownClock,
    showCountdown ? getCountdownClockSnapshot : getStableCountdownClockSnapshot,
    showCountdown ? getCountdownClockSnapshot : getStableCountdownClockSnapshot,
  );

  return useMemo(() => {
    if (!showCountdown) return null;
    return resolveAutosyncCountdownLabel(args.nextAutosyncAtMs, nowMs);
  }, [showCountdown, args.nextAutosyncAtMs, nowMs]);
}

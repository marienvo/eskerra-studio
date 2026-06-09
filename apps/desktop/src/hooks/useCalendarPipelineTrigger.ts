import {useCallback, useRef, useState} from 'react';
import type {VaultFilesystem} from '@eskerra/core';

import {runDesktopCalendarPipeline} from '../lib/calendarPipeline/runCalendarPipelineDesktop';

export type CalendarPipelineTrigger = {
  /** Runs the calendar pipeline on demand (coalesced). No-op while a run is in flight. */
  runCalendarSync: () => Promise<boolean>;
  calendarSyncing: boolean;
  calendarSyncPercent: number | null;
};

/**
 * Manual, on-demand trigger for the calendar → Today Hub pipeline. Mirrors the podcast RSS-sync
 * trigger shape (ref guard + percent state). Nothing here runs at startup. Writes land on disk and
 * flow back into open hub rows through the normal vault-watch reconcile path, so no extra refresh is
 * needed here.
 */
export function useCalendarPipelineTrigger(
  vaultRoot: string | null,
  fs: VaultFilesystem,
  vaultMarkdownRefs: readonly {uri: string; name: string}[],
): CalendarPipelineTrigger {
  const runningRef = useRef(false);
  const [calendarSyncing, setCalendarSyncing] = useState(false);
  const [calendarSyncPercent, setCalendarSyncPercent] = useState<number | null>(null);

  const runCalendarSync = useCallback(async (): Promise<boolean> => {
    if (vaultRoot == null || runningRef.current) {
      return false;
    }
    runningRef.current = true;
    setCalendarSyncing(true);
    setCalendarSyncPercent(null);
    try {
      await runDesktopCalendarPipeline(fs, vaultRoot, vaultMarkdownRefs, {
        onProgress: payload => {
          const n = payload.percent;
          if (Number.isFinite(n) && n >= 0 && n <= 100) {
            setCalendarSyncPercent(n);
          }
        },
      });
      return true;
    } catch {
      // Per-hub/per-feed errors are already logged inside the runner.
      return false;
    } finally {
      runningRef.current = false;
      setCalendarSyncing(false);
      setCalendarSyncPercent(null);
    }
  }, [vaultRoot, fs, vaultMarkdownRefs]);

  return {runCalendarSync, calendarSyncing, calendarSyncPercent};
}

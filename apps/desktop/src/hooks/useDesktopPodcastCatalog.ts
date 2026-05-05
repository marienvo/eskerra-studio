import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import type {VaultFilesystem} from '@eskerra/core';

import {runPodcastPhase1Desktop} from '../lib/podcasts/podcastPhase1Desktop';
import type {PodcastEpisode, PodcastSection} from '../lib/podcasts/podcastTypes';

export type UseDesktopPodcastCatalogOptions = {
  vaultRoot: string | null;
  fs: VaultFilesystem;
  /** Increments when the filesystem watcher reports changes; triggers a full rescan. */
  fsRefreshNonce: number;
  onError: (msg: string | null) => void;
};

export type UseDesktopPodcastCatalogResult = {
  sections: PodcastSection[];
  episodes: PodcastEpisode[];
  catalogLoading: boolean;
  refreshPodcasts: (forceFullScan: boolean) => Promise<void>;
};

/**
 * Loads the desktop podcast episode catalog whenever a vault is open, independent of
 * whether the Episodes pane is visible (playback needs a flat episode list).
 */
export function useDesktopPodcastCatalog({
  vaultRoot,
  fs,
  fsRefreshNonce,
  onError,
}: UseDesktopPodcastCatalogOptions): UseDesktopPodcastCatalogResult {
  const [sections, setSections] = useState<PodcastSection[]>([]);
  const [loading, setLoading] = useState(true);
  const refreshGenerationRef = useRef(0);

  const episodes = useMemo(() => sections.flatMap(s => s.episodes), [sections]);

  const refreshPodcasts = useCallback(
    async (forceFullScan: boolean) => {
      const refreshGeneration = refreshGenerationRef.current + 1;
      refreshGenerationRef.current = refreshGeneration;
      const isLatestRefresh = () => refreshGenerationRef.current === refreshGeneration;
      if (!vaultRoot) {
        if (isLatestRefresh()) {
          setSections([]);
          setLoading(false);
        }
        return;
      }
      setLoading(true);
      onError(null);
      try {
        const result = await runPodcastPhase1Desktop(vaultRoot, fs, {forceFullScan});
        if (!isLatestRefresh()) {
          return;
        }
        if (result.error) {
          onError(result.error);
        }
        setSections(result.sections);
      } catch (e) {
        if (isLatestRefresh()) {
          onError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (isLatestRefresh()) {
          setLoading(false);
        }
      }
    },
    [vaultRoot, fs, onError],
  );

  useEffect(() => {
    queueMicrotask(() => {
      void refreshPodcasts(false);
    });
  }, [refreshPodcasts]);

  useEffect(() => {
    if (fsRefreshNonce === 0) {
      return;
    }
    queueMicrotask(() => {
      void refreshPodcasts(true);
    });
    // Only rescan when the app increments the nonce (filesystem watcher or settings refresh).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- avoid re-running when refreshPodcasts identity changes
  }, [fsRefreshNonce]);

  return {sections, episodes, catalogLoading: loading, refreshPodcasts};
}

import type {VaultFilesystem} from '@eskerra/core';
import {act, renderHook, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

import {runPodcastPhase1Desktop} from '../lib/podcasts/podcastPhase1Desktop';
import type {PodcastPhase1DesktopResult} from '../lib/podcasts/podcastPhase1Desktop';

import {useDesktopPodcastCatalog} from './useDesktopPodcastCatalog';

vi.mock('../lib/podcasts/podcastPhase1Desktop', () => ({
  runPodcastPhase1Desktop: vi.fn(),
}));

const fs = {} as VaultFilesystem;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return {promise, reject, resolve};
}

function phase1Result(
  title: string,
  error: string | null = null,
): PodcastPhase1DesktopResult {
  return {
    allEpisodes: [],
    didFullVaultListingThisRefresh: false,
    error,
    podcastRelevantFiles: [],
    rssFeedFiles: [],
    sections: [
      {
        episodes: [],
        title,
      },
    ],
  };
}

describe('useDesktopPodcastCatalog', () => {
  beforeEach(() => {
    vi.mocked(runPodcastPhase1Desktop).mockReset();
  });

  it('ignores stale refresh errors after a newer refresh succeeds', async () => {
    const older = deferred<PodcastPhase1DesktopResult>();
    const newer = deferred<PodcastPhase1DesktopResult>();
    vi.mocked(runPodcastPhase1Desktop)
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);
    const onError = vi.fn();

    const {result} = renderHook(() =>
      useDesktopPodcastCatalog({
        fs,
        fsRefreshNonce: 0,
        onError,
        vaultRoot: '/vault',
      }),
    );

    await waitFor(() => {
      expect(runPodcastPhase1Desktop).toHaveBeenCalledTimes(1);
    });

    let refreshPromise!: Promise<void>;
    await act(async () => {
      refreshPromise = result.current.refreshPodcasts(true);
      await Promise.resolve();
    });
    expect(runPodcastPhase1Desktop).toHaveBeenCalledTimes(2);

    await act(async () => {
      newer.resolve(phase1Result('Fresh'));
      await refreshPromise;
    });

    expect(result.current.sections.map(section => section.title)).toEqual(['Fresh']);

    await act(async () => {
      older.reject(new Error('stale failure'));
      await Promise.resolve();
    });

    expect(result.current.sections.map(section => section.title)).toEqual(['Fresh']);
    expect(onError).not.toHaveBeenCalledWith('stale failure');
  });
});

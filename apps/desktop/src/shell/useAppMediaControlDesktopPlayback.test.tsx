import {renderHook} from '@testing-library/react';
import type {MutableRefObject} from 'react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {useDesktopPodcastPlayback} from '../hooks/useDesktopPodcastPlayback';
import {useAppMediaControlDesktopPlayback} from './useAppMediaControlDesktopPlayback';

type DesktopPodcastPlayback = ReturnType<typeof useDesktopPodcastPlayback>;

function playbackRefStub(
  partial: Pick<
    DesktopPodcastPlayback,
    'togglePause' | 'pauseIfPlaying' | 'dismissNowPlaying'
  >,
): MutableRefObject<DesktopPodcastPlayback> {
  return {current: partial as DesktopPodcastPlayback};
}

const {getDesktopAudioPlayer} = vi.hoisted(() => ({
  getDesktopAudioPlayer: vi.fn(),
}));

vi.mock('../lib/htmlAudioPlayer', () => ({
  getDesktopAudioPlayer,
}));

describe('useAppMediaControlDesktopPlayback', () => {
  const handlers: Record<string, (() => void) | null> = {};
  let setActionHandler: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    getDesktopAudioPlayer.mockReset();
    Object.keys(handlers).forEach(k => delete handlers[k]);
    setActionHandler = vi.fn((action: string, fn: (() => void) | null) => {
      if (fn == null) {
        delete handlers[action];
      } else {
        handlers[action] = fn;
      }
    });
    vi.stubGlobal('navigator', {
      ...navigator,
      mediaSession: {
        setActionHandler,
        metadata: null,
        playbackState: 'none' as MediaSessionPlaybackState,
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('registers play, pause, and stop handlers that delegate to the desktop playback ref', async () => {
    const togglePause = vi.fn().mockResolvedValue(undefined);
    const pauseIfPlaying = vi.fn().mockResolvedValue(undefined);
    const dismissNowPlaying = vi.fn().mockResolvedValue(undefined);
    const ref = playbackRefStub({
      togglePause,
      pauseIfPlaying,
      dismissNowPlaying,
    });

    getDesktopAudioPlayer.mockReturnValue({
      getState: vi.fn().mockResolvedValue('paused'),
    });

    const {unmount} = renderHook(() =>
      useAppMediaControlDesktopPlayback(ref),
    );

    expect(setActionHandler).toHaveBeenCalledWith('play', expect.any(Function));
    expect(setActionHandler).toHaveBeenCalledWith('pause', expect.any(Function));
    expect(setActionHandler).toHaveBeenCalledWith('stop', expect.any(Function));

    await handlers.play!();
    expect(togglePause).toHaveBeenCalledTimes(1);
    expect(pauseIfPlaying).not.toHaveBeenCalled();

    await handlers.pause!();
    expect(pauseIfPlaying).toHaveBeenCalledTimes(1);

    await handlers.stop!();
    expect(dismissNowPlaying).toHaveBeenCalledTimes(1);

    unmount();
    expect(setActionHandler).toHaveBeenCalledWith('play', null);
    expect(setActionHandler).toHaveBeenCalledWith('pause', null);
    expect(setActionHandler).toHaveBeenCalledWith('stop', null);
  });

  it('play handler does not toggle when already playing', async () => {
    const togglePause = vi.fn().mockResolvedValue(undefined);
    const ref = playbackRefStub({
      togglePause,
      pauseIfPlaying: vi.fn().mockResolvedValue(undefined),
      dismissNowPlaying: vi.fn().mockResolvedValue(undefined),
    });
    getDesktopAudioPlayer.mockReturnValue({
      getState: vi.fn().mockResolvedValue('playing'),
    });

    renderHook(() => useAppMediaControlDesktopPlayback(ref));

    await handlers.play!();
    expect(togglePause).not.toHaveBeenCalled();
  });

  it('no-ops when mediaSession.setActionHandler is missing', () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      mediaSession: {},
    });
    const ref = playbackRefStub({
      togglePause: vi.fn(),
      pauseIfPlaying: vi.fn(),
      dismissNowPlaying: vi.fn(),
    });
    expect(() =>
      renderHook(() => useAppMediaControlDesktopPlayback(ref)),
    ).not.toThrow();
  });

  it('registers play and pause when stop is unsupported (partial MediaSession)', async () => {
    setActionHandler.mockImplementation(
      (action: string, fn: (() => void) | null) => {
        if (action === 'stop' && fn != null) {
          throw new Error('stop unsupported');
        }
        if (fn == null) {
          delete handlers[action];
        } else {
          handlers[action] = fn;
        }
      },
    );

    const togglePause = vi.fn().mockResolvedValue(undefined);
    const pauseIfPlaying = vi.fn().mockResolvedValue(undefined);
    const dismissNowPlaying = vi.fn().mockResolvedValue(undefined);
    const ref = playbackRefStub({
      togglePause,
      pauseIfPlaying,
      dismissNowPlaying,
    });
    getDesktopAudioPlayer.mockReturnValue({
      getState: vi.fn().mockResolvedValue('paused'),
    });

    const {unmount} = renderHook(() =>
      useAppMediaControlDesktopPlayback(ref),
    );

    expect(handlers.play).toBeDefined();
    expect(handlers.pause).toBeDefined();
    expect(handlers.stop).toBeUndefined();

    await handlers.play!();
    expect(togglePause).toHaveBeenCalledTimes(1);

    await handlers.pause!();
    expect(pauseIfPlaying).toHaveBeenCalledTimes(1);

    unmount();
    expect(setActionHandler).toHaveBeenCalledWith('play', null);
    expect(setActionHandler).toHaveBeenCalledWith('pause', null);
    expect(setActionHandler).toHaveBeenCalledWith('stop', null);
  });
});

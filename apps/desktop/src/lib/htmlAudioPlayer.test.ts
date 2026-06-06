import type {AudioTrack} from '@eskerra/core';
import {afterEach, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';

const desktopMsMocks = vi.hoisted(() => ({
  clearDesktopMediaSession: vi.fn(),
}));

vi.mock('./desktopMediaSession', async importOriginal => {
  const mod = await importOriginal<typeof import('./desktopMediaSession')>();
  return {
    ...mod,
    clearDesktopMediaSession: desktopMsMocks.clearDesktopMediaSession,
  };
});

import {__resetForTests, getDesktopAudioPlayer, mapAudioPaused} from './htmlAudioPlayer';

const minimalTrack: AudioTrack = {
  id: 'ep-1',
  title: 'Episode',
  artist: 'Show',
  url: 'https://example.com/audio.mp3',
};

describe('HtmlAudioPlayer.play', () => {
  beforeEach(() => {
    desktopMsMocks.clearDesktopMediaSession.mockClear();
    __resetForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    __resetForTests();
  });

  it('clears MediaSession when play() rejects after priming a new src', async () => {
    const playSpy = vi
      .spyOn(HTMLAudioElement.prototype, 'play')
      .mockRejectedValueOnce(new Error('NotSupportedError'));

    const player = getDesktopAudioPlayer();

    await expect(player.play(minimalTrack)).rejects.toThrow('NotSupportedError');

    expect(desktopMsMocks.clearDesktopMediaSession).toHaveBeenCalledTimes(1);
    playSpy.mockRestore();
  });

  it('does not clear MediaSession when play() rejects with AbortError (superseded)', async () => {
    const playSpy = vi.spyOn(HTMLAudioElement.prototype, 'play').mockRejectedValueOnce(
      new DOMException('The operation was aborted', 'AbortError'),
    );

    const player = getDesktopAudioPlayer();

    await player.play(minimalTrack);

    expect(desktopMsMocks.clearDesktopMediaSession).not.toHaveBeenCalled();
    playSpy.mockRestore();
  });
});

describe('mapAudioPaused', () => {
  beforeAll(() => {
    const constants: Record<string, number> = {
      HAVE_METADATA: 1,
      HAVE_CURRENT_DATA: 2,
      HAVE_FUTURE_DATA: 3,
    };
    for (const [key, value] of Object.entries(constants)) {
      if ((HTMLMediaElement as Record<string, number>)[key] == null) {
        Object.defineProperty(HTMLMediaElement, key, {
          value,
          configurable: true,
        });
      }
    }
  });

  function mockAudio(
    overrides: Partial<HTMLAudioElement> & {playedLength?: number} = {},
  ): HTMLAudioElement {
    const {playedLength, ...rest} = overrides;
    const played = {length: playedLength ?? 0};
    return {
      paused: true,
      src: 'https://example.com/audio.mp3',
      currentTime: 0,
      readyState: 0,
      error: null,
      played,
      ...rest,
    } as HTMLAudioElement;
  }

  it('returns playing when unpaused with progress despite low readyState', () => {
    const audio = mockAudio({
      paused: false,
      currentTime: 2,
      readyState: HTMLMediaElement.HAVE_CURRENT_DATA,
    });
    expect(mapAudioPaused(audio, false)).toBe('playing');
  });

  it('returns loading during initial buffer before playback starts', () => {
    const audio = mockAudio({
      paused: false,
      currentTime: 0,
      playedLength: 0,
      readyState: 1,
    });
    expect(mapAudioPaused(audio, false)).toBe('loading');
  });
});

describe('HtmlAudioPlayer.playing event', () => {
  beforeEach(() => {
    desktopMsMocks.clearDesktopMediaSession.mockClear();
    __resetForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    __resetForTests();
  });

  it('emits playing state when the playing event fires after play()', async () => {
    const playSpy = vi
      .spyOn(HTMLAudioElement.prototype, 'play')
      .mockImplementation(async function (this: HTMLAudioElement) {
        Object.defineProperty(this, 'paused', {value: false, configurable: true, writable: true});
        Object.defineProperty(this, 'currentTime', {value: 1, configurable: true, writable: true});
        Object.defineProperty(this, 'readyState', {
          value: HTMLMediaElement.HAVE_CURRENT_DATA,
          configurable: true,
        });
      });

    const states: string[] = [];
    const player = getDesktopAudioPlayer();
    const unsub = player.addStateListener(s => {
      states.push(s);
    });

    await player.play(minimalTrack);
    states.length = 0;

    const audioEl = playSpy.mock.contexts[0] as HTMLAudioElement;
    expect(audioEl).toBeDefined();
    audioEl.dispatchEvent(new Event('playing'));

    expect(states).toContain('playing');
    unsub();
    playSpy.mockRestore();
  });
});

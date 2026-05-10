import type {AudioTrack} from '@eskerra/core';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

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

import {__resetForTests, getDesktopAudioPlayer} from './htmlAudioPlayer';

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

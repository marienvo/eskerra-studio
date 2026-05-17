import {beforeEach, describe, expect, it, vi} from 'vitest';

import {buildR2ObjectUrl, getR2PlaylistObject} from './r2PlaylistObject';
import type {EskerraR2Config} from './eskerraSettings';

const {r2FetchMock} = vi.hoisted(() => ({r2FetchMock: vi.fn()}));

vi.mock('aws4fetch', () => ({
  AwsClient: class {
    sign = vi.fn(async (input: string | URL, init?: RequestInit) => new Request(String(input), init ?? {}));
  },
}));

const config: EskerraR2Config = {
  endpoint: 'https://ex.r2.cloudflarestorage.com',
  bucket: 'b',
  accessKeyId: 'kid',
  secretAccessKey: 'secret',
};

describe('buildR2ObjectUrl', () => {
  it('joins endpoint bucket and key', () => {
    expect(buildR2ObjectUrl(config, 'playlist.json')).toBe(
      'https://ex.r2.cloudflarestorage.com/b/playlist.json',
    );
  });

  it('strips trailing slash on endpoint', () => {
    expect(
      buildR2ObjectUrl({...config, endpoint: 'https://ex.r2.cloudflarestorage.com/'}, 'playlist.json'),
    ).toBe('https://ex.r2.cloudflarestorage.com/b/playlist.json');
  });

  it('uses EU hostname when jurisdiction is eu', () => {
    expect(buildR2ObjectUrl({...config, jurisdiction: 'eu'}, 'playlist.json')).toBe(
      'https://ex.eu.r2.cloudflarestorage.com/b/playlist.json',
    );
  });

  it('does not duplicate bucket when endpoint includes Cloudflare /bucket suffix', () => {
    expect(
      buildR2ObjectUrl(
        {
          endpoint: 'https://ex.eu.r2.cloudflarestorage.com/b',
          bucket: 'b',
          accessKeyId: 'kid',
          secretAccessKey: 'secret',
        },
        'playlist.json',
      ),
    ).toBe('https://ex.eu.r2.cloudflarestorage.com/b/playlist.json');
  });
});

describe('getR2PlaylistObject', () => {
  beforeEach(() => {
    r2FetchMock.mockReset();
    vi.stubGlobal('fetch', r2FetchMock);
  });

  it('returns null on 404', async () => {
    r2FetchMock.mockResolvedValue(new Response(null, {status: 404}));
    await expect(getR2PlaylistObject(config)).resolves.toBeNull();
  });

  it('parses playlist body on 200', async () => {
    const body = JSON.stringify(
      {
        durationMs: 1,
        episodeId: 'e',
        mp3Url: 'u',
        positionMs: 2,
        updatedAt: 10,
      },
      null,
      2,
    );
    r2FetchMock.mockResolvedValue(new Response(body, {status: 200}));
    await expect(getR2PlaylistObject(config)).resolves.toEqual({
      controlRevision: 0,
      durationMs: 1,
      episodeId: 'e',
      mp3Url: 'u',
      playbackOwnerId: '',
      positionMs: 2,
      updatedAt: 10,
    });
  });

  it('uses custom transport when provided', async () => {
    const transport = vi.fn().mockResolvedValue(new Response(null, {status: 404}));
    await expect(getR2PlaylistObject(config, {transport})).resolves.toBeNull();
    expect(transport).toHaveBeenCalledTimes(1);
  });
});

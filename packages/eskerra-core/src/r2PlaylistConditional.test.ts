import {beforeEach, describe, expect, it, vi} from 'vitest';

import {fetchR2PlaylistConditional} from './r2PlaylistConditional';
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

describe('fetchR2PlaylistConditional', () => {
  beforeEach(() => {
    r2FetchMock.mockReset();
    vi.stubGlobal('fetch', r2FetchMock);
  });

  it('returns not_modified on 304', async () => {
    r2FetchMock.mockResolvedValue(new Response(null, {status: 304}));
    await expect(fetchR2PlaylistConditional(config, {etag: '"abc"'})).resolves.toEqual({kind: 'not_modified'});
  });

  it('returns missing on 404', async () => {
    r2FetchMock.mockResolvedValue(new Response(null, {status: 404}));
    await expect(fetchR2PlaylistConditional(config)).resolves.toEqual({kind: 'missing'});
  });

  it('returns updated with entry and etag on 200', async () => {
    const playlist = {
      durationMs: 1,
      episodeId: 'e',
      mp3Url: 'u',
      positionMs: 2,
      updatedAt: 99,
    };
    r2FetchMock.mockResolvedValue(
      new Response(JSON.stringify(playlist), {
        status: 200,
        headers: {etag: '"etag1"'},
      }),
    );
    await expect(fetchR2PlaylistConditional(config)).resolves.toEqual({
      kind: 'updated',
      entry: {
        ...playlist,
        controlRevision: 0,
        playbackOwnerId: '',
      },
      etag: '"etag1"',
    });
  });

  it('sends If-None-Match when etag is provided', async () => {
    r2FetchMock.mockResolvedValue(new Response(null, {status: 304}));
    await fetchR2PlaylistConditional(config, {etag: '"prior"'});
    expect(r2FetchMock).toHaveBeenCalledTimes(1);
    const req = r2FetchMock.mock.calls[0][0] as Request;
    expect(req.headers.get('If-None-Match')).toBe('"prior"');
  });

  it('uses custom transport', async () => {
    const transport = vi.fn().mockResolvedValue(new Response(null, {status: 404}));
    await expect(fetchR2PlaylistConditional(config, {transport})).resolves.toEqual({kind: 'missing'});
    expect(transport).toHaveBeenCalledTimes(1);
  });
});

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  clearInFlightCachedArtworkRequestsForTesting,
  getCachedPodcastArtworkUri,
  getPodcastArtworkUri,
  getPodcastImageCacheKey,
  loadPersistentArtworkUriCache,
  peekCachedPodcastArtworkUriFromMemory,
  PODCAST_IMAGE_CACHE_TTL_MS,
  PODCAST_IMAGE_REMOTE_FALLBACK_TTL_MS,
} from '../src/features/podcasts/services/podcastImageCache';
import {safUriExists} from '../src/core/storage/eskerraStorage';
import {
  clearPodcastImageCacheEntry,
  podcastArtworkFileUriExists,
  readPodcastImageCacheEntry,
  writePodcastArtworkImageFile,
  writePodcastImageCacheEntry,
} from '../src/core/storage/podcastArtworkInternalStorage';
import {fetchRssArtworkUrl} from '../src/features/podcasts/services/rssArtwork';

jest.mock('../src/core/storage/eskerraStorage', () => ({
  safUriExists: jest.fn(),
}));

jest.mock('../src/core/storage/podcastArtworkInternalStorage', () => ({
  clearPodcastImageCacheEntry: jest.fn(),
  readPodcastImageCacheEntry: jest.fn(),
  podcastArtworkFileUriExists: jest.fn(),
  writePodcastArtworkImageFile: jest.fn(),
  writePodcastImageCacheEntry: jest.fn(),
}));

jest.mock('../src/features/podcasts/services/rssArtwork', () => ({
  fetchRssArtworkUrl: jest.fn(),
}));

describe('podcastImageCache', () => {
  const asyncStorageGetItemMock = AsyncStorage.getItem as jest.MockedFunction<
    typeof AsyncStorage.getItem
  >;
  const asyncStorageRemoveItemMock = AsyncStorage.removeItem as jest.MockedFunction<
    typeof AsyncStorage.removeItem
  >;
  const asyncStorageSetItemMock = AsyncStorage.setItem as jest.MockedFunction<
    typeof AsyncStorage.setItem
  >;
  const readCacheMock = readPodcastImageCacheEntry as jest.MockedFunction<
    typeof readPodcastImageCacheEntry
  >;
  const writeImageFileMock = writePodcastArtworkImageFile as jest.MockedFunction<
    typeof writePodcastArtworkImageFile
  >;
  const writeCacheMock = writePodcastImageCacheEntry as jest.MockedFunction<
    typeof writePodcastImageCacheEntry
  >;
  const podcastArtworkFileExistsMock = podcastArtworkFileUriExists as jest.MockedFunction<
    typeof podcastArtworkFileUriExists
  >;
  const safUriExistsMock = safUriExists as jest.MockedFunction<typeof safUriExists>;
  const clearPodcastImageCacheEntryMock = clearPodcastImageCacheEntry as jest.MockedFunction<
    typeof clearPodcastImageCacheEntry
  >;
  const fetchRssArtworkUrlMock = fetchRssArtworkUrl as jest.MockedFunction<
    typeof fetchRssArtworkUrl
  >;
  const globalFetchMock = jest.fn();
  let testCounter = 0;

  function nextBaseUri(): string {
    testCounter += 1;
    return `content://vault-${testCounter}`;
  }

  function nextRssFeedUrl(): string {
    testCounter += 1;
    return `https://feed.example.com/podcast-${testCounter}.xml`;
  }

  async function flushPromises(): Promise<void> {
    await new Promise<void>(resolve => {
      setTimeout(() => resolve(), 0);
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    clearInFlightCachedArtworkRequestsForTesting();
    (globalThis as unknown as {fetch: typeof fetch}).fetch =
      globalFetchMock as unknown as typeof fetch;
    asyncStorageGetItemMock.mockResolvedValue(null);
    asyncStorageSetItemMock.mockResolvedValue();
    asyncStorageRemoveItemMock.mockResolvedValue();
    safUriExistsMock.mockResolvedValue(true);
    podcastArtworkFileExistsMock.mockResolvedValue(true);
    clearPodcastImageCacheEntryMock.mockResolvedValue();
  });

  test('deduplicates parallel getCachedPodcastArtworkUri disk work for the same feed', async () => {
    const baseUri = nextBaseUri();
    const rssFeedUrl = nextRssFeedUrl();
    let readCount = 0;
    readCacheMock.mockImplementation(async () => {
      readCount += 1;
      await new Promise<void>(resolve => {
        setTimeout(resolve, 5);
      });
      return {
        fetchedAt: new Date().toISOString(),
        imageUrl: 'https://cdn.example.com/dedup.jpg',
        localImageUri: 'file:///data/app/dedup.jpg',
      };
    });

    const [first, second] = await Promise.all([
      getCachedPodcastArtworkUri(baseUri, rssFeedUrl),
      getCachedPodcastArtworkUri(baseUri, rssFeedUrl),
    ]);

    expect(first).toBe('file:///data/app/dedup.jpg');
    expect(second).toBe('file:///data/app/dedup.jpg');
    expect(readCount).toBe(1);
  });

  test('returns fresh local cache entry without fetching RSS', async () => {
    const baseUri = nextBaseUri();
    const rssFeedUrl = nextRssFeedUrl();
    readCacheMock.mockResolvedValueOnce({
      fetchedAt: new Date(Date.now() - 60_000).toISOString(),
      imageUrl: 'https://cdn.example.com/remote.jpg',
      localImageUri: 'content://com.android.externalstorage.documents/tree/primary/document/vault/rss-1.jpg',
    });

    await expect(getPodcastArtworkUri(baseUri, rssFeedUrl)).resolves.toBe(
      'content://com.android.externalstorage.documents/tree/primary/document/vault/rss-1.jpg',
    );
    expect(fetchRssArtworkUrlMock).not.toHaveBeenCalled();
    expect(globalFetchMock).not.toHaveBeenCalled();
    expect(writeCacheMock).not.toHaveBeenCalled();
  });

  test('returns only fresh entries in cached-only lookup', async () => {
    const baseUri = nextBaseUri();
    const freshRssFeedUrl = nextRssFeedUrl();
    const staleRssFeedUrl = nextRssFeedUrl();
    readCacheMock
      .mockResolvedValueOnce({
        fetchedAt: new Date(Date.now() - 60_000).toISOString(),
        imageUrl: 'https://cdn.example.com/remote.jpg',
        localImageUri: 'content://com.android.externalstorage.documents/tree/primary/document/vault/rss-2.jpg',
      })
      .mockResolvedValueOnce({
        fetchedAt: new Date(Date.now() - PODCAST_IMAGE_CACHE_TTL_MS - 60_000).toISOString(),
        imageUrl: 'https://cdn.example.com/old.jpg',
        localImageUri: 'content://com.android.externalstorage.documents/tree/primary/document/vault/rss-3.jpg',
      });

    await expect(getCachedPodcastArtworkUri(baseUri, freshRssFeedUrl)).resolves.toBe(
      'content://com.android.externalstorage.documents/tree/primary/document/vault/rss-2.jpg',
    );
    await expect(getCachedPodcastArtworkUri(baseUri, staleRssFeedUrl)).resolves.toBeNull();
  });

  test('expires remote-only fallback cache entries quickly for retry', async () => {
    const baseUri = nextBaseUri();
    const freshRemoteFallbackRssFeedUrl = nextRssFeedUrl();
    const staleRemoteFallbackRssFeedUrl = nextRssFeedUrl();
    readCacheMock
      .mockResolvedValueOnce({
        fetchedAt: new Date(Date.now() - (PODCAST_IMAGE_REMOTE_FALLBACK_TTL_MS - 1_000)).toISOString(),
        imageUrl: 'https://cdn.example.com/remote-fallback.jpg',
      })
      .mockResolvedValueOnce({
        fetchedAt: new Date(Date.now() - (PODCAST_IMAGE_REMOTE_FALLBACK_TTL_MS + 1_000)).toISOString(),
        imageUrl: 'https://cdn.example.com/remote-fallback.jpg',
      });

    await expect(getCachedPodcastArtworkUri(baseUri, freshRemoteFallbackRssFeedUrl)).resolves.toBe(
      'https://cdn.example.com/remote-fallback.jpg',
    );
    await expect(getCachedPodcastArtworkUri(baseUri, staleRemoteFallbackRssFeedUrl)).resolves.toBeNull();
  });

  test('fetches, downloads, and stores local artwork when cache is stale', async () => {
    const baseUri = nextBaseUri();
    const rssFeedUrl = nextRssFeedUrl();
    readCacheMock.mockResolvedValueOnce({
      fetchedAt: new Date(Date.now() - PODCAST_IMAGE_CACHE_TTL_MS - 60_000).toISOString(),
      imageUrl: 'https://cdn.example.com/stale.jpg',
    });
    fetchRssArtworkUrlMock.mockResolvedValueOnce(
      'https://cdn.example.com/new-cover.png',
    );
    globalFetchMock.mockResolvedValueOnce({
      arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
      headers: {get: () => 'image/png'},
      ok: true,
    });
    writeImageFileMock.mockResolvedValueOnce('file:///data/user/0/app/files/podcast-artwork-files/abc/rss-hex.png');

    await expect(getPodcastArtworkUri(baseUri, rssFeedUrl)).resolves.toBe(
      'file:///data/user/0/app/files/podcast-artwork-files/abc/rss-hex.png',
    );

    expect(writeImageFileMock).toHaveBeenCalledWith(
      baseUri,
      getPodcastImageCacheKey(rssFeedUrl),
      expect.any(String),
      'png',
      'image/png',
    );
    expect(writeCacheMock).toHaveBeenCalledWith(
      baseUri,
      getPodcastImageCacheKey(rssFeedUrl),
      expect.objectContaining({
        imageUrl: 'https://cdn.example.com/new-cover.png',
        localImageUri: 'file:///data/user/0/app/files/podcast-artwork-files/abc/rss-hex.png',
        mimeType: 'image/png',
      }),
    );
  });

  test('falls back to remote image URL when download fails', async () => {
    const baseUri = nextBaseUri();
    const rssFeedUrl = nextRssFeedUrl();
    readCacheMock.mockResolvedValueOnce(null);
    fetchRssArtworkUrlMock.mockResolvedValueOnce(
      'https://cdn.example.com/fallback.jpg',
    );
    globalFetchMock.mockResolvedValueOnce({
      ok: false,
    });

    await expect(getPodcastArtworkUri(baseUri, rssFeedUrl)).resolves.toBe(
      'https://cdn.example.com/fallback.jpg',
    );
    expect(writeImageFileMock).not.toHaveBeenCalled();
    expect(writeCacheMock).toHaveBeenCalledWith(
      baseUri,
      getPodcastImageCacheKey(rssFeedUrl),
      expect.objectContaining({
        imageUrl: 'https://cdn.example.com/fallback.jpg',
      }),
    );
  });

  test('reuses memory cache for cached-only lookups without extra SAF reads', async () => {
    const baseUri = nextBaseUri();
    const rssFeedUrl = nextRssFeedUrl();
    readCacheMock.mockResolvedValueOnce({
      fetchedAt: new Date(Date.now() - 60_000).toISOString(),
      imageUrl: 'https://cdn.example.com/remote.jpg',
      localImageUri: 'content://com.android.externalstorage.documents/tree/primary/document/vault/rss-4.jpg',
    });

    await expect(getCachedPodcastArtworkUri(baseUri, rssFeedUrl)).resolves.toBe(
      'content://com.android.externalstorage.documents/tree/primary/document/vault/rss-4.jpg',
    );
    await expect(getCachedPodcastArtworkUri(baseUri, rssFeedUrl)).resolves.toBe(
      'content://com.android.externalstorage.documents/tree/primary/document/vault/rss-4.jpg',
    );
    expect(readCacheMock).toHaveBeenCalledTimes(1);
  });

  test('loads persisted artwork URIs into memory cache', async () => {
    const baseUri = nextBaseUri();
    const rssFeedUrl = nextRssFeedUrl();
    const memoryCacheKey = `${baseUri}::${getPodcastImageCacheKey(rssFeedUrl)}`;
    asyncStorageGetItemMock.mockResolvedValueOnce(
      JSON.stringify({
        [memoryCacheKey]:
          'content://com.android.externalstorage.documents/tree/primary/document/vault/rss-persisted.jpg',
      }),
    );

    await loadPersistentArtworkUriCache(baseUri);
    await expect(getCachedPodcastArtworkUri(baseUri, rssFeedUrl)).resolves.toBe(
      'content://com.android.externalstorage.documents/tree/primary/document/vault/rss-persisted.jpg',
    );

    expect(asyncStorageGetItemMock).toHaveBeenCalledWith(
      `eskerra:artworkUriCache:${baseUri}`,
    );
    expect(readCacheMock).not.toHaveBeenCalled();
  });

  test('peekCachedPodcastArtworkUriFromMemory returns hydrated URI without async read', async () => {
    const baseUri = nextBaseUri();
    const rssFeedUrl = nextRssFeedUrl();
    const memoryCacheKey = `${baseUri}::${getPodcastImageCacheKey(rssFeedUrl)}`;
    asyncStorageGetItemMock.mockResolvedValueOnce(
      JSON.stringify({
        [memoryCacheKey]:
          'content://com.android.externalstorage.documents/tree/primary/document/vault/rss-peek.jpg',
      }),
    );

    await loadPersistentArtworkUriCache(baseUri);
    expect(peekCachedPodcastArtworkUriFromMemory(baseUri, rssFeedUrl)).toBe(
      'content://com.android.externalstorage.documents/tree/primary/document/vault/rss-peek.jpg',
    );
    expect(readCacheMock).not.toHaveBeenCalled();
  });

  test('peekCachedPodcastArtworkUriFromMemory returns null when memory is cold', () => {
    const baseUri = nextBaseUri();
    const rssFeedUrl = nextRssFeedUrl();
    expect(peekCachedPodcastArtworkUriFromMemory(baseUri, rssFeedUrl)).toBeNull();
  });

  test('writes through artwork URI memory updates to AsyncStorage', async () => {
    const baseUri = nextBaseUri();
    const rssFeedUrl = nextRssFeedUrl();
    const expectedUri =
      'content://com.android.externalstorage.documents/tree/primary/document/vault/rss-write-through.jpg';
    readCacheMock.mockResolvedValueOnce({
      fetchedAt: new Date(Date.now() - 60_000).toISOString(),
      imageUrl: 'https://cdn.example.com/remote-write-through.jpg',
      localImageUri: expectedUri,
    });

    await expect(getCachedPodcastArtworkUri(baseUri, rssFeedUrl)).resolves.toBe(expectedUri);
    await flushPromises();

    const expectedMemoryCacheKey = `${baseUri}::${getPodcastImageCacheKey(rssFeedUrl)}`;
    expect(asyncStorageSetItemMock).toHaveBeenCalledWith(
      `eskerra:artworkUriCache:${baseUri}`,
      JSON.stringify({
        [expectedMemoryCacheKey]: expectedUri,
      }),
    );
  });

  test('strips local path from disk cache when image file is missing and returns remote URL', async () => {
    const baseUri = nextBaseUri();
    const rssFeedUrl = nextRssFeedUrl();
    const localUri = 'file:///data/user/0/app/files/podcast-artwork-files/v/rss-missing.jpg';
    const remoteUrl = 'https://cdn.example.com/still-here.jpg';
    const fetchedAt = new Date(Date.now() - 60_000).toISOString();
    readCacheMock
      .mockResolvedValueOnce({
        fetchedAt,
        imageUrl: remoteUrl,
        localImageUri: localUri,
      })
      .mockResolvedValueOnce({
        fetchedAt,
        imageUrl: remoteUrl,
      });
    podcastArtworkFileExistsMock.mockResolvedValue(false);

    await expect(getCachedPodcastArtworkUri(baseUri, rssFeedUrl)).resolves.toBe(remoteUrl);

    expect(podcastArtworkFileExistsMock).toHaveBeenCalledWith(localUri);
    expect(writeCacheMock).toHaveBeenCalledWith(baseUri, getPodcastImageCacheKey(rssFeedUrl), {
      fetchedAt,
      imageUrl: remoteUrl,
    });
  });

  test('clears disk cache entry when local file is missing and there is no remote URL', async () => {
    const baseUri = nextBaseUri();
    const rssFeedUrl = nextRssFeedUrl();
    const localUri = 'file:///data/user/0/app/files/podcast-artwork-files/v/rss-onlylocal.jpg';
    const fetchedAt = new Date(Date.now() - 60_000).toISOString();
    readCacheMock
      .mockResolvedValueOnce({
        fetchedAt,
        imageUrl: '',
        localImageUri: localUri,
      })
      .mockResolvedValueOnce(null);
    podcastArtworkFileExistsMock.mockResolvedValue(false);

    await expect(getCachedPodcastArtworkUri(baseUri, rssFeedUrl)).resolves.toBeNull();

    expect(clearPodcastImageCacheEntryMock).toHaveBeenCalledWith(
      baseUri,
      getPodcastImageCacheKey(rssFeedUrl),
    );
  });

  test('does not hydrate AsyncStorage content URIs when the file no longer exists', async () => {
    const baseUri = nextBaseUri();
    const rssFeedUrl = nextRssFeedUrl();
    const memoryCacheKey = `${baseUri}::${getPodcastImageCacheKey(rssFeedUrl)}`;
    const deadUri =
      'content://com.android.externalstorage.documents/tree/primary/document/vault/rss-dead.jpg';
    asyncStorageGetItemMock.mockResolvedValueOnce(
      JSON.stringify({
        [memoryCacheKey]: deadUri,
      }),
    );
    safUriExistsMock.mockResolvedValue(false);

    await loadPersistentArtworkUriCache(baseUri);

    expect(peekCachedPodcastArtworkUriFromMemory(baseUri, rssFeedUrl)).toBeNull();
    expect(asyncStorageRemoveItemMock).toHaveBeenCalledWith(
      `eskerra:artworkUriCache:${baseUri}`,
    );
  });

  test('does not hydrate AsyncStorage file URIs when the internal file no longer exists', async () => {
    const baseUri = nextBaseUri();
    const rssFeedUrl = nextRssFeedUrl();
    const memoryCacheKey = `${baseUri}::${getPodcastImageCacheKey(rssFeedUrl)}`;
    const deadFile = 'file:///data/user/0/app/files/podcast-artwork-files/v/rss-dead.jpg';
    asyncStorageGetItemMock.mockResolvedValueOnce(
      JSON.stringify({
        [memoryCacheKey]: deadFile,
      }),
    );
    podcastArtworkFileExistsMock.mockResolvedValue(false);

    await loadPersistentArtworkUriCache(baseUri);

    expect(peekCachedPodcastArtworkUriFromMemory(baseUri, rssFeedUrl)).toBeNull();
    expect(asyncStorageRemoveItemMock).toHaveBeenCalledWith(
      `eskerra:artworkUriCache:${baseUri}`,
    );
  });
});

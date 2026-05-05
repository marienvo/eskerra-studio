import {beforeEach, describe, expect, it, vi} from 'vitest';

import {getGeneralDirectoryUri} from '@eskerra/core';
import type {VaultDirEntry, VaultFilesystem} from '@eskerra/core';

import {
  clearPodcastMarkdownFileContentCache,
  runPodcastPhase1Desktop,
} from './podcastPhase1Desktop';

const storeMocks = vi.hoisted(() => ({
  get: vi.fn(),
  save: vi.fn(),
  set: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-store', () => ({
  load: vi.fn(async () => storeMocks),
}));

const VAULT_ROOT = '/v';
const GENERAL_URI = getGeneralDirectoryUri(VAULT_ROOT);
const YEAR = new Date().getFullYear();
const PODCAST_FILE_NAME = `${YEAR} EnrichTest - podcasts.md`;
const PODCAST_FILE_URI = `${GENERAL_URI}/${PODCAST_FILE_NAME}`;
const RSS_TITLE = 'EnrichTest Feed';
const RSS_FILE_NAME = `📻 ${RSS_TITLE}.md`;
const RSS_FILE_URI = `${GENERAL_URI}/${RSS_FILE_NAME}`;
const MP3 = 'https://example.com/e1.mp3';

const PODCAST_BODY = `- [ ] ${YEAR}-06-01;Hello ep [▶️](${MP3}) (${RSS_TITLE})\n`;

const RSS_BODY = `---
rssFeedUrl: https://example.com/podcast.xml
---

# ${RSS_TITLE}
`;

function createPhase1MemoryFs(opts: {
  podcastBody: string;
  rssBody?: string;
  includeRssFile: boolean;
  lastModified: number;
}): VaultFilesystem {
  const entries: VaultDirEntry[] = [
    {
      lastModified: opts.lastModified,
      name: PODCAST_FILE_NAME,
      type: 'file',
      uri: PODCAST_FILE_URI,
    },
  ];
  if (opts.includeRssFile) {
    entries.push({
      lastModified: opts.lastModified,
      name: RSS_FILE_NAME,
      type: 'file',
      uri: RSS_FILE_URI,
    });
  }

  const files = new Map<string, string | 'dir'>([
    [VAULT_ROOT, 'dir'],
    [GENERAL_URI, 'dir'],
    [PODCAST_FILE_URI, opts.podcastBody],
  ]);
  if (opts.includeRssFile && opts.rssBody) {
    files.set(RSS_FILE_URI, opts.rssBody);
  }

  return {
    exists: async uri => files.has(uri) || files.get(uri) === 'dir',
    mkdir: async uri => {
      files.set(uri, 'dir');
    },
    readFile: async uri => {
      const v = files.get(uri);
      if (v === 'dir' || v === undefined) {
        throw new Error(`readFile: not found ${uri}`);
      }
      return v;
    },
    writeFile: async (uri, content) => {
      files.set(uri, content);
    },
    unlink: async uri => {
      files.delete(uri);
    },
    renameFile: async (fromUri, toUri) => {
      const v = files.get(fromUri);
      if (v === undefined || v === 'dir') {
        throw new Error('not found');
      }
      files.delete(fromUri);
      files.set(toUri, v);
    },
    listFiles: async (directoryUri: string): Promise<VaultDirEntry[]> => {
      if (directoryUri === GENERAL_URI) {
        return entries;
      }
      return [];
    },
    removeTree: async () => {},
  };
}

describe('runPodcastPhase1Desktop podcastNoteUri', () => {
  beforeEach(() => {
    clearPodcastMarkdownFileContentCache();
    storeMocks.get.mockReset();
    storeMocks.get.mockResolvedValue(undefined);
    storeMocks.save.mockReset();
    storeMocks.save.mockResolvedValue(undefined);
    storeMocks.set.mockReset();
    storeMocks.set.mockResolvedValue(undefined);
  });

  it('sets podcastNoteUri on episodes when a matching 📻 note exists', async () => {
    const fs = createPhase1MemoryFs({
      podcastBody: PODCAST_BODY,
      rssBody: RSS_BODY,
      includeRssFile: true,
      lastModified: 1000,
    });

    const result = await runPodcastPhase1Desktop(VAULT_ROOT, fs, {forceFullScan: true});
    expect(result.error).toBeNull();
    const ep = result.allEpisodes.find(e => e.mp3Url === MP3);
    expect(ep).toBeDefined();
    expect(ep?.podcastNoteUri).toBe(RSS_FILE_URI);
  });

  it('leaves podcastNoteUri undefined when no 📻 note matches the series', async () => {
    const fs = createPhase1MemoryFs({
      podcastBody: `- [ ] ${YEAR}-06-01;Orphan [▶️](${MP3}) (OrphanSeries)\n`,
      rssBody: RSS_BODY,
      includeRssFile: true,
      lastModified: 1000,
    });

    const result = await runPodcastPhase1Desktop(VAULT_ROOT, fs, {forceFullScan: true});
    expect(result.error).toBeNull();
    const ep = result.allEpisodes.find(e => e.title === 'Orphan');
    expect(ep?.podcastNoteUri).toBeUndefined();
  });

  it('leaves podcastNoteUri undefined when there are no 📻 files', async () => {
    const fs = createPhase1MemoryFs({
      podcastBody: PODCAST_BODY,
      includeRssFile: false,
      lastModified: 1000,
    });

    const result = await runPodcastPhase1Desktop(VAULT_ROOT, fs, {forceFullScan: true});
    expect(result.error).toBeNull();
    const ep = result.allEpisodes.find(e => e.mp3Url === MP3);
    expect(ep?.podcastNoteUri).toBeUndefined();
  });

  it('falls back to a full scan when the persisted markdown index is stale', async () => {
    const staleIndex = JSON.stringify({
      entries: [
        {
          lastModified: 1,
          name: PODCAST_FILE_NAME,
          uri: `${GENERAL_URI}/missing.md`,
        },
      ],
      snapshottedAt: '2026-01-01T00:00:00.000Z',
      v: 1,
    });
    storeMocks.get.mockImplementation(async (key: string) =>
      key.startsWith('podcastMarkdownIndex:') ? staleIndex : undefined,
    );
    const fs = createPhase1MemoryFs({
      podcastBody: PODCAST_BODY,
      includeRssFile: false,
      lastModified: 1000,
    });

    const result = await runPodcastPhase1Desktop(VAULT_ROOT, fs, {forceFullScan: false});

    expect(result.error).toBeNull();
    expect(result.didFullVaultListingThisRefresh).toBe(true);
    expect(result.sections).toHaveLength(1);
    expect(result.allEpisodes[0]?.mp3Url).toBe(MP3);
    expect(storeMocks.set).toHaveBeenCalled();
  });

  it('loads episodes when persisting the markdown index cache fails', async () => {
    storeMocks.save.mockRejectedValueOnce(new Error('store unavailable'));
    const fs = createPhase1MemoryFs({
      podcastBody: PODCAST_BODY,
      includeRssFile: false,
      lastModified: 1000,
    });

    const result = await runPodcastPhase1Desktop(VAULT_ROOT, fs, {forceFullScan: true});

    expect(result.error).toBeNull();
    expect(result.sections).toHaveLength(1);
    expect(result.allEpisodes[0]?.mp3Url).toBe(MP3);
  });
});

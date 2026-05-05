import {
  getGeneralDirectoryUri,
  MARKDOWN_EXTENSION,
  normalizeVaultBaseUri,
} from '@eskerra/core';
import type {VaultFilesystem} from '@eskerra/core';

import {
  filterPodcastRelevantGeneralMarkdownFiles,
  splitPodcastAndRssMarkdownFiles,
} from './generalIndex';
import {
  loadPersistedPodcastMarkdownIndex,
  savePersistedPodcastMarkdownIndex,
} from './podcastMarkdownIndexStore';
import {groupBySection, isPodcastFile, parsePodcastFile} from './podcastParser';
import type {PodcastEpisode, PodcastSection, RootMarkdownFile} from './podcastTypes';
import {extractRssFeedUrl, extractRssPodcastTitle} from './rssParser';
import {
  clearPodcastNoteUriCacheForVault,
  persistPodcastNoteUri,
  resolveCachedPodcastNoteUri,
} from './podcastNoteUriCacheDesktop';
import {
  hydrateRssFeedUrlCacheFromStore,
  persistRssFeedUrl,
  resolveCachedRssFeedUrl,
} from './rssFeedUrlCacheDesktop';

export type RefreshPodcastsOptions = {
  forceFullScan?: boolean;
};

type FileContentCacheEntry = {lastModified: number; content: string};
const fileContentCache = new Map<string, FileContentCacheEntry>();

export function clearPodcastMarkdownFileContentCache(): void {
  fileContentCache.clear();
}

/** Vitest harness: same as {@link clearPodcastMarkdownFileContentCache}. */
export function __resetForTests(): void {
  clearPodcastMarkdownFileContentCache();
}

/** Drop cached markdown for one URI (e.g. after mark-as-played writes new content). */
export function invalidatePodcastMarkdownFileContentCacheEntry(uri: string): void {
  fileContentCache.delete(uri);
}

/**
 * Seed session cache so the next `readMarkdownWithSessionCache` hit returns `content` when the
 * catalog still carries a matching `lastModified` (stale index after local writes).
 */
export function primePodcastMarkdownFileContentCacheEntry(
  uri: string,
  lastModified: number,
  content: string,
): void {
  if (lastModified > 0) {
    fileContentCache.set(uri, {lastModified, content});
  }
}

async function readMarkdownWithSessionCache(
  file: RootMarkdownFile,
  fs: VaultFilesystem,
): Promise<{content: string; file: RootMarkdownFile}> {
  const lastModified = file.lastModified ?? -1;
  const cached = fileContentCache.get(file.uri);
  if (cached && lastModified > 0 && cached.lastModified === lastModified) {
    return {content: cached.content, file};
  }
  const content = await fs.readFile(file.uri, {encoding: 'utf8'});
  if (lastModified > 0) {
    fileContentCache.set(file.uri, {lastModified, content});
  }
  return {content, file};
}

export function enrichEpisodesWithCachedRss(
  baseUri: string,
  episodes: PodcastEpisode[],
): PodcastEpisode[] {
  return episodes.map(episode => ({
    ...episode,
    rssFeedUrl:
      episode.rssFeedUrl ??
      resolveCachedRssFeedUrl(baseUri, episode.seriesName) ??
      resolveCachedRssFeedUrl(baseUri, episode.sectionTitle),
    podcastNoteUri:
      episode.podcastNoteUri ??
      resolveCachedPodcastNoteUri(baseUri, episode.seriesName) ??
      resolveCachedPodcastNoteUri(baseUri, episode.sectionTitle),
  }));
}

export function createSectionsWithRss(
  baseUri: string,
  episodes: PodcastEpisode[],
): PodcastSection[] {
  return groupBySection(episodes.filter(episode => !episode.isListened)).map(section => {
    const rssFeedUrl =
      section.episodes.find(episode => episode.rssFeedUrl)?.rssFeedUrl ??
      resolveCachedRssFeedUrl(baseUri, section.title);

    return {
      ...section,
      rssFeedUrl,
    };
  });
}

export async function listGeneralMarkdownFiles(
  baseUri: string,
  fs: VaultFilesystem,
): Promise<RootMarkdownFile[]> {
  const general = getGeneralDirectoryUri(normalizeVaultBaseUri(baseUri));
  if (!(await fs.exists(general))) {
    return [];
  }
  const rows = await fs.listFiles(general);
  return rows
    .filter(
      r =>
        (r.type === 'file' || r.type === undefined) && r.name.endsWith(MARKDOWN_EXTENSION),
    )
    .map(r => ({
      lastModified: r.lastModified,
      name: r.name,
      uri: r.uri,
    }));
}

export async function buildPodcastSectionsFromPodcastMarkdownFiles(
  baseUri: string,
  podcastFiles: RootMarkdownFile[],
  fs: VaultFilesystem,
): Promise<{
  nextAllEpisodes: PodcastEpisode[];
  nextSections: PodcastSection[];
}> {
  const contentsByFile = await Promise.all(
    podcastFiles.map(file => readMarkdownWithSessionCache(file, fs)),
  );

  const legacyEpisodes: PodcastEpisode[] = [];

  for (const {content, file} of contentsByFile) {
    if (isPodcastFile(file.name)) {
      legacyEpisodes.push(...parsePodcastFile(file.name, content));
    }
  }

  const legacyEpisodesWithRss = enrichEpisodesWithCachedRss(baseUri, legacyEpisodes);

  const dedupedEpisodes = new Map<string, PodcastEpisode>();
  for (const episode of legacyEpisodesWithRss) {
    if (!dedupedEpisodes.has(episode.id)) {
      dedupedEpisodes.set(episode.id, episode);
    }
  }

  const nextAllEpisodes = Array.from(dedupedEpisodes.values()).sort((left, right) =>
    right.date.localeCompare(left.date),
  );
  const nextSections = createSectionsWithRss(baseUri, nextAllEpisodes);

  return {nextAllEpisodes, nextSections};
}

export type PodcastPhase1DesktopResult = {
  allEpisodes: PodcastEpisode[];
  didFullVaultListingThisRefresh: boolean;
  error: string | null;
  podcastRelevantFiles: RootMarkdownFile[];
  rssFeedFiles: RootMarkdownFile[];
  sections: PodcastSection[];
};

async function loadPodcastRelevantFiles(
  baseUri: string,
  fs: VaultFilesystem,
): Promise<{files: RootMarkdownFile[]; didFullVaultListingThisRefresh: boolean}> {
  const full = await listGeneralMarkdownFiles(baseUri, fs);
  const files = filterPodcastRelevantGeneralMarkdownFiles(full);
  try {
    await savePersistedPodcastMarkdownIndex(baseUri, files);
  } catch {
    // The persisted index is a startup optimization; vault markdown is the source of truth.
  }
  return {didFullVaultListingThisRefresh: true, files};
}

async function runRssMarkdownEnrichment(
  baseUri: string,
  renderedEpisodes: PodcastEpisode[],
  rssFeedFiles: RootMarkdownFile[],
  fs: VaultFilesystem,
): Promise<{episodes: PodcastEpisode[]; sections: PodcastSection[]}> {
  if (rssFeedFiles.length === 0) {
    return {episodes: renderedEpisodes, sections: createSectionsWithRss(baseUri, renderedEpisodes)};
  }

  const rssContentsByFile = await Promise.all(
    rssFeedFiles.map(file => readMarkdownWithSessionCache(file, fs)),
  );

  for (const {content, file} of rssContentsByFile) {
    const rssFeedUrl = extractRssFeedUrl(content);
    if (!rssFeedUrl) {
      continue;
    }
    const sectionTitle = extractRssPodcastTitle(file.name, content);
    persistRssFeedUrl(baseUri, sectionTitle, rssFeedUrl);
    persistPodcastNoteUri(baseUri, sectionTitle, file.uri);
  }

  const enrichedEpisodes = enrichEpisodesWithCachedRss(baseUri, renderedEpisodes);
  return {
    episodes: enrichedEpisodes,
    sections: createSectionsWithRss(baseUri, enrichedEpisodes),
  };
}

export async function runPodcastPhase1Desktop(
  baseUri: string,
  fs: VaultFilesystem,
  options?: RefreshPodcastsOptions,
): Promise<PodcastPhase1DesktopResult> {
  const forceFullScan = options?.forceFullScan ?? false;

  let rssFeedFiles: RootMarkdownFile[] = [];

  try {
    try {
      await hydrateRssFeedUrlCacheFromStore(baseUri);
    } catch {
      // RSS URL cache hydration should not block loading episodes from vault markdown.
    }

    let podcastRelevantFiles: RootMarkdownFile[];
    let didFullVaultListingThisRefresh = false;

    if (!forceFullScan) {
      let persisted: RootMarkdownFile[] | null;
      try {
        persisted = await loadPersistedPodcastMarkdownIndex(baseUri);
      } catch {
        persisted = null;
      }
      if (persisted !== null) {
        podcastRelevantFiles = persisted;
      } else {
        const loaded = await loadPodcastRelevantFiles(baseUri, fs);
        podcastRelevantFiles = loaded.files;
        didFullVaultListingThisRefresh = loaded.didFullVaultListingThisRefresh;
      }
    } else {
      const loaded = await loadPodcastRelevantFiles(baseUri, fs);
      podcastRelevantFiles = loaded.files;
      didFullVaultListingThisRefresh = loaded.didFullVaultListingThisRefresh;
    }

    const buildFromRelevantFiles = async (files: RootMarkdownFile[]) => {
      const {podcastFiles, rssFeedFiles: rssMarkdownFiles} =
        splitPodcastAndRssMarkdownFiles(files);
      rssFeedFiles = rssMarkdownFiles;

      clearPodcastNoteUriCacheForVault(baseUri);

      const {nextAllEpisodes} = await buildPodcastSectionsFromPodcastMarkdownFiles(
        baseUri,
        podcastFiles,
        fs,
      );

      return runRssMarkdownEnrichment(
        baseUri,
        nextAllEpisodes,
        rssFeedFiles,
        fs,
      );
    };

    let enriched: {episodes: PodcastEpisode[]; sections: PodcastSection[]};
    try {
      enriched = await buildFromRelevantFiles(podcastRelevantFiles);
    } catch (loadFromIndexError) {
      if (forceFullScan || didFullVaultListingThisRefresh) {
        throw loadFromIndexError;
      }
      const loaded = await loadPodcastRelevantFiles(baseUri, fs);
      podcastRelevantFiles = loaded.files;
      didFullVaultListingThisRefresh = loaded.didFullVaultListingThisRefresh;
      enriched = await buildFromRelevantFiles(podcastRelevantFiles);
    }

    return {
      allEpisodes: enriched.episodes,
      didFullVaultListingThisRefresh,
      error: null,
      podcastRelevantFiles,
      rssFeedFiles,
      sections: enriched.sections,
    };
  } catch (loadError) {
    const fallbackMessage = 'Could not load podcasts from vault.';
    return {
      allEpisodes: [],
      didFullVaultListingThisRefresh: false,
      error: loadError instanceof Error ? loadError.message : fallbackMessage,
      podcastRelevantFiles: [],
      rssFeedFiles: [],
      sections: [],
    };
  }
}

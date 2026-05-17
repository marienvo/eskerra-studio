import {
  isAsciiWhitespaceCode,
  parseTaskCheckboxMarkAfterOpenBracket,
  trimAsciiWhitespace,
  trimEndAsciiWhitespace,
} from '../stringScanners';
import {scanPlayTriangleMarkdownLinks} from './playMarkdownLinkScan';

const ARTICLE_LINK_OPEN = '[🌐](';

const PODCASTS_MD_SUFFIX = 'podcasts.md';

export type PodcastMarkdownFileDetails = {
  sectionTitle: string;
  year: number;
};

export type PodcastMarkdownEpisode = {
  articleUrl?: string;
  date: string;
  id: string;
  isListened: boolean;
  mp3Url: string;
  sectionTitle: string;
  seriesName: string;
  sourceFile: string;
  title: string;
};

export type PodcastMarkdownSection = {
  episodes: PodcastMarkdownEpisode[];
  title: string;
};

export type ParsePodcastEpisodeLineInput = {
  line: string;
  sectionTitle: string;
  sourceFile: string;
};

/** Strips trailing ` - … podcasts.md` without backtracking-heavy regex (vault filenames vary). */
function stemBeforePodcastsMd(trimmed: string): string | null {
  const lower = trimmed.toLowerCase();
  if (!lower.endsWith(PODCASTS_MD_SUFFIX)) {
    return null;
  }
  const withoutExt = trimEndAsciiWhitespace(trimmed.slice(0, -PODCASTS_MD_SUFFIX.length));
  let i = withoutExt.length - 1;
  while (i >= 0 && isAsciiWhitespaceCode(withoutExt.charCodeAt(i))) {
    i -= 1;
  }
  if (i < 0 || withoutExt.charAt(i) !== '-') {
    return null;
  }
  i -= 1;
  while (i >= 0 && isAsciiWhitespaceCode(withoutExt.charCodeAt(i))) {
    i -= 1;
  }
  if (i < 0) {
    return null;
  }
  return trimEndAsciiWhitespace(withoutExt.slice(0, i + 1));
}

function isFourDigitYear(s: string): boolean {
  if (s.length !== 4) {
    return false;
  }
  for (let k = 0; k < 4; k++) {
    const c = s.charCodeAt(k);
    if (c < 48 || c > 57) {
      return false;
    }
  }
  return true;
}

/** Parses `YYYY Section title` from stem without nested quantifiers. */
function parseYearAndSectionTitle(stem: string): {sectionTitle: string; year: number} | null {
  if (stem.length < 6 || !isFourDigitYear(stem.slice(0, 4))) {
    return null;
  }
  let pos = 4;
  while (pos < stem.length && isAsciiWhitespaceCode(stem.charCodeAt(pos))) {
    pos += 1;
  }
  if (pos === 4) {
    return null;
  }
  const sectionTitle = trimAsciiWhitespace(stem.slice(pos));
  const year = Number(stem.slice(0, 4));

  if (!sectionTitle) {
    return null;
  }

  return {sectionTitle, year};
}

export function parsePodcastFileDetails(fileName: string): PodcastMarkdownFileDetails | null {
  const trimmed = trimAsciiWhitespace(fileName);
  const stem = stemBeforePodcastsMd(trimmed);
  if (!stem) {
    return null;
  }
  const parsed = parseYearAndSectionTitle(stem);
  if (!parsed) {
    return null;
  }
  return parsed;
}

function isSupportedYear(year: number, currentYear: number): boolean {
  return year === currentYear || year === currentYear + 1;
}

export function isPodcastEpisodesFile(
  fileName: string,
  currentYear = new Date().getFullYear(),
): boolean {
  const details = parsePodcastFileDetails(fileName);

  if (!details) {
    return false;
  }

  return isSupportedYear(details.year, currentYear);
}

export function extractPodcastSectionTitle(fileName: string): string | null {
  const details = parsePodcastFileDetails(fileName);
  return details?.sectionTitle ?? null;
}

function isIsoDateOnly(s: string): boolean {
  if (s.length !== 10) {
    return false;
  }
  for (let i = 0; i < 10; i++) {
    const c = s.charCodeAt(i);
    if (i === 4 || i === 7) {
      if (c !== 45) {
        return false;
      }
    } else if (c < 48 || c > 57) {
      return false;
    }
  }
  return true;
}

function splitDatePrefix(value: string): {date: string; remainder: string} | null {
  const separatorIdx = value.indexOf(';');
  if (separatorIdx < 0) {
    return null;
  }
  const date = trimAsciiWhitespace(value.slice(0, separatorIdx));
  if (!isIsoDateOnly(date)) {
    return null;
  }
  const remainder = trimAsciiWhitespace(value.slice(separatorIdx + 1));
  if (!remainder) {
    return null;
  }
  return {date, remainder};
}

function parseSeriesTail(remainder: string): {seriesName: string; openParenIndex: number} | null {
  const endTrim = trimEndAsciiWhitespace(remainder);
  if (endTrim.length < 3 || endTrim.charCodeAt(endTrim.length - 1) !== 41) {
    return null;
  }
  const lastOpen = endTrim.lastIndexOf('(', endTrim.length - 2);
  if (lastOpen < 0) {
    return null;
  }
  const inner = endTrim.slice(lastOpen + 1, -1);
  if (inner.includes('(') || inner.includes(')')) {
    return null;
  }
  const seriesName = trimAsciiWhitespace(inner);
  if (!seriesName) {
    return null;
  }
  return {seriesName, openParenIndex: lastOpen};
}

function tryParseLeadingArticleLink(
  beforePlayLink: string,
): {articleUrl: string; consumedLen: number} | null {
  if (!beforePlayLink.startsWith(ARTICLE_LINK_OPEN)) {
    return null;
  }
  let q = ARTICLE_LINK_OPEN.length;
  while (q < beforePlayLink.length) {
    const c = beforePlayLink[q]!;
    if (c === '\\' && q + 1 < beforePlayLink.length) {
      q += 2;
      continue;
    }
    if (c === ')') {
      const articleUrl = trimAsciiWhitespace(beforePlayLink.slice(ARTICLE_LINK_OPEN.length, q));
      let end = q + 1;
      while (end < beforePlayLink.length && isAsciiWhitespaceCode(beforePlayLink.charCodeAt(end))) {
        end++;
      }
      return {articleUrl, consumedLen: end};
    }
    q++;
  }
  return null;
}

function parseEpisodePrefix(trimmed: string): {played: boolean; rest: string} | null {
  if (trimmed.length < 2 || trimmed[0] !== '-') {
    return null;
  }
  let i = 1;
  while (i < trimmed.length && isAsciiWhitespaceCode(trimmed.charCodeAt(i))) {
    i++;
  }
  if (i >= trimmed.length || trimmed[i] !== '[') {
    return null;
  }
  i++;
  const cb = parseTaskCheckboxMarkAfterOpenBracket(trimmed, i);
  if (cb == null) {
    return null;
  }
  i = cb.indexAfterCheckboxBody;
  while (i < trimmed.length && isAsciiWhitespaceCode(trimmed.charCodeAt(i))) {
    i++;
  }
  if (i >= trimmed.length || trimmed[i] !== ']') {
    return null;
  }
  i++;
  while (i < trimmed.length && isAsciiWhitespaceCode(trimmed.charCodeAt(i))) {
    i++;
  }
  return {played: cb.checked, rest: trimmed.slice(i)};
}

export function parsePodcastEpisodeLine({
  line,
  sectionTitle,
  sourceFile,
}: ParsePodcastEpisodeLineInput): PodcastMarkdownEpisode | null {
  const trimmedLine = trimAsciiWhitespace(line);
  const prefixMatch = parseEpisodePrefix(trimmedLine);

  if (!prefixMatch) {
    return null;
  }

  const isListened = prefixMatch.played;
  const withoutPrefix = trimAsciiWhitespace(prefixMatch.rest);
  const parsedPrefix = splitDatePrefix(withoutPrefix);
  if (!parsedPrefix) {
    return null;
  }

  const {date, remainder} = parsedPrefix;

  const playMatches = scanPlayTriangleMarkdownLinks(remainder);
  const lastPlayMatch = playMatches.at(-1);
  if (!lastPlayMatch) {
    return null;
  }

  const mp3Url = trimAsciiWhitespace(lastPlayMatch.url);
  if (!mp3Url) {
    return null;
  }

  const beforePlayLink = trimAsciiWhitespace(remainder.slice(0, lastPlayMatch.start));
  const seriesMatch = parseSeriesTail(remainder);
  if (!seriesMatch) {
    return null;
  }

  const seriesName = seriesMatch.seriesName;
  if (!seriesName) {
    return null;
  }

  let articleUrl: string | undefined;
  let title = beforePlayLink;
  const articleMatch = tryParseLeadingArticleLink(beforePlayLink);
  if (articleMatch) {
    articleUrl = articleMatch.articleUrl;
    title = trimAsciiWhitespace(beforePlayLink.slice(articleMatch.consumedLen));
  }

  if (!title) {
    return null;
  }

  return {
    articleUrl,
    date,
    id: mp3Url,
    isListened,
    mp3Url,
    sectionTitle,
    seriesName,
    sourceFile,
    title,
  };
}

export function parsePodcastEpisodesMarkdownFile(
  fileName: string,
  content: string,
  currentYear = new Date().getFullYear(),
): PodcastMarkdownEpisode[] {
  const details = parsePodcastFileDetails(fileName);

  if (!details || !isSupportedYear(details.year, currentYear)) {
    return [];
  }

  return content
    .split(/\r?\n/)
    .map(line =>
      parsePodcastEpisodeLine({
        line,
        sectionTitle: details.sectionTitle,
        sourceFile: fileName,
      }),
    )
    .filter((episode): episode is PodcastMarkdownEpisode => episode !== null);
}

export function groupPodcastEpisodesBySection(
  episodes: PodcastMarkdownEpisode[],
): PodcastMarkdownSection[] {
  const bySection = new Map<string, PodcastMarkdownEpisode[]>();

  for (const episode of episodes) {
    const currentGroup = bySection.get(episode.sectionTitle) ?? [];
    currentGroup.push(episode);
    bySection.set(episode.sectionTitle, currentGroup);
  }

  return Array.from(bySection.entries())
    .map(([title, groupedEpisodes]) => ({
      episodes: groupedEpisodes.sort((left, right) =>
        right.date.localeCompare(left.date),
      ),
      title,
    }))
    .sort((left, right) => left.title.localeCompare(right.title));
}

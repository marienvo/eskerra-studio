import {XMLParser} from 'fast-xml-parser';

import {splitYamlFrontmatter} from './markdown/splitYamlFrontmatter';

export type PodcastRssSettings = {
  /** First feed URL, kept for existing callers that only handle one feed. */
  rssFeedUrl: string;
  rssFeedUrls: string[];
  daysAgo: number;
  timeoutMs: number;
  minFetchIntervalMinutes: number;
};

export type PodcastRssSyncEpisode = {
  publishedAt: Date;
  title: string;
  webUrl: string | null;
  audioUrl: string | null;
  dedupeKey: string;
};

const DEFAULT_DAYS_AGO = 7;
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MIN_FETCH_INTERVAL_MINUTES = 0;
const DEFAULT_TITLE_FALLBACK = 'Untitled episode';
const RSS_FETCHED_AT_KEY = 'rssFetchedAt';

// --- Frontmatter parsing ---

function parseFrontmatterStringValue(frontmatter: string, key: string): unknown {
  if (frontmatter.trim().length === 0) return undefined;
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = frontmatter.match(
    new RegExp(`^[ \\t]*${escapedKey}[ \\t]*:[ \\t]*([^\\r\\n]+)[ \\t]*$`, 'm'),
  );
  if (match == null) return undefined;
  const rawValue = match[1].trim();
  if (rawValue.length === 0) return '';
  const singleQuoted =
    rawValue.startsWith('\'') && rawValue.endsWith('\'') && rawValue.length >= 2
      ? rawValue.slice(1, -1).trim()
      : null;
  if (singleQuoted != null) return singleQuoted;
  const shouldTryJson = /^("|-?\d|true$|false$|null$|\{|\[)/i.test(rawValue);
  if (!shouldTryJson) return rawValue;
  try {
    return JSON.parse(rawValue);
  } catch {
    return rawValue;
  }
}

function parseYamlListItems(frontmatter: string, key: string): string[] {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const keyLineRegex = new RegExp(`^([ \\t]*)${escapedKey}[ \\t]*:[ \\t]*$`);
  const lines = frontmatter.split(/\r?\n/);
  let keyIndent = -1;
  const result: string[] = [];
  for (const line of lines) {
    if (keyIndent < 0) {
      const m = line.match(keyLineRegex);
      if (m != null) keyIndent = m[1]?.length ?? 0;
      continue;
    }
    if (line.trim().length === 0) continue;
    const currentIndent = line.match(/^([ \t]*)/)?.[1]?.length ?? 0;
    if (
      currentIndent <= keyIndent &&
      (/^[ \t]*[A-Za-z0-9_-]+\s*:/.test(line) || line.trim() === '---')
    ) {
      break;
    }
    const listItemMatch = line.match(/^[ \t]*-[ \t]*(.+?)\s*$/);
    if (listItemMatch == null) continue;
    const raw = listItemMatch[1]?.trim() ?? '';
    if (raw.length === 0) continue;
    if (raw.startsWith('\'') && raw.endsWith('\'') && raw.length >= 2) {
      const singleQuoted = raw.slice(1, -1).trim();
      if (singleQuoted.length > 0) {
        result.push(singleQuoted);
        continue;
      }
    }
    if (raw.startsWith('"')) {
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed === 'string' && parsed.trim().length > 0) {
          result.push(parsed.trim());
          continue;
        }
      } catch {
        // Keep raw fallback.
      }
    }
    result.push(raw);
  }
  return result;
}

function parseRssFeedUrlsFromFrontmatter(frontmatter: string): string[] {
  const rawValue = parseFrontmatterStringValue(frontmatter, 'rssFeedUrl');
  const urls: string[] = [];
  if (typeof rawValue === 'string') {
    const value = rawValue.trim();
    if (value.length > 0) urls.push(value);
  }
  if (Array.isArray(rawValue)) {
    for (const candidate of rawValue) {
      if (typeof candidate !== 'string') continue;
      const value = candidate.trim();
      if (value.length > 0) urls.push(value);
    }
  }
  urls.push(...parseYamlListItems(frontmatter, 'rssFeedUrl'));
  return [...new Set(urls)];
}

function parseLastFetchedAt(frontmatter: string): Date | null {
  const match = frontmatter.match(
    /^[ \t]*rssFetchedAt[ \t]*:[ \t]*([^\r\n]+)[ \t]*$/m,
  );
  if (match == null) return null;
  const rawValue = match[1].trim();
  if (rawValue.length === 0) return null;
  let candidate = rawValue;
  try {
    if (rawValue.startsWith('"')) {
      const parsed = JSON.parse(rawValue);
      if (typeof parsed === 'string') candidate = parsed;
    }
  } catch {
    // Keep raw fallback.
  }
  const ts = Date.parse(candidate);
  if (!Number.isFinite(ts)) return null;
  return new Date(ts);
}

function parsePositiveIntOrDefault(value: unknown, fallback: number, min: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.floor(value));
}

function extractFrontmatterInner(content: string): string {
  const {frontmatter} = splitYamlFrontmatter(content);
  if (frontmatter == null) return '';
  return frontmatter.replace(/^---[ \t]*\n?/, '').replace(/\n?---[ \t]*$/, '');
}

// --- Public: settings and cooldown ---

export function parsePodcastRssSettingsFromContent(
  fileContent: string,
): PodcastRssSettings | null {
  const inner = extractFrontmatterInner(fileContent);
  const rssFeedUrls = parseRssFeedUrlsFromFrontmatter(inner).filter(candidate => {
    try {
      new URL(candidate);
      return true;
    } catch {
      return false;
    }
  });
  const rssFeedUrl = rssFeedUrls[0];
  if (rssFeedUrl == null) return null;
  const daysAgo = parsePositiveIntOrDefault(
    parseFrontmatterStringValue(inner, 'daysAgo'),
    DEFAULT_DAYS_AGO,
    0,
  );
  const timeoutMs = parsePositiveIntOrDefault(
    parseFrontmatterStringValue(inner, 'timeoutMs'),
    DEFAULT_TIMEOUT_MS,
    500,
  );
  const minFetchIntervalMinutes = parsePositiveIntOrDefault(
    parseFrontmatterStringValue(inner, 'minFetchIntervalMinutes'),
    DEFAULT_MIN_FETCH_INTERVAL_MINUTES,
    0,
  );
  return {rssFeedUrl, rssFeedUrls, daysAgo, timeoutMs, minFetchIntervalMinutes};
}

export function parsePodcastRssFetchedAtFromContent(fileContent: string): Date | null {
  return parseLastFetchedAt(extractFrontmatterInner(fileContent));
}

export function shouldSkipRssFetch(
  lastFetchedAt: Date | null,
  now: Date,
  minIntervalMinutes: number,
): boolean {
  if (lastFetchedAt == null || minIntervalMinutes <= 0) return false;
  return now.getTime() - lastFetchedAt.getTime() < minIntervalMinutes * 60_000;
}

// --- RSS/Atom parsing ---

function textValue(input: unknown): string | null {
  if (typeof input === 'string') {
    const cleaned = input.trim();
    return cleaned.length > 0 ? cleaned : null;
  }
  if (typeof input === 'number') return String(input);
  if (input != null && typeof input === 'object') {
    const maybe = input as {'#text'?: unknown; __cdata?: unknown};
    return textValue(maybe['#text']) ?? textValue(maybe.__cdata);
  }
  return null;
}

function firstNonNull(values: unknown[]): string | null {
  for (const v of values) {
    const s = textValue(v);
    if (s != null) return s;
  }
  return null;
}

function toValidUrl(candidate: string | null): string | null {
  if (candidate == null) return null;
  try {
    return new URL(candidate.trim()).toString();
  } catch {
    return null;
  }
}

function isLikelyAudioUrl(url: string | null): boolean {
  if (url == null) return false;
  try {
    return /\.(mp3|m4a|aac|ogg|opus|wav|flac)(?:$)/.test(
      new URL(url).pathname.toLowerCase(),
    );
  } catch {
    return false;
  }
}

function normalizeTitleWebUrl(
  webUrl: string | null,
  audioUrl: string | null,
): string | null {
  if (webUrl == null) return null;
  try {
    if (new URL(webUrl).protocol !== 'https:') return null;
  } catch {
    return null;
  }
  if (isLikelyAudioUrl(webUrl)) return null;
  if (audioUrl != null && webUrl === audioUrl) return null;
  return webUrl;
}

function parseDateOrNull(candidate: string | null): Date | null {
  if (candidate == null) return null;
  const ts = Date.parse(candidate);
  if (!Number.isFinite(ts)) return null;
  return new Date(ts);
}

function normalizeTitle(title: string | null): string {
  if (title == null) return DEFAULT_TITLE_FALLBACK;
  const clean = title.replace(/\s+/g, ' ').trim();
  return clean.length > 0 ? clean : DEFAULT_TITLE_FALLBACK;
}

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function extractRssItems(parsed: Record<string, unknown>): PodcastRssSyncEpisode[] {
  const channel = (parsed.rss as {channel?: unknown} | undefined)?.channel as
    | {item?: unknown}
    | undefined;
  if (channel == null) return [];
  const episodes: PodcastRssSyncEpisode[] = [];
  for (const item of asArray(channel.item)) {
    if (item == null || typeof item !== 'object') continue;
    const entry = item as Record<string, unknown>;
    const title = normalizeTitle(
      firstNonNull([entry.title, entry['itunes:title'], entry['media:title']]),
    );
    const rawWebUrl = toValidUrl(
      firstNonNull([
        entry.link,
        (entry.guid as {'#text'?: unknown} | undefined)?.['#text'],
      ]),
    );
    const mediaContent = asArray(entry['media:content']).find(
      v => toValidUrl((v as {'@_url'?: unknown} | undefined)?.['@_url'] as string | null) != null,
    ) as {'@_url'?: unknown} | undefined;
    const audioUrl = toValidUrl(
      firstNonNull([
        (entry.enclosure as {'@_url'?: unknown} | undefined)?.['@_url'],
        mediaContent?.['@_url'],
      ]),
    );
    const webUrl = normalizeTitleWebUrl(rawWebUrl, audioUrl);
    const publishedAt = parseDateOrNull(
      firstNonNull([entry.pubDate, entry.published, entry.updated, entry['dc:date']]),
    );
    if (publishedAt == null) continue;
    const dedupeKey =
      firstNonNull([entry.guid, entry.link, entry.title, entry['itunes:title']]) ??
      `${publishedAt.toISOString()}|${title}`;
    episodes.push({publishedAt, title, webUrl, audioUrl, dedupeKey});
  }
  return episodes;
}

function extractAtomEntries(parsed: Record<string, unknown>): PodcastRssSyncEpisode[] {
  const feed = parsed.feed as {entry?: unknown} | undefined;
  if (feed == null) return [];
  const episodes: PodcastRssSyncEpisode[] = [];
  for (const entryRaw of asArray(feed.entry)) {
    if (entryRaw == null || typeof entryRaw !== 'object') continue;
    const entry = entryRaw as Record<string, unknown>;
    const title = normalizeTitle(
      firstNonNull([entry.title, entry['itunes:title'], entry['media:title']]),
    );
    const links = asArray(entry.link).map(l => (l ?? {}) as Record<string, unknown>);
    const rawWebUrl = toValidUrl(
      firstNonNull(
        links
          .filter(l => {
            const rel = textValue(l['@_rel']);
            return rel == null || rel === 'alternate';
          })
          .map(l => l['@_href'])
          .concat(
            links
              .filter(l => textValue(l['@_rel']) !== 'enclosure')
              .map(l => l['@_href']),
          ),
      ),
    );
    const audioUrl = toValidUrl(
      firstNonNull(
        links
          .filter(l => {
            const rel = textValue(l['@_rel']);
            const type = textValue(l['@_type']);
            return rel === 'enclosure' || (type != null && type.startsWith('audio/'));
          })
          .map(l => l['@_href'])
          .concat(
            (entry['media:content'] as {'@_url'?: unknown} | undefined)?.['@_url'] ?? [],
          ),
      ),
    );
    const webUrl = normalizeTitleWebUrl(rawWebUrl, audioUrl);
    const publishedAt = parseDateOrNull(
      firstNonNull([entry.published, entry.updated, entry.pubDate, entry['dc:date']]),
    );
    if (publishedAt == null) continue;
    const dedupeKey =
      firstNonNull([entry.id, webUrl, audioUrl, title]) ??
      `${publishedAt.toISOString()}|${title}`;
    episodes.push({publishedAt, title, webUrl, audioUrl, dedupeKey});
  }
  return episodes;
}

export function parsePodcastEpisodesFromRss(xmlText: string): PodcastRssSyncEpisode[] {
  const parser = new XMLParser({ignoreAttributes: false, trimValues: true});
  const parsed = parser.parse(xmlText) as Record<string, unknown>;
  const all = [...extractRssItems(parsed), ...extractAtomEntries(parsed)];
  const deduped = new Map<string, PodcastRssSyncEpisode>();
  for (const ep of all) {
    if (!deduped.has(ep.dedupeKey)) deduped.set(ep.dedupeKey, ep);
  }
  return [...deduped.values()].sort((a, b) => {
    const diff = b.publishedAt.getTime() - a.publishedAt.getTime();
    return diff !== 0 ? diff : a.title.localeCompare(b.title);
  });
}

// --- Markdown rendering ---

function getOrdinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'] as const;
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function endOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

function headingForDate(d: Date): string {
  const weekday = d.toLocaleDateString('en-US', {weekday: 'long'});
  const month = d.toLocaleDateString('en-US', {month: 'long'});
  return `${weekday}, ${month} ${getOrdinal(d.getDate())}, ${d.getFullYear()}`;
}

function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function escapeMarkdownAngleBracketUrl(url: string): string {
  // `[label](<url>)` treats `>` as the destination terminator; encode `<`/`>` so
  // odd RSS values cannot break the link or the rest of the line.
  return url.replace(/</g, '%3C').replace(/>/g, '%3E');
}

export function markdownLink(label: string, url: string): string {
  const safeLabel = label
    .replace(/\\/g, '\\\\')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');
  const safeUrl = escapeMarkdownAngleBracketUrl(url);
  return `[${safeLabel}](<${safeUrl}>)`;
}

function renderEpisodeBullet(ep: PodcastRssSyncEpisode): string {
  const webPart = ep.webUrl == null ? '' : `${markdownLink('🌐', ep.webUrl)} `;
  const audioPart = ep.audioUrl == null ? '' : ` ${markdownLink('▶️', ep.audioUrl)}`;
  return `- ${webPart}${ep.title}${audioPart}`;
}

export function buildPodcastMarkdownFromRss(
  rssText: string | string[],
  now: Date,
  settings: Pick<PodcastRssSettings, 'daysAgo'>,
  noteTitle: string,
): string {
  const fromInclusive = startOfLocalDay(
    new Date(now.getFullYear(), now.getMonth(), now.getDate() - settings.daysAgo),
  );
  const toInclusive = endOfLocalDay(now);
  const rssTexts = Array.isArray(rssText) ? rssText : [rssText];
  const byMergedKey = new Map<string, PodcastRssSyncEpisode>();
  for (const [feedIndex, text] of rssTexts.entries()) {
    const parsed = parsePodcastEpisodesFromRss(text);
    for (const ep of parsed) {
      const publishedAtKey = ep.publishedAt.toISOString();
      const audioKey = ep.audioUrl?.trim().toLowerCase();
      const webKey = ep.webUrl?.trim().toLowerCase();
      const mergedKey =
        audioKey != null && audioKey.length > 0
          ? `audio|${audioKey}|${publishedAtKey}`
          : webKey != null && webKey.length > 0
            ? `web|${webKey}|${publishedAtKey}`
            : `feed|${feedIndex}|${ep.dedupeKey}`;
      if (!byMergedKey.has(mergedKey)) byMergedKey.set(mergedKey, ep);
    }
  }
  const episodes = [...byMergedKey.values()].filter(ep => {
    const ts = ep.publishedAt.getTime();
    return ts >= fromInclusive.getTime() && ts <= toInclusive.getTime();
  }).sort((a, b) => {
    const diff = b.publishedAt.getTime() - a.publishedAt.getTime();
    return diff !== 0 ? diff : a.title.localeCompare(b.title);
  });

  const lines: string[] = [`# ${noteTitle}`];
  if (episodes.length === 0) return `${lines.join('\n')}\n`;

  const byDay = new Map<string, PodcastRssSyncEpisode[]>();
  for (const ep of episodes) {
    const key = localDateKey(ep.publishedAt);
    const dayEps = byDay.get(key) ?? [];
    dayEps.push(ep);
    byDay.set(key, dayEps);
  }

  for (const dayKey of [...byDay.keys()].sort((a, b) => b.localeCompare(a))) {
    const dayEps = byDay.get(dayKey) ?? [];
    const dayDate = dayEps[0]?.publishedAt;
    if (dayDate == null) continue;
    lines.push('', `## ${headingForDate(dayDate)}`, '');
    for (const ep of dayEps) lines.push(renderEpisodeBullet(ep));
  }

  return `${lines.join('\n')}\n`;
}

// --- File content assembly ---

function setFrontmatterKeyInInner(inner: string, key: string, value: string): string {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const lines = inner.split(/\r?\n/);
  const kept = lines.filter(l => !new RegExp(`^[ \\t]*${escapedKey}[ \\t]*:`).test(l));
  const newLine = `${key}: ${JSON.stringify(value)}`;
  return [newLine, ...kept].filter(l => l.trim().length > 0).join('\n');
}

export function buildUpdatedPodcastFileContent(
  originalContent: string,
  newBodyMarkdown: string,
  now: Date,
): string {
  const {frontmatter} = splitYamlFrontmatter(originalContent);
  const inner =
    frontmatter == null
      ? ''
      : frontmatter.replace(/^---[ \t]*\n?/, '').replace(/\n?---[ \t]*$/, '');
  const updatedInner = setFrontmatterKeyInInner(inner, RSS_FETCHED_AT_KEY, now.toISOString());
  const updatedFm = updatedInner.length > 0 ? `---\n${updatedInner}\n---` : '---\n---';
  return `${updatedFm}\n\n${newBodyMarkdown}`;
}

// --- Hub file utilities ---

const PODCAST_STUB_FILE_PATTERN = /^(\d{4})\s+(.+?)\s+-\s+podcasts\.md$/i;
const HUB_TASK_LINE_PATTERN = /^-\s*\[\s*([xX ])\s*\]\s*\[\[([^\]]+)\]\]/;

export function companionHubFileName(podcastsMdName: string): string | null {
  const m = PODCAST_STUB_FILE_PATTERN.exec(podcastsMdName.trim());
  if (!m) return null;
  const section = m[2]?.trim();
  if (!section) return null;
  return `${m[1]} ${section}.md`;
}

export function parseUncheckedHubLinks(hubContent: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of hubContent.split(/\r?\n/)) {
    const m = HUB_TASK_LINE_PATTERN.exec(raw.trim());
    if (!m) continue;
    if (m[1]?.toLowerCase() === 'x') continue;
    const rawTarget = m[2]?.trim() ?? '';
    const pipe = rawTarget.indexOf('|');
    const stem = pipe >= 0 ? rawTarget.slice(0, pipe).trim() : rawTarget;
    const fileName = stem.toLowerCase().endsWith('.md') ? stem : `${stem}.md`;
    if (!seen.has(fileName)) {
      seen.add(fileName);
      result.push(fileName);
    }
  }
  return result;
}

// --- Podcast feed merge ---

type MergeParts = {
  date: string;
  played: boolean;
  title: string;
  mp3Url: string;
  articleUrl: string | null;
  series: string;
  mp3SourceHadAmpEntity: boolean;
};

const MERGE_EP_PREFIX = /^-\s*\[([ xX])\]\s+/;
const MERGE_DATE_PREFIX = /^(\d{4}-\d{2}-\d{2})\s*;\s*(.+)$/;
const MERGE_PLAY_LINK = /\[▶️?\]\(([^)]+)\)/g;
const MERGE_SERIES_TAIL = /\(([^()]+)\)\s*$/;
const MERGE_ARTICLE_LEAD = /^\[🌐\]\(([^)]+)\)\s*/;
const MERGE_PIE_DATE_HEADING = /^##\s+\w+,\s+(\w+)\s+(\d+)(?:st|nd|rd|th)?,\s+(\d{4})$/;
const MERGE_PIE_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const MERGE_PIE_PLAY = /\[▶️?\]\(<?(https?:\/\/[^)>]+)>?\)/g;
const MERGE_PIE_WEB = /^\[🌐\]\(<?(https?:\/\/[^)>]+)>?\)\s*/;

function mergeSanitizeUrl(raw: string): string {
  const t = raw.trim();
  const stripped = t.startsWith('<') && t.endsWith('>') ? t.slice(1, -1) : t;
  return stripped.replace(/&amp;/g, '&');
}

function mergeNormTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function mergeLineKey(parts: MergeParts): string {
  const norm = mergeNormTitle(parts.title);
  return `${parts.date}|${norm.length > 0 ? norm : `_:${parts.title.length}`}`;
}

function parseMergeEpisodeLine(line: string): MergeParts | null {
  const t = line.trim();
  const pm = MERGE_EP_PREFIX.exec(t);
  if (!pm) return null;
  const played = pm[1]?.toLowerCase() === 'x';
  const rest = t.slice(pm[0].length).trim();
  const dm = MERGE_DATE_PREFIX.exec(rest);
  if (!dm) return null;
  const date = dm[1]!;
  const rem = dm[2]!;
  const seriesM = MERGE_SERIES_TAIL.exec(rem);
  if (!seriesM) return null;
  const series = seriesM[1]?.trim();
  if (!series) return null;
  const beforeSeries = rem.slice(0, seriesM.index).trim();
  const plays = Array.from(beforeSeries.matchAll(MERGE_PLAY_LINK));
  const lastPlay = plays.at(-1);
  if (!lastPlay || typeof lastPlay.index !== 'number') return null;
  const rawMp3Url = lastPlay[1] ?? '';
  const mp3Url = mergeSanitizeUrl(rawMp3Url);
  if (!mp3Url) return null;
  const titlePart = beforeSeries.slice(0, lastPlay.index).trim();
  const artM = MERGE_ARTICLE_LEAD.exec(titlePart);
  const articleUrl = artM ? mergeSanitizeUrl(artM[1] ?? '') : null;
  const title = artM ? titlePart.slice(artM[0].length).trim() : titlePart;
  if (!title) return null;
  return {
    date,
    played,
    title,
    mp3Url,
    articleUrl: articleUrl || null,
    series,
    mp3SourceHadAmpEntity: rawMp3Url.includes('&amp;'),
  };
}

function formatMergeLine(parts: MergeParts): string {
  const mark = parts.played ? 'x' : ' ';
  const artPart = parts.articleUrl ? `[🌐](${parts.articleUrl}) ` : '';
  return `- [${mark}] ${parts.date}; ${artPart}${parts.title} [▶️](${parts.mp3Url}) (${parts.series})`;
}

function parsePieBodyDate(line: string): string | null {
  const m = MERGE_PIE_DATE_HEADING.exec(line.trim());
  if (!m) return null;
  const monthIdx = MERGE_PIE_MONTHS.indexOf(m[1]!);
  if (monthIdx === -1) return null;
  return `${m[3]}-${String(monthIdx + 1).padStart(2, '0')}-${m[2]!.padStart(2, '0')}`;
}

type PieBodyEpisode = {date: string; title: string; mp3Url: string; articleUrl?: string};

function parsePieBodyEpisodes(content: string): PieBodyEpisode[] {
  const out: PieBodyEpisode[] = [];
  let currentDate: string | null = null;
  for (const line of content.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    const d = parsePieBodyDate(t);
    if (d != null) {
      currentDate = d;
      continue;
    }
    if (currentDate != null && t.startsWith('- ')) {
      const body = t.slice(2).trim();
      const plays = Array.from(body.matchAll(MERGE_PIE_PLAY));
      const last = plays.at(-1);
      if (!last || typeof last.index !== 'number') continue;
      const mp3Url = mergeSanitizeUrl(last[1] ?? '');
      if (!mp3Url) continue;
      const before = body.slice(0, last.index).trim();
      const artM = MERGE_PIE_WEB.exec(before);
      const articleUrl = artM ? mergeSanitizeUrl(artM[1] ?? '') : undefined;
      const title = artM ? before.slice(artM[0].length).trim() : before;
      if (!title) continue;
      out.push({date: currentDate, title, mp3Url, articleUrl});
    }
  }
  return out;
}

function addToMergeMap(map: Map<string, MergeParts>, incoming: MergeParts): void {
  const key = mergeLineKey(incoming);
  const existing = map.get(key);
  if (existing == null) {
    map.set(key, incoming);
  } else {
    map.set(key, mergePartsPreferringBetterMp3(existing, incoming));
  }
}

function mergePartsPreferringBetterMp3(a: MergeParts, b: MergeParts): MergeParts {
  const played = a.played || b.played;
  const useB = a.mp3SourceHadAmpEntity && !b.mp3SourceHadAmpEntity;
  const base = useB ? b : a;
  const fallback = useB ? a : b;
  return {
    ...base,
    played,
    mp3Url: mergeSanitizeUrl(base.mp3Url),
    articleUrl: base.articleUrl ?? fallback.articleUrl,
    mp3SourceHadAmpEntity: base.mp3Url.includes('&amp;'),
  };
}

export function mergePodcastsFeedContent(
  existing: string,
  pieFiles: Array<{series: string; content: string}>,
  today: Date,
): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const dateKey = (d: Date) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const todayKey = dateKey(today);
  const yesterdayKey = dateKey(
    new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1),
  );
  const weekAgoKey = dateKey(
    new Date(today.getFullYear(), today.getMonth(), today.getDate() - 7),
  );

  // Collect new episodes from pie bodies (today/yesterday only).
  const pieCandidates: MergeParts[] = [];
  for (const {series, content} of pieFiles) {
    const h1 = content.match(/^#(?!#)\s+(.+?)\s*$/m)?.[1]?.trim();
    const resolvedSeries = h1?.length ? h1 : series;
    for (const ep of parsePieBodyEpisodes(content)) {
      if (ep.date !== todayKey && ep.date !== yesterdayKey) continue;
      pieCandidates.push({
        date: ep.date,
        played: false,
        title: ep.title,
        mp3Url: ep.mp3Url,
        articleUrl: ep.articleUrl ?? null,
        series: resolvedSeries,
        mp3SourceHadAmpEntity: ep.mp3Url.includes('&amp;'),
      });
    }
  }

  // Separate prefix lines from episode lines.
  const lines = existing.split('\n');
  const prefixLines: string[] = [];
  let hitEpisodes = false;
  const existingEpLines: string[] = [];
  for (const ln of lines) {
    if (parseMergeEpisodeLine(ln) != null) {
      hitEpisodes = true;
      existingEpLines.push(ln);
    } else if (!hitEpisodes) {
      prefixLines.push(ln);
    }
  }

  // Build kept map from existing episodes.
  const kept = new Map<string, MergeParts>();
  for (const ln of existingEpLines) {
    const parts = parseMergeEpisodeLine(ln);
    if (!parts) continue;
    if (parts.date < weekAgoKey) continue;
    if (parts.date < yesterdayKey) {
      if (!parts.played) addToMergeMap(kept, parts);
      continue;
    }
    addToMergeMap(kept, parts);
  }
  for (const cand of pieCandidates) {
    addToMergeMap(kept, cand);
  }

  const sorted = [...kept.values()].sort((a, b) => {
    const d = b.date.localeCompare(a.date);
    return d !== 0 ? d : a.mp3Url.toLowerCase().localeCompare(b.mp3Url.toLowerCase());
  });

  // Trim trailing blank lines from prefix.
  while (prefixLines.length > 0 && prefixLines.at(-1)!.trim() === '') prefixLines.pop();

  const out = [...prefixLines];
  if (out.length > 0 && out.at(-1)!.trim() !== '' && sorted.length > 0) out.push('');
  for (const row of sorted) out.push(formatMergeLine(row));
  return `${out.join('\n').trimEnd()}\n`;
}

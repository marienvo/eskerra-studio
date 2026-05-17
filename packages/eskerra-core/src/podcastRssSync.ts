import {XMLParser} from 'fast-xml-parser';

import {splitYamlFrontmatter} from './markdown/splitYamlFrontmatter';
import {
  findFirstYamlScalarLineRaw,
  parseYamlListItemsForKey,
  parseYamlScalarValue,
  setYamlInnerScalarKey,
  stripYamlFrontmatterOuterFences,
} from './podcastRssSyncYaml';
import {
  isAsciiWhitespaceCode,
  isFourDigitYearString,
  isIso8601DateOnlyString,
  mergeAmpEntitiesToAmpersand,
  collapseAsciiWhitespaceRunsToSpace,
  parseTaskCheckboxMarkAfterOpenBracket,
  toAsciiLowercase,
  trimAsciiWhitespace,
  trimEndAsciiWhitespace,
} from './stringScanners';
import {scanPlayTriangleMarkdownLinks} from './podcasts/playMarkdownLinkScan';

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
  if (trimAsciiWhitespace(frontmatter).length === 0) {
    return undefined;
  }
  const rawLine = findFirstYamlScalarLineRaw(frontmatter, key);
  if (rawLine == null) {
    return undefined;
  }
  return parseYamlScalarValue(rawLine);
}

function parseRssFeedUrlsFromFrontmatter(frontmatter: string): string[] {
  const rawValue = parseFrontmatterStringValue(frontmatter, 'rssFeedUrl');
  const urls: string[] = [];
  if (typeof rawValue === 'string') {
    const value = rawValue.trim();
    if (value.length > 0) {
      urls.push(value);
    }
  }
  if (Array.isArray(rawValue)) {
    for (const candidate of rawValue) {
      if (typeof candidate !== 'string') {
        continue;
      }
      const value = candidate.trim();
      if (value.length > 0) {
        urls.push(value);
      }
    }
  }
  urls.push(...parseYamlListItemsForKey(frontmatter, 'rssFeedUrl'));
  return [...new Set(urls)];
}

function parseLastFetchedAt(frontmatter: string): Date | null {
  const rawValue = findFirstYamlScalarLineRaw(frontmatter, 'rssFetchedAt');
  if (rawValue == null || rawValue.length === 0) {
    return null;
  }
  let candidate = rawValue;
  try {
    if (rawValue.startsWith('"')) {
      const parsed = JSON.parse(rawValue);
      if (typeof parsed === 'string') {
        candidate = parsed;
      }
    }
  } catch {
    // Keep raw fallback.
  }
  const ts = Date.parse(candidate);
  if (!Number.isFinite(ts)) {
    return null;
  }
  return new Date(ts);
}

function parsePositiveIntOrDefault(value: unknown, fallback: number, min: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.floor(value));
}

function extractFrontmatterInner(content: string): string {
  const {frontmatter} = splitYamlFrontmatter(content);
  if (frontmatter == null) {
    return '';
  }
  return stripYamlFrontmatterOuterFences(frontmatter);
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

const AUDIO_FILE_EXTENSIONS = ['.mp3', '.m4a', '.aac', '.ogg', '.opus', '.wav', '.flac'];

function pathnameEndsWithAudioExtension(pathnameLower: string): boolean {
  for (const ext of AUDIO_FILE_EXTENSIONS) {
    if (pathnameLower.endsWith(ext)) {
      return true;
    }
  }
  return false;
}

function isLikelyAudioUrl(url: string | null): boolean {
  if (url == null) {
    return false;
  }
  try {
    return pathnameEndsWithAudioExtension(new URL(url).pathname.toLowerCase());
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
  if (title == null) {
    return DEFAULT_TITLE_FALLBACK;
  }
  const clean = trimAsciiWhitespace(collapseAsciiWhitespaceRunsToSpace(title));
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
  return setYamlInnerScalarKey(inner, key, value);
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
      : stripYamlFrontmatterOuterFences(frontmatter);
  const updatedInner = setFrontmatterKeyInInner(inner, RSS_FETCHED_AT_KEY, now.toISOString());
  const updatedFm = updatedInner.length > 0 ? `---\n${updatedInner}\n---` : '---\n---';
  return `${updatedFm}\n\n${newBodyMarkdown}`;
}

// --- Hub file utilities ---

export function companionHubFileName(podcastsMdName: string): string | null {
  const trimmed = trimAsciiWhitespace(podcastsMdName);
  const lower = trimmed.toLowerCase();
  const suf = 'podcasts.md';
  if (!lower.endsWith(suf)) {
    return null;
  }
  const head = trimEndAsciiWhitespace(trimmed.slice(0, trimmed.length - suf.length));
  let i = head.length - 1;
  while (i >= 0 && isAsciiWhitespaceCode(head.charCodeAt(i))) {
    i--;
  }
  if (i < 0 || head.charAt(i) !== '-') {
    return null;
  }
  i--;
  while (i >= 0 && isAsciiWhitespaceCode(head.charCodeAt(i))) {
    i--;
  }
  if (i < 3) {
    return null;
  }
  const yearStr = head.slice(0, 4);
  if (!isFourDigitYearString(yearStr)) {
    return null;
  }
  if (head.charCodeAt(4) !== 32 && head.charCodeAt(4) !== 9) {
    return null;
  }
  const section = trimAsciiWhitespace(head.slice(5, i + 1));
  if (!section) {
    return null;
  }
  return `${yearStr} ${section}.md`;
}

function parseUncheckedHubTaskLine(trimmed: string): {checked: boolean; wikiInner: string} | null {
  if (trimmed.length < 7 || trimmed[0] !== '-') {
    return null;
  }
  let p = 1;
  while (p < trimmed.length && isAsciiWhitespaceCode(trimmed.charCodeAt(p))) {
    p++;
  }
  if (p >= trimmed.length || trimmed[p] !== '[') {
    return null;
  }
  p++;
  const cb = parseTaskCheckboxMarkAfterOpenBracket(trimmed, p);
  if (cb == null) {
    return null;
  }
  p = cb.indexAfterCheckboxBody;
  while (p < trimmed.length && isAsciiWhitespaceCode(trimmed.charCodeAt(p))) {
    p++;
  }
  if (p >= trimmed.length || trimmed[p] !== ']') {
    return null;
  }
  p++;
  while (p < trimmed.length && isAsciiWhitespaceCode(trimmed.charCodeAt(p))) {
    p++;
  }
  if (p + 2 >= trimmed.length || trimmed[p] !== '[' || trimmed[p + 1] !== '[') {
    return null;
  }
  const innerStart = p + 2;
  let q = innerStart;
  while (q < trimmed.length) {
    const ch = trimmed.charCodeAt(q);
    if (ch === 93) {
      // `]` — only valid as the first half of closing `]]`.
      if (q + 1 < trimmed.length && trimmed.charCodeAt(q + 1) === 93) {
        break;
      }
      return null;
    }
    if (ch === 91) {
      return null;
    }
    q++;
  }
  if (q >= trimmed.length || trimmed.charCodeAt(q) !== 93) {
    return null;
  }
  const close = q;
  if (close === innerStart) {
    return null;
  }
  return {checked: cb.checked, wikiInner: trimmed.slice(innerStart, close)};
}

export function parseUncheckedHubLinks(hubContent: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of hubContent.split(/\r?\n/)) {
    const m = parseUncheckedHubTaskLine(trimAsciiWhitespace(raw));
    if (!m) {
      continue;
    }
    if (m.checked) {
      continue;
    }
    const rawTarget = trimAsciiWhitespace(m.wikiInner);
    const pipe = rawTarget.indexOf('|');
    const stem = pipe >= 0 ? trimAsciiWhitespace(rawTarget.slice(0, pipe)) : rawTarget;
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

const MERGE_PIE_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const MERGE_ARTICLE_OPEN = '[🌐](';

function mergeSanitizeUrl(raw: string): string {
  const t = trimAsciiWhitespace(raw);
  const stripped = t.startsWith('<') && t.endsWith('>') ? t.slice(1, -1) : t;
  return mergeAmpEntitiesToAmpersand(trimAsciiWhitespace(stripped));
}

function mergeNormTitle(title: string): string {
  const t = toAsciiLowercase(title);
  let out = '';
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    if ((c >= 48 && c <= 57) || (c >= 97 && c <= 122)) {
      out += t[i]!;
    }
  }
  return out;
}

function mergeLineKey(parts: MergeParts): string {
  const norm = mergeNormTitle(parts.title);
  return `${parts.date}|${norm.length > 0 ? norm : `_:${parts.title.length}`}`;
}

function parseMergeEpisodePrefix(trimmed: string): {played: boolean; rest: string} | null {
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

function parseMergeDatePrefix(rest: string): {date: string; remainder: string} | null {
  const sep = rest.indexOf(';');
  if (sep < 0) {
    return null;
  }
  const date = trimAsciiWhitespace(rest.slice(0, sep));
  if (!isIso8601DateOnlyString(date)) {
    return null;
  }
  const remainder = trimAsciiWhitespace(rest.slice(sep + 1));
  if (!remainder) {
    return null;
  }
  return {date, remainder};
}

function parseMergeSeriesTail(rem: string): {series: string; openIdx: number} | null {
  const endTrim = trimEndAsciiWhitespace(rem);
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
  const series = trimAsciiWhitespace(inner);
  if (!series) {
    return null;
  }
  return {series, openIdx: lastOpen};
}

function tryParseMergeArticleLead(titlePart: string): {url: string; len: number} | null {
  if (!titlePart.startsWith(MERGE_ARTICLE_OPEN)) {
    return null;
  }
  let q = MERGE_ARTICLE_OPEN.length;
  while (q < titlePart.length) {
    const c = titlePart[q]!;
    if (c === '\\' && q + 1 < titlePart.length) {
      q += 2;
      continue;
    }
    if (c === ')') {
      let u = trimAsciiWhitespace(titlePart.slice(MERGE_ARTICLE_OPEN.length, q));
      if (u.startsWith('<') && u.endsWith('>')) {
        u = trimAsciiWhitespace(u.slice(1, -1));
      }
      let tail = q + 1;
      while (tail < titlePart.length && isAsciiWhitespaceCode(titlePart.charCodeAt(tail))) {
        tail++;
      }
      return {url: u, len: tail};
    }
    q++;
  }
  return null;
}

function parseMergeEpisodeLine(line: string): MergeParts | null {
  const t = trimAsciiWhitespace(line);
  const pm = parseMergeEpisodePrefix(t);
  if (!pm) {
    return null;
  }
  const played = pm.played;
  const rest = trimAsciiWhitespace(pm.rest);
  const dm = parseMergeDatePrefix(rest);
  if (!dm) {
    return null;
  }
  const {date, remainder: rem} = dm;
  const seriesM = parseMergeSeriesTail(rem);
  if (!seriesM) {
    return null;
  }
  const {series, openIdx} = seriesM;
  const beforeSeries = trimAsciiWhitespace(trimEndAsciiWhitespace(rem.slice(0, openIdx)));
  const plays = scanPlayTriangleMarkdownLinks(beforeSeries);
  const lastPlay = plays.at(-1);
  if (!lastPlay) {
    return null;
  }
  const rawMp3Url = lastPlay.url;
  const mp3Url = mergeSanitizeUrl(rawMp3Url);
  if (!mp3Url) {
    return null;
  }
  const titlePart = trimAsciiWhitespace(beforeSeries.slice(0, lastPlay.start));
  const art = tryParseMergeArticleLead(titlePart);
  const articleUrl = art ? mergeSanitizeUrl(art.url) : null;
  const title = art ? trimAsciiWhitespace(titlePart.slice(art.len)) : titlePart;
  if (!title) {
    return null;
  }
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

function parseOrdinalDayToken(tok: string): number | null {
  const lower = tok.toLowerCase();
  const suf = ['st', 'nd', 'rd', 'th'];
  for (const s of suf) {
    if (lower.endsWith(s)) {
      const n = Number(lower.slice(0, -s.length));
      return Number.isFinite(n) ? n : null;
    }
  }
  const n = Number(tok);
  return Number.isFinite(n) ? n : null;
}

function parsePieBodyDate(line: string): string | null {
  const t = trimAsciiWhitespace(line);
  if (!/^##\s+/.test(t)) {
    return null;
  }
  const rest = trimAsciiWhitespace(t.replace(/^##\s+/, ''));
  const commaAfterWeekday = rest.indexOf(',');
  if (commaAfterWeekday < 0) {
    return null;
  }
  const afterWeekday = trimAsciiWhitespace(rest.slice(commaAfterWeekday + 1));
  const lastComma = afterWeekday.lastIndexOf(',');
  if (lastComma < 0) {
    return null;
  }
  const yearStr = trimAsciiWhitespace(afterWeekday.slice(lastComma + 1));
  const monthAndDay = trimEndAsciiWhitespace(afterWeekday.slice(0, lastComma));
  const sp = monthAndDay.lastIndexOf(' ');
  if (sp < 0) {
    return null;
  }
  const monthName = trimAsciiWhitespace(monthAndDay.slice(0, sp));
  const dayTok = trimAsciiWhitespace(monthAndDay.slice(sp + 1));
  const monthIdx = MERGE_PIE_MONTHS.indexOf(monthName);
  if (monthIdx === -1) {
    return null;
  }
  const dayNum = parseOrdinalDayToken(dayTok);
  if (dayNum == null || !isFourDigitYearString(yearStr)) {
    return null;
  }
  return `${yearStr}-${String(monthIdx + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
}

type PieBodyEpisode = {date: string; title: string; mp3Url: string; articleUrl?: string};

function isHttpsUrl(u: string): boolean {
  const x = u.toLowerCase();
  return x.startsWith('https://') || x.startsWith('http://');
}

function scanPieHttpsPlayLinks(body: string): Array<{url: string; start: number}> {
  const all = scanPlayTriangleMarkdownLinks(body);
  const out: Array<{url: string; start: number}> = [];
  for (const m of all) {
    let u = trimAsciiWhitespace(m.url);
    if (u.startsWith('<') && u.endsWith('>')) {
      u = trimAsciiWhitespace(u.slice(1, -1));
    }
    if (isHttpsUrl(u)) {
      out.push(m);
    }
  }
  return out;
}

function tryParsePieArticleLead(before: string): {url: string; len: number} | null {
  if (!before.startsWith(MERGE_ARTICLE_OPEN)) {
    return null;
  }
  let q = MERGE_ARTICLE_OPEN.length;
  while (q < before.length) {
    const c = before[q]!;
    if (c === '\\' && q + 1 < before.length) {
      q += 2;
      continue;
    }
    if (c === ')') {
      let u = trimAsciiWhitespace(before.slice(MERGE_ARTICLE_OPEN.length, q));
      if (u.startsWith('<') && u.endsWith('>')) {
        u = trimAsciiWhitespace(u.slice(1, -1));
      }
      if (!isHttpsUrl(u)) {
        return null;
      }
      let tail = q + 1;
      while (tail < before.length && isAsciiWhitespaceCode(before.charCodeAt(tail))) {
        tail++;
      }
      return {url: u, len: tail};
    }
    q++;
  }
  return null;
}

function parsePieBodyEpisodes(content: string): PieBodyEpisode[] {
  const out: PieBodyEpisode[] = [];
  let currentDate: string | null = null;
  for (const line of content.split(/\r?\n/)) {
    const t = trimAsciiWhitespace(line);
    if (!t) {
      continue;
    }
    const d = parsePieBodyDate(t);
    if (d != null) {
      currentDate = d;
      continue;
    }
    if (currentDate != null && t.startsWith('- ')) {
      const body = trimAsciiWhitespace(t.slice(2));
      const plays = scanPieHttpsPlayLinks(body);
      const last = plays.at(-1);
      if (!last) {
        continue;
      }
      const mp3Url = mergeSanitizeUrl(last.url);
      if (!mp3Url) {
        continue;
      }
      const before = trimAsciiWhitespace(body.slice(0, last.start));
      const artM = tryParsePieArticleLead(before);
      const articleUrl = artM ? mergeSanitizeUrl(artM.url) : undefined;
      const title = artM ? trimAsciiWhitespace(before.slice(artM.len)) : before;
      if (!title) {
        continue;
      }
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

/** First ATX `# ` heading (not `##`), matching prior `/^#(?!#)\\s+...$/m` behavior. */
function extractFirstMarkdownAtxH1Title(content: string): string | null {
  for (const raw of content.split(/\r?\n/)) {
    if (raw.length < 3) {
      continue;
    }
    if (raw.charCodeAt(0) !== 35) {
      continue;
    }
    if (raw.charCodeAt(1) === 35) {
      continue;
    }
    let i = 1;
    if (i >= raw.length || !isAsciiWhitespaceCode(raw.charCodeAt(i))) {
      continue;
    }
    while (i < raw.length && isAsciiWhitespaceCode(raw.charCodeAt(i))) {
      i++;
    }
    const title = trimAsciiWhitespace(raw.slice(i));
    if (!title) {
      continue;
    }
    return title;
  }
  return null;
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
    const h1 = extractFirstMarkdownAtxH1Title(content);
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

import {describe, expect, it} from 'vitest';
import {
  buildPodcastMarkdownFromRss,
  buildUpdatedPodcastFileContent,
  companionHubFileName,
  markdownLink,
  mergePodcastsFeedContent,
  parsePodcastEpisodesFromRss,
  parsePodcastRssFetchedAtFromContent,
  parsePodcastRssSettingsFromContent,
  parseUncheckedHubLinks,
  shouldSkipRssFetch,
} from './podcastRssSync';

// --- markdownLink ---

describe('markdownLink', () => {
  it('wraps label and URL in angle-bracket link form', () => {
    expect(markdownLink('🌐', 'https://example.com/a')).toBe('[🌐](<https://example.com/a>)');
  });

  it('escapes brackets in the label so they do not break the link text', () => {
    expect(markdownLink('a[b]c', 'https://example.com/u')).toBe('[a\\[b\\]c](<https://example.com/u>)');
  });

  it('escapes backslashes before brackets so injected escapes stay literal', () => {
    expect(markdownLink(String.raw`a\b[c`, 'https://example.com/u')).toBe(
      '[a\\\\b\\[c](<https://example.com/u>)',
    );
  });

  it('handles a label that mixes backslashes and closing brackets', () => {
    expect(markdownLink(String.raw`\]`, 'u')).toBe('[\\\\\\]](<u>)');
  });

  it('percent-encodes angle brackets in the URL so they do not break the bracket destination', () => {
    expect(markdownLink('x', 'https://example.com/path?a=b>c')).toBe(
      '[x](<https://example.com/path?a=b%3Ec>)',
    );
    expect(markdownLink('x', 'https://example.com/a<b')).toBe('[x](<https://example.com/a%3Cb>)');
  });
});

// --- parsePodcastRssSettingsFromContent ---

describe('parsePodcastRssSettingsFromContent', () => {
  it('returns null when no rssFeedUrl', () => {
    expect(parsePodcastRssSettingsFromContent('---\ntitle: My pod\n---\n\n# Body')).toBeNull();
  });

  it('returns null for invalid URL', () => {
    expect(
      parsePodcastRssSettingsFromContent('---\nrssFeedUrl: not-a-url\n---\n'),
    ).toBeNull();
  });

  it('returns null when no frontmatter', () => {
    expect(parsePodcastRssSettingsFromContent('# Title\n')).toBeNull();
  });

  it('parses plain rssFeedUrl', () => {
    const result = parsePodcastRssSettingsFromContent(
      '---\nrssFeedUrl: "https://example.com/feed.xml"\ndaysAgo: 14\ntimeoutMs: 5000\nminFetchIntervalMinutes: 30\n---\n',
    );
    expect(result).toEqual({
      rssFeedUrl: 'https://example.com/feed.xml',
      rssFeedUrls: ['https://example.com/feed.xml'],
      daysAgo: 14,
      timeoutMs: 5000,
      minFetchIntervalMinutes: 30,
    });
  });

  it('accepts single-quoted scalar rssFeedUrl', () => {
    const result = parsePodcastRssSettingsFromContent(
      '---\nrssFeedUrl: \'https://example.com/feed.xml\'\n---\n',
    );
    expect(result?.rssFeedUrl).toBe('https://example.com/feed.xml');
    expect(result?.rssFeedUrls).toEqual(['https://example.com/feed.xml']);
  });

  it('uses defaults when optional keys are absent', () => {
    const result = parsePodcastRssSettingsFromContent(
      '---\nrssFeedUrl: "https://example.com/feed.xml"\n---\n',
    );
    expect(result).toEqual({
      rssFeedUrl: 'https://example.com/feed.xml',
      rssFeedUrls: ['https://example.com/feed.xml'],
      daysAgo: 7,
      timeoutMs: 8000,
      minFetchIntervalMinutes: 0,
    });
  });

  it('accepts rssFeedUrl as YAML list', () => {
    const result = parsePodcastRssSettingsFromContent(
      '---\nrssFeedUrl:\n  - https://example.com/feed-a.xml\n  - https://example.com/feed-b.xml\n---\n',
    );
    expect(result?.rssFeedUrl).toBe('https://example.com/feed-a.xml');
    expect(result?.rssFeedUrls).toEqual([
      'https://example.com/feed-a.xml',
      'https://example.com/feed-b.xml',
    ]);
  });

  it('keeps valid list URLs when one candidate is invalid', () => {
    const result = parsePodcastRssSettingsFromContent(
      '---\nrssFeedUrl:\n  - not-a-url\n  - https://example.com/feed.xml\n---\n',
    );
    expect(result?.rssFeedUrls).toEqual(['https://example.com/feed.xml']);
  });

  it('accepts single-quoted entries in rssFeedUrl YAML list', () => {
    const result = parsePodcastRssSettingsFromContent(
      '---\nrssFeedUrl:\n  - \'https://example.com/feed-a.xml\'\n  - \'https://example.com/feed-b.xml\'\n---\n',
    );
    expect(result?.rssFeedUrls).toEqual([
      'https://example.com/feed-a.xml',
      'https://example.com/feed-b.xml',
    ]);
  });
});

// --- parsePodcastRssFetchedAtFromContent ---

describe('parsePodcastRssFetchedAtFromContent', () => {
  it('returns null when key is absent', () => {
    expect(
      parsePodcastRssFetchedAtFromContent('---\nrssFeedUrl: "https://x.com/f"\n---\n'),
    ).toBeNull();
  });

  it('parses ISO date string', () => {
    const result = parsePodcastRssFetchedAtFromContent(
      '---\nrssFetchedAt: "2026-02-22T14:00:00.000Z"\n---\n',
    );
    expect(result?.toISOString()).toBe('2026-02-22T14:00:00.000Z');
  });

  it('returns null for invalid date', () => {
    expect(
      parsePodcastRssFetchedAtFromContent('---\nrssFetchedAt: not-a-date\n---\n'),
    ).toBeNull();
  });
});

// --- shouldSkipRssFetch ---

describe('shouldSkipRssFetch', () => {
  const now = new Date('2026-02-22T14:00:00Z');

  it('returns false when lastFetchedAt is null', () => {
    expect(shouldSkipRssFetch(null, now, 15)).toBe(false);
  });

  it('returns false when minIntervalMinutes is 0', () => {
    expect(shouldSkipRssFetch(new Date('2026-02-22T13:59:00Z'), now, 0)).toBe(false);
  });

  it('returns true when within cooldown', () => {
    expect(shouldSkipRssFetch(new Date('2026-02-22T13:50:00Z'), now, 15)).toBe(true);
  });

  it('returns false when cooldown has expired', () => {
    expect(shouldSkipRssFetch(new Date('2026-02-22T13:30:00Z'), now, 15)).toBe(false);
  });
});

// --- parsePodcastEpisodesFromRss ---

describe('parsePodcastEpisodesFromRss', () => {
  it('parses RSS items', () => {
    const xml = [
      '<rss version="2.0"><channel>',
      '<item><guid>ep-1</guid><title>Ep A</title><link>https://example.com/a</link>',
      '<pubDate>Sun, 22 Feb 2026 08:00:00 GMT</pubDate>',
      '<enclosure url="https://cdn.example.com/a.mp3" type="audio/mpeg" /></item>',
      '</channel></rss>',
    ].join('\n');
    const [ep] = parsePodcastEpisodesFromRss(xml);
    expect(ep?.title).toBe('Ep A');
    expect(ep?.webUrl).toBe('https://example.com/a');
    expect(ep?.audioUrl).toBe('https://cdn.example.com/a.mp3');
  });

  it('parses Atom entries', () => {
    const xml = [
      '<feed xmlns="http://www.w3.org/2005/Atom">',
      '<entry><id>atom-1</id><title>Atom ep</title>',
      '<updated>2026-02-22T12:30:00Z</updated>',
      '<link rel="alternate" href="https://example.com/atom" />',
      '<link rel="enclosure" type="audio/mpeg" href="https://cdn.example.com/atom.mp3" />',
      '</entry></feed>',
    ].join('\n');
    const [ep] = parsePodcastEpisodesFromRss(xml);
    expect(ep?.title).toBe('Atom ep');
    expect(ep?.audioUrl).toBe('https://cdn.example.com/atom.mp3');
  });

  it('deduplicates by guid', () => {
    const xml = [
      '<rss version="2.0"><channel>',
      '<item><guid>dup</guid><title>A</title><pubDate>Sun, 22 Feb 2026 08:00:00 GMT</pubDate></item>',
      '<item><guid>dup</guid><title>B</title><pubDate>Sun, 22 Feb 2026 09:00:00 GMT</pubDate></item>',
      '</channel></rss>',
    ].join('\n');
    expect(parsePodcastEpisodesFromRss(xml)).toHaveLength(1);
  });

  it('sorts by publishedAt descending', () => {
    const xml = [
      '<rss version="2.0"><channel>',
      '<item><guid>old</guid><title>Old</title><pubDate>Sat, 21 Feb 2026 08:00:00 GMT</pubDate></item>',
      '<item><guid>new</guid><title>New</title><pubDate>Sun, 22 Feb 2026 08:00:00 GMT</pubDate></item>',
      '</channel></rss>',
    ].join('\n');
    const [first, second] = parsePodcastEpisodesFromRss(xml);
    expect(first?.title).toBe('New');
    expect(second?.title).toBe('Old');
  });
});

// --- buildPodcastMarkdownFromRss ---

describe('buildPodcastMarkdownFromRss', () => {
  it('renders RSS episodes grouped by date with globe and audio links', () => {
    const now = new Date('2026-02-22T14:00:00Z');
    const rss = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<rss version="2.0"><channel><title>OVT</title>',
      '<item><guid>ep-1</guid><title>Episode A</title>',
      '<link>https://example.com/ep-a</link>',
      '<pubDate>Sun, 22 Feb 2026 08:00:00 GMT</pubDate>',
      '<enclosure url="https://cdn.example.com/ep-a.mp3" type="audio/mpeg" /></item>',
      '<item><guid>ep-2</guid><title>Episode B</title>',
      '<link>https://example.com/ep-b</link>',
      '<pubDate>Sat, 21 Feb 2026 11:00:00 GMT</pubDate></item>',
      '<item><guid>ep-3</guid><title>Episode C</title>',
      '<pubDate>Fri, 20 Feb 2026 09:00:00 GMT</pubDate>',
      '<enclosure url="https://cdn.example.com/ep-c.mp3" type="audio/mpeg" /></item>',
      '<item><guid>ep-old</guid><title>Too old</title>',
      '<pubDate>Sun, 01 Feb 2026 08:00:00 GMT</pubDate></item>',
      '</channel></rss>',
    ].join('\n');

    const output = buildPodcastMarkdownFromRss(rss, now, {daysAgo: 7}, 'OVT');

    expect(output).toContain('# OVT');
    expect(output).toContain('## Sunday, February 22nd, 2026');
    expect(output).toContain('## Saturday, February 21st, 2026');
    expect(output).toContain('## Friday, February 20th, 2026');
    expect(output.indexOf('## Sunday, February 22nd, 2026')).toBeLessThan(
      output.indexOf('## Saturday, February 21st, 2026'),
    );
    expect(output).toContain(
      '- [🌐](<https://example.com/ep-a>) Episode A [▶️](<https://cdn.example.com/ep-a.mp3>)',
    );
    expect(output).toContain('- [🌐](<https://example.com/ep-b>) Episode B');
    expect(output).toContain('- Episode C [▶️](<https://cdn.example.com/ep-c.mp3>)');
    expect(output).not.toContain('Too old');
  });

  it('supports Atom feeds', () => {
    const now = new Date('2026-02-22T14:00:00Z');
    const atom = [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<feed xmlns="http://www.w3.org/2005/Atom"><title>Podcast feed</title>',
      '<entry><id>atom-1</id><title>Atom episode</title>',
      '<updated>2026-02-22T12:30:00Z</updated>',
      '<link rel="alternate" href="https://example.com/atom-episode" />',
      '<link rel="enclosure" type="audio/mpeg" href="https://cdn.example.com/atom-episode.mp3" />',
      '</entry>',
      '<entry><id>atom-2</id><title>Audio only atom</title>',
      '<published>2026-02-21T12:30:00Z</published>',
      '<link rel="enclosure" type="audio/mpeg" href="https://cdn.example.com/atom-only.mp3" />',
      '</entry></feed>',
    ].join('\n');

    const output = buildPodcastMarkdownFromRss(atom, now, {daysAgo: 7}, 'OVT');

    expect(output).toContain(
      '- [🌐](<https://example.com/atom-episode>) Atom episode [▶️](<https://cdn.example.com/atom-episode.mp3>)',
    );
    expect(output).toContain(
      '- Audio only atom [▶️](<https://cdn.example.com/atom-only.mp3>)',
    );
  });

  it('does not link title when the URL is also an audio file', () => {
    const now = new Date('2026-02-22T14:00:00Z');
    const rss = [
      '<rss version="2.0"><channel>',
      '<item><guid>ep</guid><title>Audio link ep</title>',
      '<link>https://cdn.example.com/ep.mp3</link>',
      '<pubDate>Sun, 22 Feb 2026 08:00:00 GMT</pubDate>',
      '<enclosure url="https://cdn.example.com/ep.mp3" type="audio/mpeg" /></item>',
      '</channel></rss>',
    ].join('\n');
    const output = buildPodcastMarkdownFromRss(rss, now, {daysAgo: 7}, 'OVT');
    expect(output).toContain(
      '- Audio link ep [▶️](<https://cdn.example.com/ep.mp3>)',
    );
    expect(output).not.toContain('[Audio link ep](<https://cdn.example.com/ep.mp3>)');
  });

  it('does not link title for non-https URLs', () => {
    const now = new Date('2026-02-22T14:00:00Z');
    const rss = [
      '<rss version="2.0"><channel>',
      '<item><guid>ep</guid><title>HTTP ep</title>',
      '<link>http://example.com/ep</link>',
      '<pubDate>Sun, 22 Feb 2026 08:00:00 GMT</pubDate></item>',
      '</channel></rss>',
    ].join('\n');
    const output = buildPodcastMarkdownFromRss(rss, now, {daysAgo: 7}, 'OVT');
    expect(output).toContain('- HTTP ep');
    expect(output).not.toContain('[HTTP ep](<http://example.com/ep>)');
  });

  it('renders just the title heading when no episodes fall in the window', () => {
    const now = new Date('2026-02-22T14:00:00Z');
    const rss = [
      '<rss version="2.0"><channel>',
      '<item><guid>ep</guid><title>Old</title>',
      '<pubDate>Mon, 01 Jan 2026 08:00:00 GMT</pubDate></item>',
      '</channel></rss>',
    ].join('\n');
    const output = buildPodcastMarkdownFromRss(rss, now, {daysAgo: 7}, 'My Pod');
    expect(output.trim()).toBe('# My Pod');
  });

  it('keeps episodes from different feeds even when guid values collide', () => {
    const now = new Date('2026-02-22T14:00:00Z');
    const feedA = [
      '<rss version="2.0"><channel>',
      '<item><guid>shared-guid</guid><title>Feed A episode</title>',
      '<pubDate>Sun, 22 Feb 2026 08:00:00 GMT</pubDate>',
      '<enclosure url="https://cdn.example.com/a.mp3" type="audio/mpeg" /></item>',
      '</channel></rss>',
    ].join('\n');
    const feedB = [
      '<rss version="2.0"><channel>',
      '<item><guid>shared-guid</guid><title>Feed B episode</title>',
      '<pubDate>Sun, 22 Feb 2026 08:00:00 GMT</pubDate>',
      '<enclosure url="https://cdn.example.com/b.mp3" type="audio/mpeg" /></item>',
      '</channel></rss>',
    ].join('\n');
    const output = buildPodcastMarkdownFromRss([feedA, feedB], now, {daysAgo: 7}, 'OVT');
    expect(output).toContain('Feed A episode');
    expect(output).toContain('Feed B episode');
    expect((output.match(/\[▶️\]\(<https:\/\/cdn\.example\.com\/[ab]\.mp3>\)/g) ?? []).length).toBe(2);
  });

  it('deduplicates cross-feed episodes with same normalized audio URL and publish timestamp', () => {
    const now = new Date('2026-02-22T14:00:00Z');
    const feedA = [
      '<rss version="2.0"><channel>',
      '<item><guid>shared-guid-a</guid><title>Episode A</title>',
      '<pubDate>Sun, 22 Feb 2026 08:00:00 GMT</pubDate>',
      '<enclosure url="https://cdn.example.com/same.mp3?X=1&Y=2" type="audio/mpeg" /></item>',
      '</channel></rss>',
    ].join('\n');
    const feedB = [
      '<rss version="2.0"><channel>',
      '<item><guid>shared-guid-b</guid><title>Episode B</title>',
      '<pubDate>Sun, 22 Feb 2026 08:00:00 GMT</pubDate>',
      '<enclosure url="https://cdn.example.com/same.mp3?x=1&y=2" type="audio/mpeg" /></item>',
      '</channel></rss>',
    ].join('\n');
    const output = buildPodcastMarkdownFromRss([feedA, feedB], now, {daysAgo: 7}, 'OVT');
    expect((output.match(/https:\/\/cdn\.example\.com\/same\.mp3\?x=1&y=2/gi) ?? []).length).toBe(1);
  });
});

// --- companionHubFileName ---

describe('companionHubFileName', () => {
  it('returns hub filename for a standard podcasts.md name', () => {
    expect(companionHubFileName('2025 Section - podcasts.md')).toBe('2025 Section.md');
  });

  it('handles multi-word section names', () => {
    expect(companionHubFileName('2025 Podcast Hub - podcasts.md')).toBe('2025 Podcast Hub.md');
  });

  it('handles different years', () => {
    expect(companionHubFileName('2024 Morning Mix - podcasts.md')).toBe('2024 Morning Mix.md');
  });

  it('returns null for non-matching filenames', () => {
    expect(companionHubFileName('notes.md')).toBeNull();
    expect(companionHubFileName('📻 OVT.md')).toBeNull();
    expect(companionHubFileName('2025 Section.md')).toBeNull();
  });

  it('is case-insensitive for the podcasts.md suffix', () => {
    expect(companionHubFileName('2025 Section - Podcasts.MD')).toBe('2025 Section.md');
  });
});

// --- parseUncheckedHubLinks ---

describe('parseUncheckedHubLinks', () => {
  it('parses an unchecked wiki link task line', () => {
    expect(parseUncheckedHubLinks('- [ ] [[📻 OVT]]')).toEqual(['📻 OVT.md']);
  });

  it('skips checked lines', () => {
    expect(parseUncheckedHubLinks('- [x] [[📻 OVT]]\n- [X] [[📻 Other]]')).toEqual([]);
  });

  it('handles pipe aliases and strips them', () => {
    expect(parseUncheckedHubLinks('- [ ] [[📻 OVT|OVT display name]]')).toEqual(['📻 OVT.md']);
  });

  it('does not duplicate the same file', () => {
    const input = '- [ ] [[📻 OVT]]\n- [ ] [[📻 OVT]]';
    expect(parseUncheckedHubLinks(input)).toEqual(['📻 OVT.md']);
  });

  it('returns multiple unique unchecked links in order', () => {
    const input = '- [ ] [[📻 OVT]]\n- [x] [[📻 Skipped]]\n- [ ] [[📻 Argos]]';
    expect(parseUncheckedHubLinks(input)).toEqual(['📻 OVT.md', '📻 Argos.md']);
  });

  it('returns empty array for content with no task lines', () => {
    expect(parseUncheckedHubLinks('# Hub\n\nSome text\n')).toEqual([]);
  });
});

// --- mergePodcastsFeedContent ---

describe('mergePodcastsFeedContent', () => {
  const today = new Date('2025-04-25T10:00:00');

  const pieBody = (date: string, title: string, mp3: string, article?: string) => {
    const months = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ];
    const d = new Date(date);
    const weekday = d.toLocaleDateString('en-US', {weekday: 'long'});
    const month = months[d.getMonth()]!;
    const day = d.getDate();
    const ordinal = (n: number) => {
      const s = ['th', 'st', 'nd', 'rd'];
      const v = n % 100;
      return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
    };
    const heading = `${weekday}, ${month} ${ordinal(day)}, ${d.getFullYear()}`;
    const artPart = article ? `[🌐](<${article}>) ` : '';
    return `# OVT\n\n## ${heading}\n\n- ${artPart}${title} [▶️](<${mp3}>)\n`;
  };

  it('adds today episodes from a pie body to an empty feed file', () => {
    const pie = pieBody('2025-04-25', 'New Episode', 'https://cdn.example.com/ep.mp3');
    const result = mergePodcastsFeedContent('', [{series: 'OVT', content: pie}], today);
    expect(result).toContain('2025-04-25');
    expect(result).toContain('New Episode');
    expect(result).toContain('[▶️](https://cdn.example.com/ep.mp3)');
    expect(result).toContain('(OVT)');
  });

  it('accepts tab or other ASCII whitespace after ## in pie date headings', () => {
    const pie =
      '# OVT\n\n' +
      '##\tFriday, April 25th, 2025\n\n' +
      '- Tab After Heading [▶️](<https://cdn.example.com/tab.mp3>)\n';
    const result = mergePodcastsFeedContent('', [{series: 'OVT', content: pie}], today);
    expect(result).toContain('Tab After Heading');
    expect(result).toContain('2025-04-25');
  });

  it('adds yesterday episodes from a pie body', () => {
    const pie = pieBody('2025-04-24', 'Yesterday Ep', 'https://cdn.example.com/y.mp3');
    const result = mergePodcastsFeedContent('', [{series: 'OVT', content: pie}], today);
    expect(result).toContain('2025-04-24');
    expect(result).toContain('Yesterday Ep');
  });

  it('does not add episodes older than yesterday from pie body', () => {
    const pie = pieBody('2025-04-23', 'Old Pie Ep', 'https://cdn.example.com/old.mp3');
    const result = mergePodcastsFeedContent('', [{series: 'OVT', content: pie}], today);
    expect(result).not.toContain('Old Pie Ep');
  });

  it('uses H1 from pie body as the series name', () => {
    const pie = '# Argos Radio\n\n## Friday, April 25th, 2025\n\n- New Show [▶️](<https://cdn.example.com/argos.mp3>)\n';
    const result = mergePodcastsFeedContent('', [{series: 'fallback', content: pie}], today);
    expect(result).toContain('(Argos Radio)');
    expect(result).not.toContain('(fallback)');
  });

  it('uses the first ATX H1 line and ignores ## headings for series naming', () => {
    const pie =
      '## Friday, April 25th, 2025\n\n' +
      '# From H1\n\n' +
      '- Ep [▶️](<https://cdn.example.com/e.mp3>)\n';
    const result = mergePodcastsFeedContent('', [{series: 'fallback', content: pie}], today);
    expect(result).toContain('(From H1)');
    expect(result).not.toContain('(fallback)');
  });

  it('drops existing episodes older than 7 days', () => {
    const old = '- [ ] 2025-04-17; Old Ep [▶️](https://cdn.example.com/old.mp3) (OVT)\n';
    const result = mergePodcastsFeedContent(old, [], today);
    expect(result).not.toContain('Old Ep');
  });

  it('drops played episodes from 2-6 days ago but keeps unplayed ones', () => {
    const existing = [
      '- [x] 2025-04-21; Played Old [▶️](https://cdn.example.com/p.mp3) (OVT)',
      '- [ ] 2025-04-21; Unplayed Old [▶️](https://cdn.example.com/u.mp3) (OVT)',
    ].join('\n') + '\n';
    const result = mergePodcastsFeedContent(existing, [], today);
    expect(result).not.toContain('Played Old');
    expect(result).toContain('Unplayed Old');
  });

  it('deduplicates when same episode is in existing and pie body', () => {
    const existing = '- [ ] 2025-04-24; Same Ep [▶️](https://cdn.example.com/s.mp3) (OVT)\n';
    const pie = pieBody('2025-04-24', 'Same Ep', 'https://cdn.example.com/s.mp3');
    const result = mergePodcastsFeedContent(existing, [{series: 'OVT', content: pie}], today);
    const occurrences = (result.match(/Same Ep/g) ?? []).length;
    expect(occurrences).toBe(1);
  });

  it('preserves played state when merging duplicate: existing played wins', () => {
    const existing = '- [x] 2025-04-24; Listened Ep [▶️](https://cdn.example.com/l.mp3) (OVT)\n';
    const pie = pieBody('2025-04-24', 'Listened Ep', 'https://cdn.example.com/l.mp3');
    const result = mergePodcastsFeedContent(existing, [{series: 'OVT', content: pie}], today);
    expect(result).toContain('- [x] 2025-04-24; Listened Ep');
  });

  it('preserves prefix lines before the episode list', () => {
    const existing = '# 2025 Morning Mix\n\n- [ ] 2025-04-24; Old Ep [▶️](https://cdn.example.com/o.mp3) (OVT)\n';
    const result = mergePodcastsFeedContent(existing, [], today);
    expect(result).toContain('# 2025 Morning Mix');
  });

  it('returns existing content unchanged when nothing to add or drop', () => {
    const existing = '- [ ] 2025-04-25; Fresh Ep [▶️](https://cdn.example.com/f.mp3) (OVT)\n';
    const result = mergePodcastsFeedContent(existing, [], today);
    expect(result).toBe(existing);
  });

  it('includes article link when pie body episode has one', () => {
    const pie = pieBody(
      '2025-04-25',
      'With Article',
      'https://cdn.example.com/art.mp3',
      'https://example.com/article',
    );
    const result = mergePodcastsFeedContent('', [{series: 'OVT', content: pie}], today);
    expect(result).toContain('[🌐](https://example.com/article)');
  });

  it('prefers ampersand-clean mp3 URL when duplicate rows share date and title', () => {
    const existing = [
      '- [ ] 2025-04-25; Same Title [▶️](https://cdn.example.com/old.mp3?a=1&amp;b=2) (OVT)',
      '- [ ] 2025-04-25; Same Title [▶️](https://cdn.example.com/new.mp3?a=1&b=2) (OVT)',
    ].join('\n') + '\n';
    const result = mergePodcastsFeedContent(existing, [], today);
    expect((result.match(/Same Title/g) ?? []).length).toBe(1);
    expect(result).toContain('https://cdn.example.com/new.mp3?a=1&b=2');
    expect(result).not.toContain('&amp;');
  });
});

// --- buildUpdatedPodcastFileContent ---

describe('buildUpdatedPodcastFileContent', () => {
  it('sets rssFetchedAt and replaces body, preserving other frontmatter keys', () => {
    const original =
      '---\n' +
      'rssFetchedAt: "2026-02-22T13:00:00.000Z"\n' +
      'rssFeedUrl: "https://example.com/feed.xml"\n' +
      'daysAgo: 7\n' +
      'owner: "me"\n' +
      '---\n\n' +
      '# OVT\n\n' +
      '## Old section\n\n' +
      '- Old episode\n';

    const newBody = '# OVT\n\n## Sunday, February 22nd, 2026\n\n- New ep\n';
    const now = new Date('2026-02-22T14:00:00.000Z');

    const result = buildUpdatedPodcastFileContent(original, newBody, now);

    expect(result).toContain('rssFetchedAt: "2026-02-22T14:00:00.000Z"');
    expect(result).toContain('rssFeedUrl: "https://example.com/feed.xml"');
    expect(result).toContain('owner: "me"');
    expect(result).toContain('# OVT');
    expect(result).toContain('New ep');
    expect(result).not.toContain('Old episode');
    // Old timestamp is replaced.
    expect(result).not.toContain('rssFetchedAt: "2026-02-22T13:00:00.000Z"');
  });

  it('adds rssFetchedAt when it was not present', () => {
    const original = '---\nrssFeedUrl: "https://example.com/feed.xml"\n---\n\n# Pod\n';
    const now = new Date('2026-02-22T14:00:00.000Z');
    const result = buildUpdatedPodcastFileContent(original, '# Pod\n', now);
    expect(result).toContain('rssFetchedAt: "2026-02-22T14:00:00.000Z"');
  });

  it('handles content without frontmatter', () => {
    const original = '# Pod\n\nSome body.\n';
    const now = new Date('2026-02-22T14:00:00.000Z');
    const result = buildUpdatedPodcastFileContent(original, '# Pod\n', now);
    expect(result).toContain('rssFetchedAt: "2026-02-22T14:00:00.000Z"');
    expect(result).toContain('# Pod');
  });
});

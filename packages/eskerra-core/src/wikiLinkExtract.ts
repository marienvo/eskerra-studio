export type WikiLinkInnerMatch = {
  inner: string;
  fullMatchStart: number;
  fullMatchEnd: number;
};

/**
 * Extracts wiki-link inners from Markdown text.
 * Matches the same `[[inner]]` syntax used by the desktop editor highlight.
 */
export function extractWikiLinkInnersFromMarkdown(markdown: string): string[] {
  return extractWikiLinkInnerMatchesFromMarkdown(markdown).map(m => m.inner);
}

/**
 * Extracts wiki-link inner text with source offsets for safe rewrites.
 * Inner text may not contain `[` or `]` (same as the prior `[^[\\]]+` rule).
 */
export function extractWikiLinkInnerMatchesFromMarkdown(markdown: string): WikiLinkInnerMatch[] {
  const out: WikiLinkInnerMatch[] = [];
  let i = 0;
  while (i + 1 < markdown.length) {
    if (markdown.charCodeAt(i) !== 91 || markdown.charCodeAt(i + 1) !== 91) {
      i++;
      continue;
    }
    const fullMatchStart = i;
    i += 2;
    const innerStart = i;
    while (i < markdown.length) {
      const c = markdown.charCodeAt(i);
      if (c === 91 || c === 93) {
        break;
      }
      i++;
    }
    if (i + 1 >= markdown.length || markdown.charCodeAt(i) !== 93 || markdown.charCodeAt(i + 1) !== 93) {
      i = fullMatchStart + 1;
      continue;
    }
    const inner = markdown.slice(innerStart, i);
    if (inner.length === 0) {
      i = fullMatchStart + 1;
      continue;
    }
    const fullMatchEnd = i + 2;
    out.push({inner, fullMatchStart, fullMatchEnd});
    i = fullMatchEnd;
  }
  return out;
}

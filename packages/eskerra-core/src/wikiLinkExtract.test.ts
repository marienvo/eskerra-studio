import {describe, expect, it} from 'vitest';

import {
  extractWikiLinkInnerMatchesFromMarkdown,
  extractWikiLinkInnersFromMarkdown,
} from './wikiLinkExtract';

describe('extractWikiLinkInnersFromMarkdown', () => {
  it('extracts plain and display-form wiki links', () => {
    expect(
      extractWikiLinkInnersFromMarkdown('See [[Alpha]] and [[Inbox/Beta|Shown]].'),
    ).toEqual(['Alpha', 'Inbox/Beta|Shown']);
  });

  it('keeps empty display segment and skips empty targets', () => {
    expect(
      extractWikiLinkInnersFromMarkdown('A [[target|]] B [[|display]] C [[ ]]'),
    ).toEqual(['target|', '|display', ' ']);
  });

  it('extracts consecutive and multiline links', () => {
    expect(
      extractWikiLinkInnersFromMarkdown('[[One]][[Two]]\nline [[Three]]'),
    ).toEqual(['One', 'Two', 'Three']);
  });

  it('returns empty when no links exist', () => {
    expect(extractWikiLinkInnersFromMarkdown('no wiki links here')).toEqual([]);
  });

  it('returns match offsets for safe rewrites', () => {
    expect(
      extractWikiLinkInnerMatchesFromMarkdown('A [[One]] B [[Two|Shown]] C'),
    ).toEqual([
      {inner: 'One', fullMatchStart: 2, fullMatchEnd: 9},
      {inner: 'Two|Shown', fullMatchStart: 12, fullMatchEnd: 25},
    ]);
  });

  it('does not treat brackets inside a pseudo-inner as a wiki link', () => {
    expect(extractWikiLinkInnersFromMarkdown('[[a[b]]')).toEqual([]);
  });

  it('handles long prefixes without catastrophic backtracking', () => {
    const pad = '['.repeat(5000);
    expect(extractWikiLinkInnersFromMarkdown(`${pad}[[End]]`)).toEqual(['End']);
  });
});

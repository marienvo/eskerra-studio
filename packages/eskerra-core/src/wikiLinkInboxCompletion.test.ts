import {describe, expect, it} from 'vitest';

import {resolveInboxWikiLinkTarget} from './wikiLinkInbox';
import {
  buildInboxWikiLinkCompletionCandidates,
  filterInboxWikiLinkCompletionCandidates,
  WIKI_LINK_COMPLETION_MAX_OPTIONS,
} from './wikiLinkInboxCompletion';

const NOTES = [
  {name: 'alpha-note.md', uri: '/vault/Inbox/alpha-note.md'},
  {name: 'beta.md', uri: '/vault/Inbox/beta.md'},
] as const;

describe('buildInboxWikiLinkCompletionCandidates', () => {
  it('sorts by label and carries stem detail', () => {
    const got = buildInboxWikiLinkCompletionCandidates(NOTES);
    expect(got.map(c => c.label)).toEqual(['alpha-note', 'beta']);
    expect(got.map(c => c.detail)).toEqual(['alpha-note', 'beta']);
  });

  it('insertTarget resolves to open for that note', () => {
    const got = buildInboxWikiLinkCompletionCandidates(NOTES);
    for (const c of got) {
      const r = resolveInboxWikiLinkTarget(NOTES, c.insertTarget);
      expect(r.kind).toBe('open');
      if (r.kind === 'open') {
        expect(c.detail).toBe(
          r.note.name.endsWith('.md') ? r.note.name.slice(0, -3) : r.note.name,
        );
      }
    }
  });

  it('drops notes when stem is ambiguous', () => {
    const rows = [
      {name: 'dup.md', uri: '/vault/Inbox/dup.md'},
      {name: 'dup.md', uri: '/vault/Inbox/archive/dup.md'},
    ];
    expect(buildInboxWikiLinkCompletionCandidates(rows)).toEqual([]);
  });

  it('keeps a note when stem is unique in the list', () => {
    const rows = [{name: 'only.md', uri: '/vault/Inbox/only.md'}];
    const got = buildInboxWikiLinkCompletionCandidates(rows);
    expect(got).toHaveLength(1);
    expect(got[0].insertTarget).toBe('only');
  });
});

describe('filterInboxWikiLinkCompletionCandidates', () => {
  const candidates = buildInboxWikiLinkCompletionCandidates(NOTES);

  it('returns all up to cap when prefix empty', () => {
    const many = buildInboxWikiLinkCompletionCandidates(
      Array.from({length: 60}, (_, i) => ({
        name: `n-${i}.md`,
        uri: `/Inbox/n-${i}.md`,
      })),
    );
    const got = filterInboxWikiLinkCompletionCandidates(many, '', 10);
    expect(got).toHaveLength(10);
  });

  it('matches label prefix case-insensitively', () => {
    const got = filterInboxWikiLinkCompletionCandidates(candidates, 'ALPHA-');
    expect(got.map(c => c.label)).toEqual(['alpha-note']);
  });

  it('matches stem detail prefix', () => {
    const got = filterInboxWikiLinkCompletionCandidates(candidates, 'beta');
    expect(got.map(c => c.detail)).toEqual(['beta']);
  });

  it('matches mid-string in emoji-prefixed note', () => {
    const emojiNotes = buildInboxWikiLinkCompletionCandidates([
      {name: '🪲 Editor bugs.md', uri: '/Inbox/🪲 Editor bugs.md'},
    ]);
    const got = filterInboxWikiLinkCompletionCandidates(emojiNotes, 'editor');
    expect(got.map(c => c.label)).toEqual(['🪲 Editor bugs']);
  });

  it('matches by emoji prefix', () => {
    const emojiNotes = buildInboxWikiLinkCompletionCandidates([
      {name: '🪲 Editor bugs.md', uri: '/Inbox/🪲 Editor bugs.md'},
    ]);
    const got = filterInboxWikiLinkCompletionCandidates(emojiNotes, '🪲');
    expect(got.map(c => c.label)).toEqual(['🪲 Editor bugs']);
  });

  it('ranks prefix matches before mid-string matches', () => {
    const mixed = buildInboxWikiLinkCompletionCandidates([
      {name: '🪲 Editor bugs.md', uri: '/Inbox/🪲 Editor bugs.md'},
      {name: 'editor-notes.md', uri: '/Inbox/editor-notes.md'},
    ]);
    const got = filterInboxWikiLinkCompletionCandidates(mixed, 'editor');
    expect(got.map(c => c.label)).toEqual(['editor-notes', '🪲 Editor bugs']);
  });

  it('respects max options constant default', () => {
    const many = buildInboxWikiLinkCompletionCandidates(
      Array.from({length: WIKI_LINK_COMPLETION_MAX_OPTIONS + 20}, (_, i) => ({
        name: `z-${i}.md`,
        uri: `/Inbox/z-${i}.md`,
      })),
    );
    const got = filterInboxWikiLinkCompletionCandidates(many, '');
    expect(got).toHaveLength(WIKI_LINK_COMPLETION_MAX_OPTIONS);
  });
});

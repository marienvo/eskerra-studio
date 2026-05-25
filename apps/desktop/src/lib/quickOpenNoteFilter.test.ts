import {describe, expect, it} from 'vitest';

import {
  filterVaultNotesForQuickOpen,
  quickOpenMatchTier,
  quickOpenVaultRelativePath,
} from './quickOpenNoteFilter';

describe('quickOpenVaultRelativePath', () => {
  it('strips vault root prefix', () => {
    const rel = quickOpenVaultRelativePath(
      'file:///vault',
      'file:///vault/Inbox/Note.md',
    );
    expect(rel).toBe('Inbox/Note.md');
  });

  it('falls back to file name when prefix mismatches', () => {
    expect(quickOpenVaultRelativePath('file:///a', 'file:///other/b.md')).toBe('b.md');
  });
});

describe('filterVaultNotesForQuickOpen', () => {
  const vault = 'file:///v';
  const refs = [
    {name: 'Alpha', uri: 'file:///v/Inbox/Alpha.md'},
    {name: 'Beta', uri: 'file:///v/General/Beta.md'},
  ];

  it('returns no rows when query empty or whitespace', () => {
    expect(filterVaultNotesForQuickOpen('', vault, refs)).toEqual([]);
    expect(filterVaultNotesForQuickOpen('   ', vault, refs)).toEqual([]);
  });

  it('matches stem substring', () => {
    expect(filterVaultNotesForQuickOpen('alp', vault, refs)).toEqual([
      {name: 'Alpha', uri: 'file:///v/Inbox/Alpha.md'},
    ]);
  });

  it('matches path substring', () => {
    expect(filterVaultNotesForQuickOpen('general', vault, refs)).toEqual([
      {name: 'Beta', uri: 'file:///v/General/Beta.md'},
    ]);
  });

  it('is case insensitive', () => {
    expect(filterVaultNotesForQuickOpen('ALPHA', vault, refs)).toEqual([
      {name: 'Alpha', uri: 'file:///v/Inbox/Alpha.md'},
    ]);
  });

  it('ranks by query-specific score within the same match tier', () => {
    const manyRefs = [
      {name: 'Alpha', uri: 'file:///v/Inbox/Alpha.md'},
      {name: 'Alpine', uri: 'file:///v/Inbox/Alpine.md'},
      {name: 'Alpaca', uri: 'file:///v/Inbox/Alpaca.md'},
    ];
    const getScores = (uri: string) => {
      if (uri === 'file:///v/Inbox/Alpaca.md') {
        return {favScore: 2, globalScore: 1};
      }
      if (uri === 'file:///v/Inbox/Alpine.md') {
        return {favScore: 2, globalScore: 5};
      }
      return {favScore: 0, globalScore: 10};
    };
    expect(filterVaultNotesForQuickOpen('alp', vault, manyRefs, getScores)).toEqual([
      {name: 'Alpine', uri: 'file:///v/Inbox/Alpine.md'},
      {name: 'Alpaca', uri: 'file:///v/Inbox/Alpaca.md'},
      {name: 'Alpha', uri: 'file:///v/Inbox/Alpha.md'},
    ]);
  });

  it('prefers better match tier over global popularity for non-favorites', () => {
    const manyRefs = [
      {name: 'Project', uri: 'file:///v/Inbox/Project.md'},
      {name: 'Misc', uri: 'file:///v/Projects/idea.md'},
    ];
    const getScores = (uri: string) => ({
      favScore: 0,
      globalScore: uri.endsWith('idea.md') ? 100 : 0,
    });
    expect(filterVaultNotesForQuickOpen('proj', vault, manyRefs, getScores)).toEqual([
      {name: 'Project', uri: 'file:///v/Inbox/Project.md'},
      {name: 'Misc', uri: 'file:///v/Projects/idea.md'},
    ]);
  });

  it('lets query favorites beat weaker match tiers', () => {
    const manyRefs = [
      {name: 'Project', uri: 'file:///v/Inbox/Project.md'},
      {name: 'Misc', uri: 'file:///v/Projects/idea.md'},
    ];
    const getScores = (uri: string) => ({
      favScore: uri.endsWith('idea.md') ? 1 : 0,
      globalScore: 0,
    });
    expect(filterVaultNotesForQuickOpen('proj', vault, manyRefs, getScores)).toEqual([
      {name: 'Misc', uri: 'file:///v/Projects/idea.md'},
      {name: 'Project', uri: 'file:///v/Inbox/Project.md'},
    ]);
  });

  it('sorts by match tier even without usage scores', () => {
    const manyRefs = [
      {name: 'Misc', uri: 'file:///v/Projects/idea.md'},
      {name: 'Project', uri: 'file:///v/Inbox/Project.md'},
    ];
    expect(filterVaultNotesForQuickOpen('proj', vault, manyRefs)).toEqual([
      {name: 'Project', uri: 'file:///v/Inbox/Project.md'},
      {name: 'Misc', uri: 'file:///v/Projects/idea.md'},
    ]);
  });

  it('falls back to alphabetical order when scores tie', () => {
    const manyRefs = [
      {name: 'Beta', uri: 'file:///v/Inbox/Beta.md'},
      {name: 'Alpha', uri: 'file:///v/Inbox/Alpha.md'},
    ];
    const getScores = () => ({favScore: 0, globalScore: 0});
    expect(filterVaultNotesForQuickOpen('a', vault, manyRefs, getScores)).toEqual([
      {name: 'Alpha', uri: 'file:///v/Inbox/Alpha.md'},
      {name: 'Beta', uri: 'file:///v/Inbox/Beta.md'},
    ]);
  });
});

describe('quickOpenMatchTier', () => {
  const vault = 'file:///v';

  it('classifies name prefix before path substring', () => {
    expect(
      quickOpenMatchTier({name: 'Project', uri: 'file:///v/Inbox/Project.md'}, 'proj', vault),
    ).toBe(0);
    expect(
      quickOpenMatchTier(
        {name: 'Misc', uri: 'file:///v/Archive/old-project.md'},
        'proj',
        vault,
      ),
    ).toBe(3);
  });
});

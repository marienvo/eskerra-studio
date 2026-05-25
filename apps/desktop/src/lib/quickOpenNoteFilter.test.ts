import {describe, expect, it} from 'vitest';

import {
  filterVaultNotesForQuickOpen,
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

  it('ranks by query-specific score, then global score, then name', () => {
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

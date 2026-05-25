import {describe, expect, test} from 'vitest';

import {
  colonQueryFromEmojiPrefixMatch,
  EMOJI_COLON_PREFIX_PATTERN,
  filterSortAndCapEmojiRows,
  isEmojiShortcodeColonCompletion,
  type EmojiCompletionRow,
} from './emojiColonAutocompleteHelpers';

function matchPrefixBeforeCursor(textBeforeCursor: string) {
  return textBeforeCursor.match(EMOJI_COLON_PREFIX_PATTERN);
}

describe('EMOJI_COLON_PREFIX_PATTERN', () => {
  test('matches space before colon and captures query', () => {
    const before = 'hello :smi';
    const m = matchPrefixBeforeCursor(before);
    expect(m).not.toBeNull();
    const matchFrom = before.length - m![0].length;
    expect(colonQueryFromEmojiPrefixMatch({from: matchFrom, text: m![0]})).toEqual({
      colonFrom: before.indexOf(':'),
      query: 'smi',
    });
  });

  test('matches start of line', () => {
    const before = ':grin';
    const m = matchPrefixBeforeCursor(before);
    expect(m).not.toBeNull();
    const matchFrom = before.length - m![0].length;
    expect(colonQueryFromEmojiPrefixMatch({from: matchFrom, text: m![0]})).toEqual({
      colonFrom: 0,
      query: 'grin',
    });
  });

  test('matches after opening paren', () => {
    const m = matchPrefixBeforeCursor('(:s');
    expect(m).not.toBeNull();
  });

  test('does not match http: scheme', () => {
    expect(matchPrefixBeforeCursor('https://a')).toBeNull();
    expect(matchPrefixBeforeCursor('http:')).toBeNull();
  });

  test('does not match clock-style time', () => {
    expect(matchPrefixBeforeCursor('10:30')).toBeNull();
  });

  test('does not match foo:bar word boundary', () => {
    expect(matchPrefixBeforeCursor('foo:bar')).toBeNull();
  });
});

describe('isEmojiShortcodeColonCompletion', () => {
  test('matches GitHub-style shortcode labels', () => {
    expect(isEmojiShortcodeColonCompletion({label: ':smile:'})).toBe(true);
    expect(isEmojiShortcodeColonCompletion({label: ':sweat_smile:'})).toBe(true);
  });

  test('rejects wiki-style and other labels', () => {
    expect(isEmojiShortcodeColonCompletion({label: 'Alpha'})).toBe(false);
    expect(isEmojiShortcodeColonCompletion({label: 'Note: Title'})).toBe(false);
    expect(isEmojiShortcodeColonCompletion({label: ':incomplete'})).toBe(false);
    expect(isEmojiShortcodeColonCompletion({label: 'smile:'})).toBe(false);
  });
});

describe('colonQueryFromEmojiPrefixMatch', () => {
  test('derives colon position within longer matched text', () => {
    const textBefore = 'prefix :ab';
    const m = textBefore.match(EMOJI_COLON_PREFIX_PATTERN);
    expect(m).not.toBeNull();
    const from = textBefore.length - m![0].length;
    expect(colonQueryFromEmojiPrefixMatch({from, text: m![0]})).toEqual({
      colonFrom: from + m![0].indexOf(':'),
      query: 'ab',
    });
  });
});

describe('filterSortAndCapEmojiRows', () => {
  const rows: EmojiCompletionRow[] = [
    {e: '😁', p: 'grin', b: 'grin teeth'},
    {e: '😠', p: 'angry', b: 'angry mad'},
    {e: '🪨', p: 'rocks', b: 'rocks gray stone'},
  ];

  test('prefix on shortcode ranks before substring-only on blob', () => {
    const got = filterSortAndCapEmojiRows(rows, 'gr', 10);
    expect(got.map(r => r.p)).toEqual(['grin', 'angry', 'rocks']);
  });

  test('caps results', () => {
    const many: EmojiCompletionRow[] = Array.from({length: 30}, (_, i) => ({
      e: 'x',
      p: `z${i}`,
      b: `z${i} findme`,
    }));
    const got = filterSortAndCapEmojiRows(many, 'findme', 5);
    expect(got).toHaveLength(5);
  });

  test('returns empty when nothing matches', () => {
    expect(filterSortAndCapEmojiRows(rows, 'qqq', 10)).toEqual([]);
  });

  test('favorite with tier 2 ranks above non-favorite tier 0', () => {
    const r: EmojiCompletionRow[] = [
      {e: '📊', p: 'chart', b: 'chart graph'},
      {e: '✅', p: 'heavy_check_mark', b: 'check mark heavy'},
    ];
    const got = filterSortAndCapEmojiRows(r, 'ch', 10, p =>
      p === 'heavy_check_mark' ? {favScore: 1, globalScore: 0} : {favScore: 0, globalScore: 0},
    );
    expect(got.map(x => x.p)).toEqual(['heavy_check_mark', 'chart']);
  });

  test('two favorites sort by favScore descending', () => {
    const r: EmojiCompletionRow[] = [
      {e: 'a', p: 'smile_a', b: 'smile_a test'},
      {e: 'b', p: 'smile_b', b: 'smile_b test'},
    ];
    const got = filterSortAndCapEmojiRows(r, 'smile', 10, p =>
      p === 'smile_b'
        ? {favScore: 3, globalScore: 0}
        : {favScore: 1, globalScore: 0},
    );
    expect(got.map(x => x.p)).toEqual(['smile_b', 'smile_a']);
  });

  test('within non-favorite bucket, tier orders before globalScore', () => {
    const r: EmojiCompletionRow[] = [
      {e: '😁', p: 'grin', b: 'grin teeth'},
      {e: '🪨', p: 'rocks', b: 'rocks gray stone'},
    ];
    const got = filterSortAndCapEmojiRows(r, 'gr', 10, p =>
      p === 'rocks'
        ? {favScore: 0, globalScore: 99}
        : {favScore: 0, globalScore: 1},
    );
    expect(got.map(x => x.p)).toEqual(['grin', 'rocks']);
  });
});

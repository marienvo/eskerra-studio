import {ensureSyntaxTree, syntaxTree} from '@codemirror/language';
import type {EditorState} from '@codemirror/state';
import type {SyntaxNode} from '@lezer/common';

/**
 * Match a GitHub-style emoji query after `:` when `:` is not preceded by a word character
 * (avoids `http:`, `10:30`, `foo:`).
 *
 * Group 1 is `:`; group 2 is the query (letters, digits, `_`, `+`, `-`).
 */
export const EMOJI_COLON_PREFIX_PATTERN =
  /(?:^|[\s({[\]'"])(:)([\p{L}\p{N}_+-]*)$/u;

const EMOJI_DISABLED_ANCESTOR_NAMES = new Set([
  'CodeBlock',
  'FencedCode',
  'IndentedCode',
  'InlineCode',
]);

const SYNTAX_TREE_BUDGET_MS = 5000;

export type EmojiCompletionRow = {
  readonly e: string;
  /** Primary GitHub-style shortcode (underscores). */
  readonly p: string;
  /** Lowercased search blob (labels, tags, shortcodes). */
  readonly b: string;
};

/**
 * Labels from emoji completions use `:${shortcode}:` (see `buildEmojiCompletions`).
 * Used to treat a second `:` as accept without matching wiki link completions.
 */
const EMOJI_SHORTCODE_COMPLETION_LABEL_RE = /^:[\p{L}\p{N}_+-]+:$/u;

export function isEmojiShortcodeColonCompletion(c: {
  readonly label: string;
}): boolean {
  return EMOJI_SHORTCODE_COMPLETION_LABEL_RE.test(c.label);
}

export function colonQueryFromEmojiPrefixMatch(m: {
  readonly from: number;
  readonly text: string;
}): {readonly colonFrom: number; readonly query: string} | null {
  const i = m.text.indexOf(':');
  if (i < 0) {
    return null;
  }
  return {
    colonFrom: m.from + i,
    query: m.text.slice(i + 1),
  };
}

export function isEmojiCompletionDisabledInMarkdown(
  state: EditorState,
  pos: number,
): boolean {
  ensureSyntaxTree(state, state.doc.length, SYNTAX_TREE_BUDGET_MS);
  let n: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1);
  for (; n; n = n.parent) {
    if (EMOJI_DISABLED_ANCESTOR_NAMES.has(n.type.name)) {
      return true;
    }
  }
  return false;
}

export type EmojiMatchTier = 0 | 1 | 2;

export function emojiMatchTier(
  row: EmojiCompletionRow,
  queryLower: string,
): EmojiMatchTier | null {
  const pl = row.p.toLowerCase();
  if (pl.startsWith(queryLower)) {
    return 0;
  }
  if (pl.includes(queryLower)) {
    return 1;
  }
  if (row.b.includes(queryLower)) {
    return 2;
  }
  return null;
}

export type EmojiUsageScoresForSort = {
  readonly favScore: number;
  readonly globalScore: number;
};

export function filterSortAndCapEmojiRows(
  rows: readonly EmojiCompletionRow[],
  queryLower: string,
  maxOptions: number,
  getScores: (shortcode: string) => EmojiUsageScoresForSort = () => ({
    favScore: 0,
    globalScore: 0,
  }),
): EmojiCompletionRow[] {
  const scored: {readonly row: EmojiCompletionRow; readonly tier: EmojiMatchTier}[] =
    [];
  for (const row of rows) {
    const tier = emojiMatchTier(row, queryLower);
    if (tier !== null) {
      scored.push({row, tier});
    }
  }
  scored.sort((a, b) => {
    const sa = getScores(a.row.p);
    const sb = getScores(b.row.p);
    const aFav = sa.favScore > 0;
    const bFav = sb.favScore > 0;
    if (aFav !== bFav) {
      return aFav ? -1 : 1;
    }
    if (aFav && bFav) {
      if (sb.favScore !== sa.favScore) {
        return sb.favScore - sa.favScore;
      }
      if (sb.globalScore !== sa.globalScore) {
        return sb.globalScore - sa.globalScore;
      }
      return a.row.p.localeCompare(b.row.p);
    }
    if (a.tier !== b.tier) {
      return a.tier - b.tier;
    }
    if (sb.globalScore !== sa.globalScore) {
      return sb.globalScore - sa.globalScore;
    }
    return a.row.p.localeCompare(b.row.p);
  });
  return scored.slice(0, maxOptions).map(s => s.row);
}

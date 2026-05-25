/**
 * Emoji completion after `:query` in markdown (desktop vault editor).
 *
 * Search index is generated from emojibase-data (MIT); regenerate with:
 * `npm run generate-emoji-data` in apps/desktop.
 */
import {
  acceptCompletion,
  completionStatus,
  insertCompletionText,
  pickedCompletion,
  selectedCompletion,
  type Completion,
  type CompletionContext,
  type CompletionSource,
} from '@codemirror/autocomplete';
import {Prec, type Extension} from '@codemirror/state';
import {EditorView, keymap} from '@codemirror/view';

import {getEmojiUsageCount, recordEmojiUsage} from '../../lib/emojiUsageStore';
import emojiRows from './data/emojiColonCompletionData.json';
import {
  colonQueryFromEmojiPrefixMatch,
  EMOJI_COLON_PREFIX_PATTERN,
  type EmojiCompletionRow,
  filterSortAndCapEmojiRows,
  isEmojiCompletionDisabledInMarkdown,
  isEmojiShortcodeColonCompletion,
} from './emojiColonAutocompleteHelpers';

export const EMOJI_COMPLETION_MAX_OPTIONS = 50;

const completionRows = emojiRows as readonly EmojiCompletionRow[];

function buildEmojiCompletions(
  rows: readonly EmojiCompletionRow[],
  queryLower: string,
): Completion[] {
  const usageForQuery = (shortcode: string) => getEmojiUsageCount(shortcode, queryLower);
  const picked = filterSortAndCapEmojiRows(
    rows,
    queryLower,
    EMOJI_COMPLETION_MAX_OPTIONS,
    usageForQuery,
  );
  return picked.map(
    (row): Completion => ({
      label: `:${row.p}:`,
      displayLabel: `${row.e} :${row.p}:`,
      detail: row.e,
      apply: (view: EditorView, completion: Completion, from: number, to: number) => {
        view.dispatch({
          ...insertCompletionText(view.state, row.e, from, to),
          annotations: pickedCompletion.of(completion),
        });
        recordEmojiUsage(row.p, queryLower);
      },
    }),
  );
}

/** GitHub-style: type a second `:` to accept the highlighted emoji (not inserted). */
export const emojiColonSecondColonAcceptKeymap: Extension = Prec.highest(
  keymap.of([
    {
      key: ':',
      run(view: EditorView) {
        if (completionStatus(view.state) !== 'active') {
          return false;
        }
        const sel = selectedCompletion(view.state);
        if (!sel || !isEmojiShortcodeColonCompletion(sel)) {
          return false;
        }
        return acceptCompletion(view);
      },
    },
  ]),
);

export const emojiColonCompletionSource: CompletionSource = (
  context: CompletionContext,
) => {
  const match = context.matchBefore(EMOJI_COLON_PREFIX_PATTERN);
  if (!match) {
    return null;
  }
  const parsed = colonQueryFromEmojiPrefixMatch(match);
  if (!parsed || parsed.query.length < 1) {
    return null;
  }
  if (isEmojiCompletionDisabledInMarkdown(context.state, context.pos)) {
    return null;
  }

  const queryLower = parsed.query.toLowerCase();

  const options = buildEmojiCompletions(completionRows, queryLower);
  if (options.length === 0) {
    return null;
  }
  return {
    from: parsed.colonFrom,
    filter: false,
    options,
  };
};

/** Vitest harness: retained for setup modules that reset editor singletons. */
export function __resetForTests(): void {
}

import type {EditorState} from '@codemirror/state';

export type NoteMarkdownLoadSelection = 'start' | 'end' | 'preserve' | 'openNote';

/**
 * How to place the caret after a full-document `loadMarkdown` replace.
 *
 * - `start` / `end`: force an empty selection at 0 or EOF (`undefined` counts as `end` for backward compatibility).
 * - `preserve`: map the current selection through minimal line-diff hunks (`dispatch`) or `mapPositionThroughDiff` (`setState`); see `noteMarkdownDiffChanges.ts`.
 */
export type NoteMarkdownLoadOptions = {
  selection?: NoteMarkdownLoadSelection | undefined;
};

/**
 * Cursor position for `EditorState.create` when the load path uses `setState` (e.g. folded ranges).
 */
export function explicitCursorForMarkdownLoadSetState(
  options: NoteMarkdownLoadOptions | undefined,
  markdownLength: number,
  currentHead: number,
): number {
  const mode = options?.selection;
  if (mode === 'preserve') {
    return Math.min(Math.max(0, currentHead), markdownLength);
  }
  if (mode === 'start') {
    return 0;
  }
  return markdownLength;
}

/**
 * Whether the merged `dispatch({ changes: full replace, selection? })` path should run.
 */
export function shouldUseMergedReplaceForMarkdownLoad(input: {
  hadFoldedRanges: boolean;
  curText: string;
  markdown: string;
  preserve: boolean;
  selMatchesForcedCursor: boolean;
}): boolean {
  const {hadFoldedRanges, curText, markdown, preserve, selMatchesForcedCursor} =
    input;
  return (
    !hadFoldedRanges
    && (curText !== markdown || (!preserve && !selMatchesForcedCursor))
  );
}

/**
 * Whether `setState` / secondary reload path is needed (when merged replace did not run).
 */
export function shouldUseSetStateBranchForMarkdownLoad(input: {
  hadFoldedRanges: boolean;
  curText: string;
  markdown: string;
  preserve: boolean;
  selMatchesForcedCursor: boolean;
}): boolean {
  const {hadFoldedRanges, curText, markdown, preserve, selMatchesForcedCursor} =
    input;
  return (
    hadFoldedRanges
    || curText !== markdown
    || (!preserve && !selMatchesForcedCursor)
  );
}

export function selectionIsPreserve(
  options: NoteMarkdownLoadOptions | undefined,
): boolean {
  return options?.selection === 'preserve';
}

/** Explicit cursor for forced selection in dispatch; undefined when selection should be omitted (preserve + merged path). */
export function explicitCursorForMarkdownLoadDispatch(
  options: NoteMarkdownLoadOptions | undefined,
  markdownLength: number,
): number | undefined {
  if (selectionIsPreserve(options)) {
    return undefined;
  }
  return options?.selection === 'start' ? 0 : markdownLength;
}

export function selMatchesForcedCursor(
  state: EditorState,
  forcedCursor: number,
): boolean {
  return (
    state.selection.main.from === forcedCursor && state.selection.main.empty
  );
}

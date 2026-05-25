import type {EditorState} from '@codemirror/state';

import {mapPositionThroughDiff} from './noteMarkdownDiffChanges';
import {
  computeOpenNoteCaretPlacement,
  type OpenNoteCaretPlacement,
} from './openNoteCaretPlacement';

export type NoteMarkdownLoadSelection = 'start' | 'end' | 'preserve' | 'openNote';

export type ResolvedMarkdownLoad = {
  effectiveMarkdown: string;
  openNotePlacement: OpenNoteCaretPlacement | undefined;
};

/** Disk body plus optional open-note buffer padding and caret target. */
export function resolveMarkdownLoadDocument(
  markdown: string,
  options: NoteMarkdownLoadOptions | undefined,
): ResolvedMarkdownLoad {
  const openNotePlacement =
    options?.selection === 'openNote'
      ? computeOpenNoteCaretPlacement(markdown)
      : undefined;
  return {
    effectiveMarkdown: openNotePlacement?.doc ?? markdown,
    openNotePlacement,
  };
}

export function forcedCursorForMarkdownLoadDispatch(
  options: NoteMarkdownLoadOptions | undefined,
  resolved: ResolvedMarkdownLoad,
): number | undefined {
  if (resolved.openNotePlacement !== undefined) {
    return resolved.openNotePlacement.caret;
  }
  return explicitCursorForMarkdownLoadDispatch(
    options,
    resolved.effectiveMarkdown.length,
  );
}

export function cursorForMarkdownLoadSetState(
  options: NoteMarkdownLoadOptions | undefined,
  resolved: ResolvedMarkdownLoad,
  preserve: boolean,
  currentHead: number,
  curText: string,
): number {
  if (preserve) {
    return mapPositionThroughDiff(
      currentHead,
      curText,
      resolved.effectiveMarkdown,
    );
  }
  if (resolved.openNotePlacement !== undefined) {
    return resolved.openNotePlacement.caret;
  }
  return explicitCursorForMarkdownLoadSetState(
    options,
    resolved.effectiveMarkdown.length,
    currentHead,
  );
}

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

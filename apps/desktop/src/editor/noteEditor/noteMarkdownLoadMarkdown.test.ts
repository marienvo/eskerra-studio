import {describe, expect, it} from 'vitest';

import {
  cursorForMarkdownLoadSetState,
  explicitCursorForMarkdownLoadDispatch,
  explicitCursorForMarkdownLoadSetState,
  forcedCursorForMarkdownLoadDispatch,
  resolveMarkdownLoadDocument,
  selectionIsPreserve,
  shouldUseMergedReplaceForMarkdownLoad,
  shouldUseSetStateBranchForMarkdownLoad,
} from './noteMarkdownLoadMarkdown';

describe('noteMarkdownLoadMarkdown', () => {
  it('explicitCursorForMarkdownLoadDispatch: start, end, default, preserve', () => {
    expect(explicitCursorForMarkdownLoadDispatch({selection: 'start'}, 99)).toBe(
      0,
    );
    expect(explicitCursorForMarkdownLoadDispatch({selection: 'end'}, 99)).toBe(
      99,
    );
    expect(explicitCursorForMarkdownLoadDispatch(undefined, 99)).toBe(99);
    expect(explicitCursorForMarkdownLoadDispatch({}, 99)).toBe(99);
    expect(explicitCursorForMarkdownLoadDispatch({selection: 'preserve'}, 99)).toBe(
      undefined,
    );
  });

  it('explicitCursorForMarkdownLoadSetState clamps head for preserve', () => {
    expect(
      explicitCursorForMarkdownLoadSetState({selection: 'preserve'}, 10, 50),
    ).toBe(10);
    expect(
      explicitCursorForMarkdownLoadSetState({selection: 'preserve'}, 10, -3),
    ).toBe(0);
    expect(
      explicitCursorForMarkdownLoadSetState({selection: 'preserve'}, 10, 7),
    ).toBe(7);
  });

  it('selectionIsPreserve', () => {
    expect(selectionIsPreserve({selection: 'preserve'})).toBe(true);
    expect(selectionIsPreserve({selection: 'start'})).toBe(false);
    expect(selectionIsPreserve(undefined)).toBe(false);
  });

  it('shouldUseMergedReplaceForMarkdownLoad matches non-preserve semantics', () => {
    expect(
      shouldUseMergedReplaceForMarkdownLoad({
        hadFoldedRanges: false,
        curText: 'a',
        markdown: 'b',
        preserve: false,
        selMatchesForcedCursor: true,
      }),
    ).toBe(true);

    expect(
      shouldUseMergedReplaceForMarkdownLoad({
        hadFoldedRanges: false,
        curText: 'same',
        markdown: 'same',
        preserve: false,
        selMatchesForcedCursor: true,
      }),
    ).toBe(false);

    expect(
      shouldUseMergedReplaceForMarkdownLoad({
        hadFoldedRanges: false,
        curText: 'same',
        markdown: 'same',
        preserve: false,
        selMatchesForcedCursor: false,
      }),
    ).toBe(true);
  });

  it('shouldUseMergedReplaceForMarkdownLoad: preserve ignores forced cursor mismatch when text unchanged', () => {
    expect(
      shouldUseMergedReplaceForMarkdownLoad({
        hadFoldedRanges: false,
        curText: 'same',
        markdown: 'same',
        preserve: true,
        selMatchesForcedCursor: false,
      }),
    ).toBe(false);
  });

  it('shouldUseMergedReplaceForMarkdownLoad: preserve still replaces when text changes', () => {
    expect(
      shouldUseMergedReplaceForMarkdownLoad({
        hadFoldedRanges: false,
        curText: 'a',
        markdown: 'b',
        preserve: true,
        selMatchesForcedCursor: false,
      }),
    ).toBe(true);
  });

  it('shouldUseSetStateBranchForMarkdownLoad: preserve same text without folds is false', () => {
    expect(
      shouldUseSetStateBranchForMarkdownLoad({
        hadFoldedRanges: false,
        curText: 'x',
        markdown: 'x',
        preserve: true,
        selMatchesForcedCursor: false,
      }),
    ).toBe(false);
  });

  it('resolveMarkdownLoadDocument pads body for openNote', () => {
    const resolved = resolveMarkdownLoadDocument('# Title', {selection: 'openNote'});
    expect(resolved.effectiveMarkdown).toBe('# Title\n\n');
    expect(resolved.openNotePlacement?.caret).toBe(9);
  });

  it('forcedCursorForMarkdownLoadDispatch uses openNote caret', () => {
    const resolved = resolveMarkdownLoadDocument('# Title', {selection: 'openNote'});
    expect(forcedCursorForMarkdownLoadDispatch({selection: 'openNote'}, resolved)).toBe(
      9,
    );
  });

  it('cursorForMarkdownLoadSetState uses openNote caret when not preserve', () => {
    const resolved = resolveMarkdownLoadDocument('# Title', {selection: 'openNote'});
    expect(
      cursorForMarkdownLoadSetState(
        {selection: 'openNote'},
        resolved,
        false,
        0,
        '',
      ),
    ).toBe(9);
  });

  it('shouldUseSetStateBranchForMarkdownLoad: preserve same text with folds is true', () => {
    expect(
      shouldUseSetStateBranchForMarkdownLoad({
        hadFoldedRanges: true,
        curText: 'x',
        markdown: 'x',
        preserve: true,
        selMatchesForcedCursor: false,
      }),
    ).toBe(true);
  });
});

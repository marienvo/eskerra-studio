import {describe, expect, it} from 'vitest';

import {
  computeOpenNoteCaretPlacement,
  editorSliceOnlyAddsOpenNoteBufferPadding,
  offsetAtEndOfLine,
  persistableInboxEditorBodySlice,
} from './openNoteCaretPlacement';

describe('offsetAtEndOfLine', () => {
  it('returns 0 for empty doc line 1', () => {
    expect(offsetAtEndOfLine('', 1)).toBe(0);
  });

  it('returns position before newline for multi-line doc', () => {
    expect(offsetAtEndOfLine('ab\ncd', 1)).toBe(2);
    expect(offsetAtEndOfLine('ab\ncd', 2)).toBe(5);
  });
});

describe('computeOpenNoteCaretPlacement', () => {
  it('empty body: caret at start (end of line 1)', () => {
    expect(computeOpenNoteCaretPlacement('')).toEqual({doc: '', caret: 0});
  });

  it('single-line ATX h1: pads to three lines, caret at EOF', () => {
    expect(computeOpenNoteCaretPlacement('# Title')).toEqual({
      doc: '# Title\n\n',
      caret: 9,
    });
  });

  it('h1 plus one trailing newline: pads one blank line', () => {
    expect(computeOpenNoteCaretPlacement('# Title\n')).toEqual({
      doc: '# Title\n\n',
      caret: 9,
    });
  });

  it('h1 with empty lines 2 and 3 already: no extra padding', () => {
    expect(computeOpenNoteCaretPlacement('# Title\n\n')).toEqual({
      doc: '# Title\n\n',
      caret: 9,
    });
  });

  it('h1, empty line 2, content on line 3: caret at end of line 3 content', () => {
    expect(computeOpenNoteCaretPlacement('# Title\n\nbody')).toEqual({
      doc: '# Title\n\nbody',
      caret: 13,
    });
  });

  it('h1 with non-empty line 2: caret at end of line 1, no padding', () => {
    expect(computeOpenNoteCaretPlacement('# Title\nNot empty')).toEqual({
      doc: '# Title\nNot empty',
      caret: 7,
    });
  });

  it('h2 on line 1: caret at end of line 1', () => {
    expect(computeOpenNoteCaretPlacement('## Sub\n\n')).toEqual({
      doc: '## Sub\n\n',
      caret: 6,
    });
  });

  it('non-heading line 1: caret at end of line 1', () => {
    expect(computeOpenNoteCaretPlacement('No heading\n\n')).toEqual({
      doc: 'No heading\n\n',
      caret: 10,
    });
  });

  it('setext-style title: not ATX h1, caret at end of line 1', () => {
    expect(computeOpenNoteCaretPlacement('Title\n=====')).toEqual({
      doc: 'Title\n=====',
      caret: 5,
    });
  });

  it('ATX h1 with only "# " on line 1 still qualifies', () => {
    const result = computeOpenNoteCaretPlacement('# \n');
    expect(result.doc).toBe('# \n\n');
    expect(result.caret).toBe(result.doc.length);
  });
});

describe('persistableInboxEditorBodySlice', () => {
  it('returns disk slice when editor only has open-note buffer padding', () => {
    const disk = '# Title';
    const padded = computeOpenNoteCaretPlacement(disk).doc;
    expect(editorSliceOnlyAddsOpenNoteBufferPadding(padded, disk)).toBe(true);
    expect(persistableInboxEditorBodySlice(padded, disk)).toBe(disk);
  });

  it('returns editor slice when the user changed body text', () => {
    const disk = '# Title';
    const edited = '# Title\n\nnotes';
    expect(persistableInboxEditorBodySlice(edited, disk)).toBe(edited);
  });
});

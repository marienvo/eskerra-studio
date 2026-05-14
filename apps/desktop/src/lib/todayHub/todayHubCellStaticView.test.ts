import {commonmarkLanguage} from '@codemirror/lang-markdown';
import {ensureSyntaxTree, syntaxTree} from '@codemirror/language';
import {EditorState} from '@codemirror/state';
import {describe, expect, it} from 'vitest';

import {markdownEskerra} from '../../editor/noteEditor/markdownEskerraLanguage';
import {
  markdownEditorBlockLineClasses,
  noteMarkdownParserExtensions,
} from '../../editor/noteEditor/markdownEditorStyling';
import {
  buildTodayHubCellStaticViewModel,
  clipSegmentsToRange,
} from './todayHubCellStaticView';

const RESOLVE = {
  wikiTargetIsResolved: () => false,
  relativeMarkdownLinkHrefIsResolved: () => false,
};

const TREE_MS = 200;

function lineClassesDirect(cellText: string): Map<number, Set<string>> {
  const state = EditorState.create({
    doc: cellText,
    extensions: [
      markdownEskerra({
        base: commonmarkLanguage,
        extensions: noteMarkdownParserExtensions,
      }),
    ],
  });
  ensureSyntaxTree(state, cellText.length, TREE_MS);
  return markdownEditorBlockLineClasses(state.doc, syntaxTree(state));
}

describe('todayHubCellStaticView', () => {
  it('buildTodayHubCellStaticViewModel line classes match markdownEditorBlockLineClasses', () => {
    const cellText = '# Title\n\nfirst row\n\n## Sub\n\nbody';
    const direct = lineClassesDirect(cellText);
    const {lines} = buildTodayHubCellStaticViewModel(cellText, RESOLVE);
    expect(lines.length).toBeGreaterThan(4);
    for (const line of lines) {
      const expected = direct.get(line.from);
      const expectedStr = expected && expected.size > 0 ? [...expected].sort().join(' ') : '';
      let actualStr = line.lineClassName;
      if (line.lineClassName === 'cm-line') {
        actualStr = '';
      } else if (line.lineClassName.startsWith('cm-line ')) {
        actualStr = line.lineClassName.slice('cm-line '.length);
      }
      expect(actualStr).toBe(expectedStr);
    }
  });

  it('clipSegmentsToRange keeps overlaps inside the range', () => {
    const segments = [
      {from: 0, to: 5, className: 'a'},
      {from: 4, to: 10, className: 'b'},
    ];
    expect(clipSegmentsToRange(segments, 3, 8)).toEqual([
      {from: 3, to: 5, className: 'a'},
      {from: 4, to: 8, className: 'b'},
    ]);
    expect(clipSegmentsToRange(segments, 10, 10)).toEqual([]);
  });
});

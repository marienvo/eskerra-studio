import {commonmarkLanguage} from '@codemirror/lang-markdown';
import {
  codeFolding,
  ensureSyntaxTree,
  foldable,
  LanguageDescription,
  syntaxTree,
} from '@codemirror/language';
import {EditorState} from '@codemirror/state';
import {EditorView, RectangleMarker, drawSelection} from '@codemirror/view';
import {highlightTree} from '@lezer/highlight';
import {afterEach, beforeAll, describe, expect, it, vi} from 'vitest';

import {
  MarkdownFenceBlockBackgroundMarker,
  collectMarkdownCodeBackgroundMarkers,
  markdownCodeBackgroundLayer,
  markdownFenceBlockBackgroundClass,
} from './markdownCodeBackgroundLayer';
import {
  markdownEditorBlockLineClasses,
  noteMarkdownEditorAppearance,
  noteMarkdownHighlightStyle,
  noteMarkdownListItemFoldService,
  noteMarkdownNestedCodeHighlighter,
  noteMarkdownParserExtensions,
} from './markdownEditorStyling';
import {eskerraFenceLanguages} from './eskerraFenceLanguages';
import {markdownEskerra} from './markdownEskerraLanguage';

beforeAll(async () => {
  const ts = LanguageDescription.matchLanguageName(eskerraFenceLanguages, 'ts', true);
  if (!(ts instanceof LanguageDescription)) {
    throw new Error('Expected TypeScript in eskerraFenceLanguages');
  }
  await ts.load();
});

describe('eskerraFenceLanguages', () => {
  it('preserves full fenced-language coverage for common markdown fence labels', async () => {
    const labels = ['java', 'cpp', 'php', 'vue', 'angular', 'liquid', 'wast'];
    for (const label of labels) {
      const language = LanguageDescription.matchLanguageName(eskerraFenceLanguages, label, true);
      expect(language, `expected fence language for ${label}`).toBeInstanceOf(LanguageDescription);
      await (language as LanguageDescription).load();
    }
  });

  it('loads HTML fences with the dedicated HTML parser', async () => {
    for (const label of ['html', 'hbs', 'handlebars']) {
      const language = LanguageDescription.matchLanguageName(eskerraFenceLanguages, label, true);
      expect(language).toBeInstanceOf(LanguageDescription);
      const support = await (language as LanguageDescription).load();
      const state = EditorState.create({
        doc: '<script>const x = 1</script>',
        extensions: support,
      });
      let hasScriptNode = false;
      syntaxTree(state).iterate({
        enter: node => {
          if (node.name === 'Script') {
            hasScriptNode = true;
          }
        },
      });
      expect(hasScriptNode).toBe(true);
    }
  });
});

function classTokens(classStr: string | undefined): string[] {
  return classStr ? classStr.trim().split(/\s+/).filter(Boolean) : [];
}

function innermostHighlightAt(
  docText: string,
  pos: number,
  highlighters: Parameters<typeof highlightTree>[1],
  useCodeLanguages: boolean,
): string | undefined {
  const state = EditorState.create({
    doc: docText,
    extensions: markdownEskerra({
      base: commonmarkLanguage,
      extensions: noteMarkdownParserExtensions,
      ...(useCodeLanguages ? {codeLanguages: eskerraFenceLanguages} : {}),
    }),
  });
  const tree = ensureSyntaxTree(state, state.doc.length, 20_000);
  expect(tree).not.toBeNull();
  let bestLen = Infinity;
  let bestCls: string | undefined;
  highlightTree(tree!, highlighters, (from, to, classes) => {
    if (pos >= from && pos < to) {
      const len = to - from;
      if (len < bestLen) {
        bestLen = len;
        bestCls = classes;
      }
    }
  });
  return bestCls;
}

function lineClassSets(md: string): Record<number, string[]> {
  const state = EditorState.create({
    doc: md,
    extensions: markdownEskerra({
      base: commonmarkLanguage,
      extensions: noteMarkdownParserExtensions,
    }),
  });
  const tree = ensureSyntaxTree(state, state.doc.length, 5000);
  expect(tree).not.toBeNull();
  const map = markdownEditorBlockLineClasses(state.doc, tree!);
  const out: Record<number, string[]> = {};
  for (const [lineFrom, set] of map.entries()) {
    const line = state.doc.lineAt(lineFrom);
    out[line.number] = [...set].sort();
  }
  return out;
}

function innermostHighlightClassAt(docText: string, pos: number): string | undefined {
  const state = EditorState.create({
    doc: docText,
    extensions: markdownEskerra({
      base: commonmarkLanguage,
      extensions: noteMarkdownParserExtensions,
    }),
  });
  const tree = ensureSyntaxTree(state, state.doc.length, 5000);
  expect(tree).not.toBeNull();
  let bestLen = Infinity;
  let bestCls: string | undefined;
  highlightTree(tree!, noteMarkdownHighlightStyle, (from, to, classes) => {
    if (pos >= from && pos < to) {
      const len = to - from;
      if (len < bestLen) {
        bestLen = len;
        bestCls = classes;
      }
    }
  });
  return bestCls;
}

function highlightClassesOverlapping(docText: string, from: number, to: number): string[] {
  const state = EditorState.create({
    doc: docText,
    extensions: markdownEskerra({
      base: commonmarkLanguage,
      extensions: noteMarkdownParserExtensions,
    }),
  });
  const tree = ensureSyntaxTree(state, state.doc.length, 5000);
  expect(tree).not.toBeNull();
  const out: string[] = [];
  highlightTree(tree!, noteMarkdownHighlightStyle, (f, t, classes) => {
    if (t > from && f < to) {
      out.push(classes);
    }
  });
  return out;
}

describe('noteMarkdown list highlighting', () => {
  it('does not apply cm-md-list to list item body text (Lezer tags.list scope)', () => {
    const doc = '- hello there';
    const from = doc.indexOf('h');
    const to = from + 1;
    const overlapping = highlightClassesOverlapping(doc, from, to);
    expect(overlapping.some(c => c.includes('cm-md-list'))).toBe(false);
  });

  it('applies cm-md-list-mark to the list marker token', () => {
    const doc = '- item';
    const cls = innermostHighlightClassAt(doc, 0);
    expect(cls).toContain('cm-md-list-mark');
  });
});

describe('noteMarkdownListItemFoldService', () => {
  const foldExtensions = [
    markdownEskerra({
      base: commonmarkLanguage,
      extensions: noteMarkdownParserExtensions,
    }),
    codeFolding(),
    noteMarkdownListItemFoldService,
  ];

  it('returns a fold range for a multi-line list item', () => {
    const state = EditorState.create({
      doc: '- first\n  second',
      extensions: foldExtensions,
    });
    ensureSyntaxTree(state, state.doc.length, 5000);
    const line1 = state.doc.line(1);
    expect(foldable(state, line1.from, line1.to)).toEqual({
      from: line1.to,
      to: state.doc.length,
    });
  });

  it('does not fold a single-line list item', () => {
    const state = EditorState.create({
      doc: '- only',
      extensions: foldExtensions,
    });
    ensureSyntaxTree(state, state.doc.length, 5000);
    const line1 = state.doc.line(1);
    expect(foldable(state, line1.from, line1.to)).toBeNull();
  });
});

// List line alignment and soft-wrap are CSS-only (`App.css`); validate visually in WebKitGTK when editing those rules.
describe('markdownEditorBlockLineClasses', () => {
  it('tags bullet list marker vs continuation lines', () => {
    const byLine = lineClassSets('- first line\n  continued here');
    expect(byLine[1]).toEqual(
      [
        'cm-md-list-line',
        'cm-md-list-line--bullet',
        'cm-md-list-line--mark',
      ].sort(),
    );
    expect(byLine[2]).toEqual(
      [
        'cm-md-list-line',
        'cm-md-list-line--bullet',
        'cm-md-list-line--continue',
      ].sort(),
    );
  });

  it('tags ordered list marker vs continuation lines', () => {
    const byLine = lineClassSets('1. first line\n   continued here');
    expect(byLine[1]?.includes('cm-md-list-line--ordered')).toBe(true);
    expect(byLine[1]?.includes('cm-md-list-line--mark')).toBe(true);
    expect(byLine[2]?.includes('cm-md-list-line--ordered')).toBe(true);
    expect(byLine[2]?.includes('cm-md-list-line--continue')).toBe(true);
  });

  it('treats nested bullet item first line as mark, not continue', () => {
    const byLine = lineClassSets('- outer\n  - inner');
    expect(byLine[1]?.includes('cm-md-list-line--mark')).toBe(true);
    expect(byLine[2]?.includes('cm-md-list-line--mark')).toBe(true);
    expect(byLine[2]?.includes('cm-md-list-line--continue')).toBe(false);
    expect(byLine[1]?.includes('cm-md-list-line')).toBe(true);
    expect(byLine[2]?.includes('cm-md-list-line--bullet')).toBe(true);
    expect(byLine[1]?.includes('cm-md-list-line--nest-1')).toBe(false);
    expect(byLine[2]?.includes('cm-md-list-line--nest-1')).toBe(true);
  });

  it('tags horizontal rule lines', () => {
    const byLine = lineClassSets('before\n\n---\nafter');
    expect(byLine[3]?.includes('cm-md-hr-line')).toBe(true);
  });

  it('tags bullet lines with multiple ListMark nodes so markers do not stack visually', () => {
    const byLine = lineClassSets('- - - mistake');
    expect(byLine[1]?.includes('cm-md-list-line--multi-bullet-mark')).toBe(true);
  });

  it('does not tag a normal task list line as multi-bullet (ListMark + TaskMarker)', () => {
    const byLine = lineClassSets('- [ ] todo');
    expect(byLine[1]?.includes('cm-md-list-line--multi-bullet-mark')).toBe(false);
  });
});

describe('noteMarkdown horizontal rule highlighting', () => {
  it('applies cm-md-hr to the rule token', () => {
    const doc = 'x\n\n---\ny';
    const pos = doc.indexOf('-');
    expect(innermostHighlightClassAt(doc, pos)).toContain('cm-md-hr');
  });
});

describe('noteMarkdown percent-muted highlighting', () => {
  it('applies cm-md-percent-mark to %% delimiters and cm-md-percent-muted to inner span', () => {
    const doc = '%%muted%%';
    expect(innermostHighlightClassAt(doc, 0)).toContain('cm-md-percent-mark');
    expect(innermostHighlightClassAt(doc, 2)).toContain('cm-md-percent-muted');
    expect(innermostHighlightClassAt(doc, doc.length - 2)).toContain('cm-md-percent-mark');
  });
});

describe('noteMarkdown equal-highlight highlighting', () => {
  it('applies cm-md-equal-highlight-mark to == delimiters and cm-md-equal-highlight to inner span', () => {
    const doc = '==x==';
    expect(innermostHighlightClassAt(doc, 0)).toContain('cm-md-equal-highlight-mark');
    expect(innermostHighlightClassAt(doc, 2)).toContain('cm-md-equal-highlight');
    expect(innermostHighlightClassAt(doc, doc.length - 2)).toContain('cm-md-equal-highlight-mark');
  });
});

describe('noteMarkdown fenced CodeInfo (fence language id)', () => {
  it('maps opening fence info to cm-md-fence-info', () => {
    const doc = '```ts\nx\n```';
    const pos = doc.indexOf('ts');
    expect(pos).toBeGreaterThanOrEqual(0);
    expect(innermostHighlightClassAt(doc, pos)).toContain('cm-md-fence-info');
  });
});

describe('markdownCodeBackgroundLayer markers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('emits one fence marker per fenced block and at least one inline marker per inline code', async () => {
    const doc = '`foo`\n\n```ts\nconst x = 1\n```';
    const parent = document.createElement('div');
    parent.style.width = '800px';
    parent.style.height = '600px';
    document.body.append(parent);
    const state = EditorState.create({
      doc,
      extensions: [
        markdownEskerra({
          base: commonmarkLanguage,
          extensions: noteMarkdownParserExtensions,
          codeLanguages: eskerraFenceLanguages,
        }),
        ...noteMarkdownEditorAppearance,
        drawSelection(),
        markdownCodeBackgroundLayer,
      ],
    });
    const view = new EditorView({state, parent});
    try {
      const stubRect = {
        top: 20,
        bottom: 36,
        left: 40,
        right: 120,
        width: 80,
        height: 16,
        x: 40,
        y: 20,
        toJSON: () => '',
      };
      vi.spyOn(view, 'coordsAtPos').mockReturnValue(stubRect as DOMRect);

      ensureSyntaxTree(view.state, view.state.doc.length, 20_000);
      let inlineCodeNodes = 0;
      syntaxTree(view.state).iterate({
        enter(c) {
          if (c.name === 'InlineCode') {
            inlineCodeNodes++;
          }
        },
      });
      expect(inlineCodeNodes, 'syntax tree should contain InlineCode').toBeGreaterThan(0);

      expect(
        view.viewport,
        `viewport should cover inline code at start of doc; got ${JSON.stringify(view.viewport)}`,
      ).toMatchObject({from: 0});
      expect(view.viewport.to).toBeGreaterThan(0);

      const markers = collectMarkdownCodeBackgroundMarkers(view);
      const fence = markers.filter(m => m instanceof MarkdownFenceBlockBackgroundMarker);
      const nonFence = markers.filter(m => !(m instanceof MarkdownFenceBlockBackgroundMarker));
      expect(fence.length).toBe(1);
      expect(nonFence.length).toBeGreaterThanOrEqual(1);

      expect(view.dom.querySelector('.cm-md-codeBackgroundLayer')).not.toBeNull();
      await vi.waitFor(
        () =>
          (view.dom
            .querySelector('.cm-md-codeBackgroundLayer')
            ?.querySelectorAll(`.${markdownFenceBlockBackgroundClass}`).length
            ?? 0)
          >= 1,
        {interval: 5, timeout: 3000},
      );
      await vi.waitFor(
        () =>
          (view.dom.querySelector('.cm-md-codeBackgroundLayer')?.querySelectorAll('.cm-md-inline-code-bg').length
            ?? 0)
          >= 1,
        {interval: 5, timeout: 3000},
      );
    } finally {
      view.destroy();
      parent.remove();
    }
  });

  /* Regression: after switching notes, `LayerView.draw` reused an inline-code-pill DOM element for a
   * fence marker because `MarkdownFenceBlockBackgroundMarker.update` returned `true` regardless of
   * `prev` type. Result was a pill at the previous note's left/width but stretched to fence height. */
  it('fence marker refuses to reuse a non-fence marker DOM element', () => {
    const elt = document.createElement('div');
    elt.className = 'cm-md-inline-code-bg';
    elt.style.left = '200px';
    elt.style.top = '50px';
    elt.style.width = '80px';
    elt.style.height = '20px';
    const prevInlinePill = new RectangleMarker(
      'cm-md-inline-code-bg',
      200,
      50,
      80,
      20,
    );
    const nextFence = new MarkdownFenceBlockBackgroundMarker(10, 400, 30, 720);

    expect(nextFence.update(elt, prevInlinePill)).toBe(false);
    expect(elt.style.left).toBe('200px');
    expect(elt.style.width).toBe('80px');
    expect(elt.style.top).toBe('50px');
    expect(elt.style.height).toBe('20px');
  });

  it('fence marker reuses another fence marker DOM element and updates all 4 dimensions', () => {
    const elt = document.createElement('div');
    elt.className = markdownFenceBlockBackgroundClass;
    elt.style.top = '10px';
    elt.style.height = '400px';
    elt.style.left = '30px';
    elt.style.width = '720px';
    const prevFence = new MarkdownFenceBlockBackgroundMarker(10, 400, 30, 720);
    const nextFence = new MarkdownFenceBlockBackgroundMarker(120, 80, 35, 700);

    expect(nextFence.update(elt, prevFence)).toBe(true);
    expect(elt.className).toBe(markdownFenceBlockBackgroundClass);
    expect(elt.style.top).toBe('120px');
    expect(elt.style.height).toBe('80px');
    expect(elt.style.left).toBe('35px');
    expect(elt.style.width).toBe('700px');
  });

  it('fence marker update restores class when reusing a fence element', () => {
    const elt = document.createElement('div');
    elt.className = 'stale-wrong-class';
    elt.style.top = '10px';
    elt.style.height = '400px';
    elt.style.left = '30px';
    elt.style.width = '720px';
    const prevFence = new MarkdownFenceBlockBackgroundMarker(10, 400, 30, 720);
    const nextFence = new MarkdownFenceBlockBackgroundMarker(120, 80, 35, 700);

    expect(nextFence.update(elt, prevFence)).toBe(true);
    expect(elt.className).toBe(markdownFenceBlockBackgroundClass);
  });

  /* Regression: `.cm-md-codeBackgroundLayer` (`.cm-layer`) has `contain: size` and no explicit width,
   * so the descendant containing block is 0-wide. The previous CSS `left: 0; right: 0;` rendered
   * fence-bg as a 1-2px vertical stripe on the left. The marker must set explicit `left`/`width`. */
  it('fence marker draws with explicit left and width inline styles', () => {
    const marker = new MarkdownFenceBlockBackgroundMarker(10, 400, 30, 720);
    const el = marker.draw();
    expect(el.className).toBe(markdownFenceBlockBackgroundClass);
    expect(el.style.top).toBe('10px');
    expect(el.style.height).toBe('400px');
    expect(el.style.left).toBe('30px');
    expect(el.style.width).toBe('720px');
  });
});

describe('noteMarkdown code fence and inline code highlighting', () => {
  it('inline code inner uses cm-md-code-text without nested cm-md-code', () => {
    const doc = '`x`';
    const pos = doc.indexOf('x');
    const cls = innermostHighlightAt(doc, pos, noteMarkdownHighlightStyle, false);
    expect(classTokens(cls)).toContain('cm-md-code-text');
    expect(classTokens(cls)).not.toContain('cm-md-code');
  });

  it('fenced TypeScript highlights keywords and avoids inline-code pill class on body', () => {
    const doc = '```ts\nconst a = 1;\n```';
    const posConst = doc.indexOf('const');
    const clsKeyword = innermostHighlightAt(
      doc,
      posConst,
      [noteMarkdownHighlightStyle, noteMarkdownNestedCodeHighlighter],
      true,
    );
    expect(
      classTokens(clsKeyword).some(
        c => c === 'cm-md-code-hl-keyword' || c === 'cm-md-code-hl-definition-keyword',
      ),
    ).toBe(true);
    expect(classTokens(clsKeyword)).not.toContain('cm-md-code');

    const posDigit = doc.indexOf('1');
    const clsDigit = innermostHighlightAt(
      doc,
      posDigit,
      [noteMarkdownHighlightStyle, noteMarkdownNestedCodeHighlighter],
      true,
    );
    expect(classTokens(clsDigit).some(c => c === 'cm-md-code-text' || c.startsWith('cm-md-code-hl'))).toBe(
      true,
    );
    expect(classTokens(clsDigit)).not.toContain('cm-md-code');
  });

  it('fenced Java also gets nested parsing/highlighting via the shared language registry', () => {
    const doc = '```java\nclass Demo {}\n```';
    const posClass = doc.indexOf('class');
    const clsKeyword = innermostHighlightAt(
      doc,
      posClass,
      [noteMarkdownHighlightStyle, noteMarkdownNestedCodeHighlighter],
      true,
    );
    expect(
      classTokens(clsKeyword).some(
        c => c === 'cm-md-code-hl-keyword' || c === 'cm-md-code-hl-definition-keyword',
      ),
    ).toBe(true);
    expect(classTokens(clsKeyword)).not.toContain('cm-md-code');
  });
});

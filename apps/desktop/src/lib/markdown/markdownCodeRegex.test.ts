import {describe, expect, it} from 'vitest';

import {
  findFencedCodeSpans,
  transformMarkdownPreservingFencedCode,
} from './markdownCodeRegex';

describe('findFencedCodeSpans', () => {
  it('finds a triple-backtick block', () => {
    const md = 'before\n```\nline\n```\nafter';
    expect(findFencedCodeSpans(md)).toEqual([{start: 7, end: 20}]);
    expect(md.slice(7, 20)).toBe('```\nline\n```\n');
  });

  it('finds a four-backtick block', () => {
    const md = '````\n```not a fence```\n````';
    expect(findFencedCodeSpans(md)).toEqual([{start: 0, end: md.length}]);
  });

  it('finds multiple blocks in order', () => {
    const md = '```\na\n```\n\n````\nb\n````';
    const spans = findFencedCodeSpans(md);
    expect(spans).toHaveLength(2);
    expect(md.slice(spans[0]!.start, spans[0]!.end)).toBe('```\na\n```\n');
    expect(md.slice(spans[1]!.start, spans[1]!.end)).toBe('````\nb\n````');
  });

  it('ignores unclosed fences', () => {
    expect(findFencedCodeSpans('```\nno close')).toEqual([]);
  });

  it('ignores inline triple backticks on the same line', () => {
    expect(findFencedCodeSpans('use ``` inline')).toEqual([]);
  });
});

describe('transformMarkdownPreservingFencedCode', () => {
  it('skips fenced regions', () => {
    const md = 'prose :joy:\n````\n:joy:\n````\nmore :joy:';
    const out = transformMarkdownPreservingFencedCode(md, segment =>
      segment.replace(/:joy:/g, '😂'),
    );
    expect(out).toBe('prose 😂\n````\n:joy:\n````\nmore 😂');
  });
});

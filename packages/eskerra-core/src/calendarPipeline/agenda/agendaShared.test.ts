import {describe, expect, it} from 'vitest';
import {splitFrontmatter} from './agendaShared';

describe('splitFrontmatter', () => {
  it('extracts frontmatter and body from a standard block', () => {
    const md = '---\nkey: value\n---\nbody text';
    expect(splitFrontmatter(md)).toEqual({frontmatter: '---\nkey: value\n---', body: 'body text'});
  });

  it('returns empty frontmatter when there is no opening ---', () => {
    const md = 'no frontmatter here';
    expect(splitFrontmatter(md)).toEqual({frontmatter: '', body: md});
  });

  it('returns empty frontmatter when there is no closing ---', () => {
    const md = '---\nkey: value\n';
    expect(splitFrontmatter(md)).toEqual({frontmatter: '', body: md});
  });

  it('handles an empty frontmatter block (---\\n---)', () => {
    const md = '---\n---\nbody';
    expect(splitFrontmatter(md)).toEqual({frontmatter: '---\n---', body: 'body'});
  });

  it('handles optional BOM', () => {
    const md = '﻿---\nk: v\n---\nbody';
    const {frontmatter, body} = splitFrontmatter(md);
    expect(frontmatter).toBe('﻿---\nk: v\n---');
    expect(body).toBe('body');
  });

  it('stops at the first closing --- when the body itself contains ---', () => {
    const md = '---\nfoo: bar\n---\nbaz: ---\n---\nmore body';
    expect(splitFrontmatter(md)).toEqual({frontmatter: '---\nfoo: bar\n---', body: 'baz: ---\n---\nmore body'});
  });

  it('tolerates trailing spaces on the opening ---', () => {
    const md = '---   \nkey: value\n---\nbody';
    expect(splitFrontmatter(md)).toEqual({frontmatter: '---   \nkey: value\n---', body: 'body'});
  });

  it('returns empty body when block ends without trailing newline', () => {
    const md = '---\nkey: value\n---';
    expect(splitFrontmatter(md)).toEqual({frontmatter: '---\nkey: value\n---', body: ''});
  });
});

import {describe, expect, it} from 'vitest';

import {decodeCellEscapes, tokenizeDelimitedRowInner} from './tokenize';

describe('tokenizeDelimitedRowInner', () => {
  it('splits on unescaped pipes and decodes \\| in cells', () => {
    const tokens = tokenizeDelimitedRowInner('a\\|b|c');
    expect(tokens).toHaveLength(2);
    expect(tokens[0]).toEqual({
      rawStart: 0,
      rawEnd: 4,
      raw: 'a\\|b',
      value: 'a|b',
    });
    expect(tokens[1]).toEqual({
      rawStart: 5,
      rawEnd: 6,
      raw: 'c',
      value: 'c',
    });
  });

  it('preserves backslashes that are not followed by pipe', () => {
    const tokens = tokenizeDelimitedRowInner('a\\b');
    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.value).toBe('a\\b');
  });

  it('preserves doubled backslashes as literal text', () => {
    expect(decodeCellEscapes('a\\\\b')).toBe('a\\\\b');
  });

  it('decodes escaped pipes while preserving preceding literal backslashes', () => {
    expect(decodeCellEscapes('has \\\\| pipe')).toBe('has \\| pipe');
  });
});

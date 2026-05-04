import {describe, expect, it} from 'vitest';

import {trimTrailingSlashes} from './trimTrailingSlashes';

describe('trimTrailingSlashes', () => {
  it('returns strings without trailing slash unchanged', () => {
    expect(trimTrailingSlashes('')).toBe('');
    expect(trimTrailingSlashes('hello')).toBe('hello');
    expect(trimTrailingSlashes('a/b/c')).toBe('a/b/c');
  });

  it('strips trailing forward slashes only', () => {
    expect(trimTrailingSlashes('hello/')).toBe('hello');
    expect(trimTrailingSlashes('hello//')).toBe('hello');
    expect(trimTrailingSlashes('a/b/')).toBe('a/b');
    expect(trimTrailingSlashes('a/b\\')).toBe('a/b\\');
  });

  it('preserves existing slash-only semantics', () => {
    expect(trimTrailingSlashes('/')).toBe('');
    expect(trimTrailingSlashes('//')).toBe('');
    expect(trimTrailingSlashes('///')).toBe('');
  });
});

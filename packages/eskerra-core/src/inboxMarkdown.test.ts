import {describe, expect, it} from 'vitest';

import {sanitizeInboxNoteStem} from './inboxMarkdown';

describe('sanitizeInboxNoteStem', () => {
  it('strips Windows-illegal chars', () => {
    expect(sanitizeInboxNoteStem('a:b*c?d"e<f>g|h')).toBe('abcdefgh');
  });

  it('strips straight apostrophe', () => {
    expect(sanitizeInboxNoteStem("John's notes")).toBe('Johns notes');
  });

  it('strips curly right single quote (U+2019)', () => {
    expect(sanitizeInboxNoteStem('John’s notes')).toBe('Johns notes');
  });

  it('strips curly left single quote (U+2018)', () => {
    expect(sanitizeInboxNoteStem('‘quoted’')).toBe('quoted');
  });

  it('strips curly double quotes (U+201C U+201D)', () => {
    expect(sanitizeInboxNoteStem('“hello world”')).toBe('hello world');
  });

  it('strips backtick', () => {
    expect(sanitizeInboxNoteStem('cmd `foo` bar')).toBe('cmd foo bar');
  });

  it('collapses multiple spaces after stripping', () => {
    expect(sanitizeInboxNoteStem("it's  fine")).toBe('its fine');
  });

  it('returns null for stem that is empty after sanitization', () => {
    expect(sanitizeInboxNoteStem("'`'’")).toBeNull();
  });

  it('preserves normal alphanumeric + hyphen + underscore', () => {
    expect(sanitizeInboxNoteStem('my-note_2024')).toBe('my-note_2024');
  });
});

import {describe, expect, it} from 'vitest';

import {clean} from './testUtils';

describe('cleanNoteMarkdownBody structure', () => {
  it('inserts filename as H1 and limits heading jumps', () => {
    const input = ['### Deep heading', '', 'Paragraph text.'].join('\n');
    const output = clean(input, '/tmp/My note.md');
    expect(output.startsWith('# My note\n')).toBe(true);
    expect(output).toContain('\n## Deep heading\n');
  });

  it('skips inserted H1 when insertH1FromFilename is false', () => {
    const input = ['### Deep heading', '', 'Paragraph text.'].join('\n');
    const output = clean(input, '/tmp/My note.md', {
      insertH1FromFilename: false,
    });
    expect(output).toContain('### Deep heading');
    expect(output).not.toContain('# My note');
  });

  it('ensures blank lines around structural blocks', () => {
    const input = [
      '# Title',
      '> quote',
      '```ts',
      'const a = 1;',
      '```',
      '---',
      '| a | b |',
      '| --- | --- |',
      '| 1 | 2 |',
    ].join('\n');

    const output = clean(input, '/tmp/Blocks.md');
    expect(output).toContain('# Title\n\n> quote\n\n```ts');
    expect(output).toContain('```\n\n---\n\n| a | b |');
    expect(output.endsWith('\n')).toBe(true);
  });

  it('preserves a leading blank line', () => {
    const input = ['', '# Title', '', 'Paragraph text.'].join('\n');
    const output = clean(input, '/tmp/LeadingBlank.md');
    expect(output.startsWith('\n# Title\n')).toBe(true);
    expect(output.endsWith('\n')).toBe(true);
  });

  it('is idempotent', () => {
    const input = ['## H2', '', 'Text with  double  spaces.', '', '-  [ ]  item'].join('\n');
    const once = clean(input, '/tmp/Idempotent.md');
    const twice = clean(once, '/tmp/Idempotent.md');
    expect(twice).toBe(once);
  });

  it('is idempotent when input starts with a blank line', () => {
    const input = ['', '# T', '', 'Text with  double  spaces.', '', '-  [ ]  item'].join('\n');
    const once = clean(input, '/tmp/LeadingBlankIdempotent.md');
    const twice = clean(once, '/tmp/LeadingBlankIdempotent.md');
    expect(once.startsWith('\n# T\n')).toBe(true);
    expect(twice).toBe(once);
  });
});

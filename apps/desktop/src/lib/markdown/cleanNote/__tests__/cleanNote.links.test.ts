import {describe, expect, it} from 'vitest';

import {clean} from './testUtils';

describe('cleanNoteMarkdownBody links', () => {
  it('keeps quoted markdown links as links', () => {
    const input = ['# T', '', '> [label](https://example.com)'].join('\n');
    const output = clean(input, '/tmp/QuotedLink.md');
    expect(output).toContain('> [label](https://example.com)');
    expect(output).not.toContain('> \\[label]');
  });

  it('keeps bare URLs and emails as plain text', () => {
    const input = [
      '# T',
      '',
      'https://example.com',
      'contact@example.com',
      '[ spaced link ](https://example.com)',
    ].join('\n');
    const output = clean(input, '/tmp/Autolinks.md');
    expect(output).toContain('https://example.com');
    expect(output).toContain('contact@example.com');
    expect(output).not.toContain('<https://example.com>');
    expect(output).not.toContain('<contact@example.com>');
    expect(output).toContain('[spaced link](https://example.com)');
  });

  it('does not escape ampersands in URL destinations', () => {
    const input = [
      '# T',
      '',
      '[Query](https://example.com/?one=1&two=2&three=3)',
      '![Asset](https://example.com/image.png?x=10&y=20)',
      '[ref]: https://example.com/docs?alpha=1&beta=2',
      '',
      '[Reference][ref]',
    ].join('\n');

    const output = clean(input, '/tmp/UrlAmpersands.md');
    expect(output).toContain('[Query](https://example.com/?one=1&two=2&three=3)');
    expect(output).toContain('![Asset](https://example.com/image.png?x=10&y=20)');
    expect(output).toContain('[ref]: https://example.com/docs?alpha=1&beta=2');
    expect(output).not.toContain('\\&');
  });

  it('does not escape ordinary ampersands in text', () => {
    const input = [
      '# A&B',
      '',
      'AT&T and R&D',
      '',
      '- Fish & chips',
      '',
      '> Salt & pepper',
      '',
      '| Left | Right |',
      '| ---- | ----- |',
      '| A & B | C & D |',
      '',
      'Literal \\&copy; stays literal',
    ].join('\n');

    const output = clean(input, '/tmp/TextAmpersands.md');
    expect(output).toContain('# A&B');
    expect(output).toContain('AT&T and R&D');
    expect(output).toContain('- Fish & chips');
    expect(output).toContain('> Salt & pepper');
    expect(output).toContain('| A & B | C & D |');
    expect(output).toContain('Literal \\&copy; stays literal');
  });
});

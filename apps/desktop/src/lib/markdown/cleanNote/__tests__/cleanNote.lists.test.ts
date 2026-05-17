import {describe, expect, it} from 'vitest';

import {clean} from './testUtils';

describe('cleanNoteMarkdownBody lists', () => {
  it('normalizes list markers, spacing, and link text', () => {
    const input = [
      '*  [X]   Task one  ',
      '+ plain item',
      '  - nested child',
      '-',
      '- [ ]',
      '',
      'This  line   has   extra   spaces.',
      '[ spaced link ](https://example.com)',
      '[[ spaced wiki ]]',
    ].join('\n');

    const output = clean(input, '/tmp/Doc.md');
    expect(output).toContain('- [x] Task one');
    expect(output).toContain('- plain item');
    expect(output).toContain('\t- nested child');
    expect(output).not.toContain('\\- nested child');
    expect(output).not.toMatch(/^[\t ]*-\t+/m);
    expect(output).not.toMatch(/^[\t ]*- {2,}\S/m);
    expect(output).not.toContain('\n-\n');
    expect(output).toContain('This line has extra spaces.');
    expect(output).toContain('[spaced link](https://example.com)');
    expect(output).toContain('[[spaced wiki]]');
  });

  it('uses alternate bullet when bullet option is asterisk', () => {
    const input = ['- plain', '', '- [ ] task'].join('\n');
    const out = clean(input, '/tmp/B.md', {bullet: '*'});
    expect(out).toContain('* plain');
    expect(out).toMatch(/-\s+\[[ x]\]\s+task/);
  });

  it('unescapes nested bullet prefixes', () => {
    const input = ['# T', '', '- parent', '\t\\- child'].join('\n');
    const output = clean(input, '/tmp/Escaped.md');
    expect(output).toContain('\t- child');
    expect(output).not.toContain('\\- child');
  });

  it('enforces one space after bullet marker', () => {
    const input = [
      '# T',
      '',
      '- \t\titem a',
      '- \t item b',
      '\t-\t item c',
      '\t-\t\titem d',
      '- [x]\t\titem e',
      '\t- [ ] \t item f',
    ].join('\n');

    const output = clean(input, '/tmp/Spacing.md');
    expect(output).toContain('- item a');
    expect(output).toContain('- item b');
    expect(output).toContain('\t- item c');
    expect(output).toContain('\t- item d');
    expect(output).toContain('- [x] item e');
    expect(output).toContain('\t- [ ] item f');
    expect(output).not.toMatch(/^[\t ]*-[ \t]{2,}\S/m);
    expect(output).not.toMatch(/^[\t ]*-\t+\S/m);
  });

  it('normalizes deep nesting to one tab per level', () => {
    const input = [
      '# T',
      '',
      '- level0',
      '    - level1',
      '        - level2',
      '            - level3',
      '\t    - mixed-level2',
    ].join('\n');

    const output = clean(input, '/tmp/Deep.md');
    expect(output).toContain('- level0');
    expect(output).toContain('\t- level1');
    expect(output).toContain('\t\t- level2');
    expect(output).toContain('\t\t\t- level3');
    expect(output).toContain('\t\t- mixed-level2');
    expect(output).not.toMatch(/^ {4,}[-*+]\s/m);
    expect(output).not.toMatch(/^\t+ +[-*+]\s/m);
  });

  it('normalizes bullet spacing inside blockquotes', () => {
    const input = ['> -\t\titem a', '> \t- [x]\t item b'].join('\n');
    const output = clean(input, '/tmp/QuoteList.md');
    expect(output).toContain('> - item a');
    expect(output).toMatch(/>\s*-\s+\[x\] item b/);
    expect(output).not.toMatch(/>\s*-\t+/);
    expect(output).not.toMatch(/>\s*- {2,}\S/);
  });
});

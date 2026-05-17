import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';

import {
  CLEAN_PASTE_FRAGMENT_PLACEHOLDER_PATH,
  cleanNoteMarkdownBody,
  cleanPastedMarkdownFragment,
  resolveCleanNoteDefaults,
} from '..';

const __dirname = dirname(fileURLToPath(import.meta.url));

function readFixture(relPath: string): string {
  return readFileSync(join(__dirname, 'fixtures', relPath), 'utf8');
}

describe('cleanPastedMarkdownFragment', () => {
  it('does not inject H1 from filename for a real path', () => {
    const input = ['### Fragment', '', 'Body.'].join('\n');
    const out = cleanPastedMarkdownFragment(input, '/tmp/Real note.md');
    expect(out).toContain('### Fragment');
    expect(out).not.toContain('# Real note');
  });

  it('uses placeholder path when activeNotePath is null', () => {
    const input = '+ item';
    const out = cleanPastedMarkdownFragment(input, null);
    expect(out).toContain('- item');
    expect(out).not.toContain('# Untitled');
  });

  it('matches explicit cleanNoteMarkdownBody with insertH1FromFilename false', () => {
    const input = '* [ ] Task';
    const viaHelper = cleanPastedMarkdownFragment(input, null);
    const explicit = cleanNoteMarkdownBody(input, CLEAN_PASTE_FRAGMENT_PLACEHOLDER_PATH, {
      insertH1FromFilename: false,
    });
    expect(viaHelper).toBe(explicit);
  });
});

describe('cleanNoteMarkdownBody', () => {
  it('inserts filename as H1 and limits heading jumps', () => {
    const input = ['### Deep heading', '', 'Paragraph text.'].join('\n');

    const output = cleanNoteMarkdownBody(input, '/tmp/My note.md');
    expect(output.startsWith('# My note\n')).toBe(true);
    expect(output).toContain('\n## Deep heading\n');
  });

  it('skips inserted H1 when insertH1FromFilename is false', () => {
    const input = ['### Deep heading', '', 'Paragraph text.'].join('\n');
    const output = cleanNoteMarkdownBody(input, '/tmp/My note.md', {
      insertH1FromFilename: false,
    });
    expect(output).toContain('### Deep heading');
    expect(output).not.toContain('# My note');
  });

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

    const output = cleanNoteMarkdownBody(input, '/tmp/Doc.md');

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
    const out = cleanNoteMarkdownBody(input, '/tmp/B.md', {bullet: '*'});
    expect(out).toContain('* plain');
    expect(out).toMatch(/-\s+\[[ x]\]\s+task/);
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

    const output = cleanNoteMarkdownBody(input, '/tmp/Blocks.md');
    expect(output).toContain('# Title\n\n> quote\n\n```ts');
    expect(output).toContain('```\n\n---\n\n| a | b |');
    expect(output.endsWith('\n')).toBe(true);
  });

  it('preserves a leading blank line', () => {
    const input = ['', '# Title', '', 'Paragraph text.'].join('\n');

    const output = cleanNoteMarkdownBody(input, '/tmp/LeadingBlank.md');
    expect(output.startsWith('\n# Title\n')).toBe(true);
    expect(output.endsWith('\n')).toBe(true);
  });

  it('is idempotent', () => {
    const input = ['## H2', '', 'Text with  double  spaces.', '', '-  [ ]  item'].join(
      '\n',
    );
    const once = cleanNoteMarkdownBody(input, '/tmp/Idempotent.md');
    const twice = cleanNoteMarkdownBody(once, '/tmp/Idempotent.md');
    expect(twice).toBe(once);
  });

  it('is idempotent when input starts with a blank line', () => {
    const input = ['', '# T', '', 'Text with  double  spaces.', '', '-  [ ]  item'].join(
      '\n',
    );
    const once = cleanNoteMarkdownBody(input, '/tmp/LeadingBlankIdempotent.md');
    const twice = cleanNoteMarkdownBody(once, '/tmp/LeadingBlankIdempotent.md');
    expect(once.startsWith('\n# T\n')).toBe(true);
    expect(twice).toBe(once);
  });

  it('does not corrupt wiki links with two-digit token indexes', () => {
    const input = [
      '[[Link 0]]',
      '[[Link 1]]',
      '[[Link 2]]',
      '[[Link 3]]',
      '[[Link 4]]',
      '[[Link 5]]',
      '[[Link 6]]',
      '[[Link 7]]',
      '[[Link 8]]',
      '[[Link 9]]',
      '[[Link 10]]',
      '[[Link 11]]',
    ].join('\n');

    const output = cleanNoteMarkdownBody(input, '/tmp/Wiki.md');
    expect(output).toContain('[[Link 10]]');
    expect(output).toContain('[[Link 11]]');
    expect(output).not.toContain('[[Link 1]]0');
    expect(output).not.toContain(']]100');
  });

  it('unescapes nested bullet prefixes', () => {
    const input = ['# T', '', '- parent', '\t\\- child'].join('\n');

    const output = cleanNoteMarkdownBody(input, '/tmp/Escaped.md');
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

    const output = cleanNoteMarkdownBody(input, '/tmp/Spacing.md');

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

    const output = cleanNoteMarkdownBody(input, '/tmp/Deep.md');
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
    const output = cleanNoteMarkdownBody(input, '/tmp/QuoteList.md');
    expect(output).toContain('> - item a');
    expect(output).toMatch(/>\s*-\s+\[x\] item b/);
    expect(output).not.toMatch(/>\s*-\t+/);
    expect(output).not.toMatch(/>\s*- {2,}\S/);
  });

  it('preserves Obsidian admonition headers in blockquotes', () => {
    const input = [
      '# T',
      '',
      '> [!warning] Conflict backup: [[_autosync-backup-nuc/General/123--20260315-145001.md]]',
    ].join('\n');
    const output = cleanNoteMarkdownBody(input, '/tmp/AdmonitionWarning.md');
    expect(output).toContain(
      '> [!warning] Conflict backup: [[_autosync-backup-nuc/General/123--20260315-145001.md]]',
    );
    expect(output).not.toContain('> \\[!warning]');
  });

  it('preserves foldable and nested blockquote admonitions', () => {
    const input = ['# T', '', '> [!note]- Title', '> [!tip]+', '> > [!warning] Nested'].join(
      '\n',
    );
    const output = cleanNoteMarkdownBody(input, '/tmp/AdmonitionVariants.md');
    expect(output).toContain('> [!note]- Title');
    expect(output).toContain('> [!tip]+');
    expect(output).toContain('> > [!warning] Nested');
    expect(output).not.toContain('\\[!note]');
    expect(output).not.toContain('\\[!tip]');
    expect(output).not.toContain('\\[!warning]');
  });

  it('keeps quoted markdown links as links', () => {
    const input = ['# T', '', '> [label](https://example.com)'].join('\n');
    const output = cleanNoteMarkdownBody(input, '/tmp/QuotedLink.md');
    expect(output).toContain('> [label](https://example.com)');
    expect(output).not.toContain('> \\[label]');
  });

  it('preserves ==highlight== markup in list contexts', () => {
    const input = [
      '# T',
      '',
      '- ==Needs testing of 3 PRs==',
      '\t- ==nested highlight==',
      '> - ==quoted highlight==',
    ].join('\n');
    const output = cleanNoteMarkdownBody(input, '/tmp/Highlights.md');

    expect(output).toContain('==Needs testing of 3 PRs==');
    expect(output).toContain('==nested highlight==');
    expect(output).toContain('==quoted highlight==');
    expect(output).not.toContain('\\==');
  });

  it('preserves inline code before ==highlight== markup in checklist items', () => {
    const input = ['# T', '', '- ⬜️ `== of **` ==text=='].join('\n');
    const output = cleanNoteMarkdownBody(input, '/tmp/InlineCodeHighlight.md');

    expect(output).toContain('- ⬜️ `== of **` ==text==');
    expect(output).not.toContain('\\`== of **`');
  });

  it('preserves issue number hash tokens in checklist items', () => {
    const input = ['# T', '', '- [ ] 2026-03-13; \\#1037', '- [ ] 2026-03-14; #1038'].join(
      '\n',
    );

    const once = cleanNoteMarkdownBody(input, '/tmp/IssueHashes.md');
    const twice = cleanNoteMarkdownBody(once, '/tmp/IssueHashes.md');

    expect(once).toContain('- [ ] 2026-03-13; \\#1037');
    expect(once).toContain('- [ ] 2026-03-14; #1038');
    expect(twice).toBe(once);
  });

  it('does not alter ==highlight== text inside code fences', () => {
    const input = ['# T', '', '```md', '- ==inside fence==', '```'].join('\n');
    const output = cleanNoteMarkdownBody(input, '/tmp/FenceHighlights.md');
    expect(output).toContain('```md');
    expect(output).toContain('- ==inside fence==');
    expect(output).not.toContain('\\==inside fence==');
  });

  it('keeps bare URLs and emails as plain text', () => {
    const input = [
      '# T',
      '',
      'https://example.com',
      'contact@example.com',
      '[ spaced link ](https://example.com)',
    ].join('\n');

    const output = cleanNoteMarkdownBody(input, '/tmp/Autolinks.md');
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

    const output = cleanNoteMarkdownBody(input, '/tmp/UrlAmpersands.md');

    expect(output).toContain('[Query](https://example.com/?one=1&two=2&three=3)');
    expect(output).toContain('![Asset](https://example.com/image.png?x=10&y=20)');
    expect(output).toContain('[ref]: https://example.com/docs?alpha=1&beta=2');
    expect(output).not.toContain('\\&');
  });

  it('adds VS16 for emoji-variation bases and excludes ASCII keycap bases', () => {
    const input = [
      '# T',
      '',
      'plain ❌ and pre-colored ❌️',
      'number line 2026',
      'hash and star: # *',
      '`inline ❌ 2026 # *`',
      '```txt',
      'fence ❌ 2026 # *',
      '```',
    ].join('\n');

    const once = cleanNoteMarkdownBody(input, '/tmp/EmojiVariants.md');
    const twice = cleanNoteMarkdownBody(once, '/tmp/EmojiVariants.md');

    expect(once).toContain('plain ❌️ and pre-colored ❌️');
    expect(once).toContain('number line 2026');
    expect(once).toContain('hash and star: # \\*');
    expect(once).toContain('`inline ❌️ 2026 # *`');
    expect(once).toContain('fence ❌️ 2026 # *');
    expect(once).not.toContain('2️');
    expect(once).not.toContain('#️');
    expect(once).not.toContain('*️');
    expect(twice).toBe(once);
  });

  it('skips emoji VS16 when normalizeEmojiVs16 is false', () => {
    const input = ['# T', '', 'plain ❌'].join('\n');
    const out = cleanNoteMarkdownBody(input, '/tmp/NoEmoji.md', {
      normalizeEmojiVs16: false,
    });
    expect(out).toContain('plain ❌');
    expect(out).not.toContain('plain ❌️');
  });

  it('does not change wikilink targets during emoji normalization', () => {
    const input = [
      '# T',
      '',
      '[[❌ Project 2026]]',
      '[[❌ Project 2026|Alias]]',
      'plain ❌',
    ].join('\n');

    const output = cleanNoteMarkdownBody(input, '/tmp/WikilinkEmoji.md');
    expect(output).toContain('[[❌ Project 2026]]');
    expect(output).toContain('[[❌ Project 2026|Alias]]');
    expect(output).not.toContain('[[❌️ Project 2026]]');
    expect(output).not.toContain('[[❌️ Project 2026|Alias]]');
    expect(output).toContain('plain ❌️');
  });

  it('removes ZWJ between regional indicators in flags', () => {
    const input = ['# T', '', 'bad flag 🇲‍🇽 should be 🇲🇽', 'also ok already 🇲🇽', 'not a flag: x\u200Dy'].join(
      '\n',
    );

    const output = cleanNoteMarkdownBody(input, '/tmp/Flags.md');
    expect(output).toContain('bad flag 🇲🇽 should be 🇲🇽');
    expect(output).toContain('also ok already 🇲🇽');
    expect(output).toContain('not a flag: x\u200Dy');
  });
});

describe('cleanNoteMarkdownBody golden fixtures', () => {
  it('001-basic-normalization', () => {
    const input = readFixture('markdown/001-basic-normalization.input.md');
    const expected = readFixture('markdown/001-basic-normalization.expected.md');
    const actual = cleanNoteMarkdownBody(input, '/tmp/Fixture.md');

    expect(actual).toBe(expected);
  });

  it('002-link-ampersand', () => {
    const input = readFixture('markdown/002-link-ampersand.input.md');
    const expected = readFixture('markdown/002-link-ampersand.expected.md');
    const actual = cleanNoteMarkdownBody(input, '/tmp/Fixture.md');

    expect(actual).toBe(expected);
  });

  it('003-emoji-vs16-normalization', () => {
    const input = readFixture('markdown/003-emoji-vs16-normalization.input.md');
    const expected = readFixture('markdown/003-emoji-vs16-normalization.expected.md');
    const actual = cleanNoteMarkdownBody(input, '/tmp/Fixture.md');

    expect(actual).toBe(expected);
  });

  it('004-flag-zwj-normalization', () => {
    const input = readFixture('markdown/004-flag-zwj-normalization.input.md');
    const expected = readFixture('markdown/004-flag-zwj-normalization.expected.md');
    const actual = cleanNoteMarkdownBody(input, '/tmp/Fixture.md');

    expect(actual).toBe(expected);
  });

  it('005-code-block-whitespace', () => {
    const input = readFixture('markdown/005-code-block-whitespace.input.md');
    const expected = readFixture('markdown/005-code-block-whitespace.expected.md');
    const actual = cleanNoteMarkdownBody(input, '/tmp/Fixture.md');

    expect(actual).toBe(expected);
  });
});

describe('resolveCleanNoteDefaults', () => {
  it('fills defaults for empty input', () => {
    const d = resolveCleanNoteDefaults();
    expect(d.bullet).toBe('-');
    expect(d.insertH1FromFilename).toBe(true);
    expect(d.normalizeEmojiVs16).toBe(true);
  });
});

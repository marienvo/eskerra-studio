import {describe, expect, it} from 'vitest';

import {clean} from './testUtils';

describe('cleanNoteMarkdownBody emoji', () => {
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

    const once = clean(input, '/tmp/EmojiVariants.md');
    const twice = clean(once, '/tmp/EmojiVariants.md');

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
    const out = clean(input, '/tmp/NoEmoji.md', {
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

    const output = clean(input, '/tmp/WikilinkEmoji.md');
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

    const output = clean(input, '/tmp/Flags.md');
    expect(output).toContain('bad flag 🇲🇽 should be 🇲🇽');
    expect(output).toContain('also ok already 🇲🇽');
    expect(output).toContain('not a flag: x\u200Dy');
  });
});

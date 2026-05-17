import {describe, expect, it} from 'vitest';

import {
  CLEAN_PASTE_FRAGMENT_PLACEHOLDER_PATH,
  cleanNoteMarkdownBody,
  cleanPastedMarkdownFragment,
} from '..';

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

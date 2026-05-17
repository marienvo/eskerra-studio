import {describe, expect, it} from 'vitest';

import {clean} from './testUtils';

describe('cleanNoteMarkdownBody tokens', () => {
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

    const output = clean(input, '/tmp/Wiki.md');
    expect(output).toContain('[[Link 10]]');
    expect(output).toContain('[[Link 11]]');
    expect(output).not.toContain('[[Link 1]]0');
    expect(output).not.toContain(']]100');
  });

  it('preserves Obsidian admonition headers in blockquotes', () => {
    const input = [
      '# T',
      '',
      '> [!warning] Conflict backup: [[_autosync-backup-nuc/General/123--20260315-145001.md]]',
    ].join('\n');
    const output = clean(input, '/tmp/AdmonitionWarning.md');
    expect(output).toContain(
      '> [!warning] Conflict backup: [[_autosync-backup-nuc/General/123--20260315-145001.md]]',
    );
    expect(output).not.toContain('> \\[!warning]');
  });

  it('preserves foldable and nested blockquote admonitions', () => {
    const input = ['# T', '', '> [!note]- Title', '> [!tip]+', '> > [!warning] Nested'].join('\n');
    const output = clean(input, '/tmp/AdmonitionVariants.md');
    expect(output).toContain('> [!note]- Title');
    expect(output).toContain('> [!tip]+');
    expect(output).toContain('> > [!warning] Nested');
    expect(output).not.toContain('\\[!note]');
    expect(output).not.toContain('\\[!tip]');
    expect(output).not.toContain('\\[!warning]');
  });

  it('preserves ==highlight== markup in list contexts', () => {
    const input = [
      '# T',
      '',
      '- ==Needs testing of 3 PRs==',
      '\t- ==nested highlight==',
      '> - ==quoted highlight==',
    ].join('\n');
    const output = clean(input, '/tmp/Highlights.md');
    expect(output).toContain('==Needs testing of 3 PRs==');
    expect(output).toContain('==nested highlight==');
    expect(output).toContain('==quoted highlight==');
    expect(output).not.toContain('\\==');
  });

  it('preserves inline code before ==highlight== markup in checklist items', () => {
    const input = ['# T', '', '- ⬜️ `== of **` ==text=='].join('\n');
    const output = clean(input, '/tmp/InlineCodeHighlight.md');
    expect(output).toContain('- ⬜️ `== of **` ==text==');
    expect(output).not.toContain('\\`== of **`');
  });

  it('preserves issue number hash tokens in checklist items', () => {
    const input = ['# T', '', '- [ ] 2026-03-13; \\#1037', '- [ ] 2026-03-14; #1038'].join('\n');
    const once = clean(input, '/tmp/IssueHashes.md');
    const twice = clean(once, '/tmp/IssueHashes.md');
    expect(once).toContain('- [ ] 2026-03-13; \\#1037');
    expect(once).toContain('- [ ] 2026-03-14; #1038');
    expect(twice).toBe(once);
  });

  it('does not alter ==highlight== text inside code fences', () => {
    const input = ['# T', '', '```md', '- ==inside fence==', '```'].join('\n');
    const output = clean(input, '/tmp/FenceHighlights.md');
    expect(output).toContain('```md');
    expect(output).toContain('- ==inside fence==');
    expect(output).not.toContain('\\==inside fence==');
  });
});

import {describe, expect, it} from 'vitest';

import {protectHighlights, restoreHighlights} from '../tokenProtection';

describe('tokenProtection/protectHighlights', () => {
  it('does not tokenize == inside inline code spans', () => {
    const input = '- `== code ==` ==text==';
    const {text, tokens} = protectHighlights(input);
    const restored = restoreHighlights(text, tokens);

    expect(restored).toBe(input);
    expect(text).toContain('`== code ==`');
  });

  it('does not tokenize == inside fenced code blocks', () => {
    const input = ['```md', '- ==inside fence==', '```', '==outside=='].join('\n');
    const {text, tokens} = protectHighlights(input);
    const restored = restoreHighlights(text, tokens);

    expect(restored).toBe(input);
    expect(text).toContain('- ==inside fence==');
    expect(text).not.toContain('==outside==');
  });
});

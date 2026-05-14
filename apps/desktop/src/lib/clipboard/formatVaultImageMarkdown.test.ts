import {describe, expect, it} from 'vitest';

import {
  formatVaultImageMarkdownForInsert,
  VAULT_IMAGE_MARKDOWN_ALT,
} from './formatVaultImageMarkdown';

describe('formatVaultImageMarkdownForInsert', () => {
  it('returns empty string for no paths', () => {
    expect(formatVaultImageMarkdownForInsert([])).toBe('');
  });

  it('formats a single relative attachment path', () => {
    expect(
      formatVaultImageMarkdownForInsert(['../Assets/Attachments/foo.png']),
    ).toBe(
      `![${VAULT_IMAGE_MARKDOWN_ALT}](../Assets/Attachments/foo.png)`,
    );
  });

  it('separates multiple images with a blank line', () => {
    expect(formatVaultImageMarkdownForInsert(['a.png', 'b.png'])).toBe(
      `![${VAULT_IMAGE_MARKDOWN_ALT}](a.png)\n\n![${VAULT_IMAGE_MARKDOWN_ALT}](b.png)`,
    );
  });
});

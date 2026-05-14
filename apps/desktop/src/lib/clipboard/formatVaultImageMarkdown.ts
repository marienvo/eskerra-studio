/** Alt text for vault images pasted or dropped into the inbox editor. */
export const VAULT_IMAGE_MARKDOWN_ALT = 'Image';

/**
 * Builds markdown image lines for insertion at the cursor (e.g. after paste-to-vault).
 * Multiple images are separated by a blank line, matching typical block spacing.
 */
export function formatVaultImageMarkdownForInsert(paths: readonly string[]): string {
  if (paths.length === 0) {
    return '';
  }
  return paths
    .map(p => `![${VAULT_IMAGE_MARKDOWN_ALT}](${p})`)
    .join('\n\n');
}

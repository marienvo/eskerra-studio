import {normalizeEmojiText} from '../../emojiVariation';

import {resolveCleanNoteDefaults} from './defaults';
import {postprocessMarkdown} from './postprocess';
import {preprocessMarkdown} from './preprocess';
import {getMarkdownProcessor, resetMarkdownProcessorCache} from './processor';
import {
  protectBlockquoteAdmonitions,
  protectDateTokens,
  protectHighlights,
  protectIssueNumberHashes,
  protectWikiLinks,
  restoreBlockquoteAdmonitions,
  restoreDateTokens,
  restoreHighlights,
  restoreIssueNumberHashes,
  restoreWikiLinks,
} from './tokenProtection';
import type {CleanNoteOptions} from './types';

function fileStemFromPath(filepath: string): string {
  const norm = filepath.replace(/\\/g, '/');
  const base = norm.slice(norm.lastIndexOf('/') + 1);
  return base.replace(/\.md$/i, '');
}

/**
 * Normalizes markdown body (no YAML frontmatter). Matches legacy `processMarkDownContent` behavior
 * when defaults are used.
 */
export function cleanNoteMarkdownBody(
  content: string,
  filepath: string,
  options?: CleanNoteOptions,
): string {
  const resolved = resolveCleanNoteDefaults(options);
  const preserveLeadingBlankLine = /^[\t ]*\n/.test(content);
  const preprocessed = preprocessMarkdown(content, resolved);
  const {text: wikiProtectedInput, tokens: wikiTokens} = protectWikiLinks(preprocessed);
  const {text: protectedInput, tokens: highlightTokens} = protectHighlights(wikiProtectedInput);
  const {text: issueProtectedInput, tokens: issueTokens} =
    protectIssueNumberHashes(protectedInput);
  const {text: admonitionProtectedInput, tokens: admonitionTokens} =
    protectBlockquoteAdmonitions(issueProtectedInput);
  const {text: remarkInput, tokens: dateTokens} =
    protectDateTokens(admonitionProtectedInput);
  const fileStem = fileStemFromPath(filepath);

  const processor = getMarkdownProcessor(resolved);
  const file = processor.processSync({
    path: filepath,
    value: remarkInput,
    data: {fileStem},
  });

  const unhighlighted = restoreHighlights(String(file), highlightTokens);
  const afterEmoji = resolved.normalizeEmojiVs16
    ? normalizeEmojiText(unhighlighted)
    : unhighlighted;
  const restoredWiki = restoreWikiLinks(afterEmoji, wikiTokens);
  const restoredIssues = restoreIssueNumberHashes(restoredWiki, issueTokens);
  const restoredAdmonitions = restoreBlockquoteAdmonitions(restoredIssues, admonitionTokens);
  const restored = restoreDateTokens(restoredAdmonitions, dateTokens);
  return postprocessMarkdown(restored, {preserveLeadingBlankLine}, resolved);
}

/**
 * Placeholder path for `cleanNoteMarkdownBody` when pasting while no vault file path exists yet
 * (for example a new inbox entry). Not used for H1 injection when `insertH1FromFilename` is false.
 */
export const CLEAN_PASTE_FRAGMENT_PLACEHOLDER_PATH = '/virtual/Untitled.md';

/**
 * Same normalization pipeline as "Clean this note", scoped to pasted markdown only.
 * Never injects H1 from the filename (safe for mid-document fragments).
 */
export function cleanPastedMarkdownFragment(
  markdown: string,
  activeNotePath: string | null,
  options?: CleanNoteOptions,
): string {
  const filepath = activeNotePath ?? CLEAN_PASTE_FRAGMENT_PLACEHOLDER_PATH;
  return cleanNoteMarkdownBody(markdown, filepath, {
    ...options,
    insertH1FromFilename: false,
  });
}

/** Vitest harness: clear cached remark processors keyed by resolved options. */
export function __resetForTests(): void {
  resetMarkdownProcessorCache();
}

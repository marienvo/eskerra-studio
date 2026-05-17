import {stemFromMarkdownFileName} from './inboxMarkdown';
import type {InboxWikiLinkNoteRef} from './wikiLinkInbox';

/** Max wiki-link completions returned for one query (popover size / perf). */
export const WIKI_LINK_COMPLETION_MAX_OPTIONS = 40;

export type InboxWikiLinkCompletionCandidate = {
  /** Shown in the completion list. */
  label: string;
  /**
   * Inserted between `[[` and `]]` as the target; must resolve with
   * `resolveInboxWikiLinkTarget` to `open` for this note.
   */
  insertTarget: string;
  /** Markdown file stem (basename without `.md`), shown as detail. */
  detail: string;
};

/**
 * Builds inbox wiki-link completion rows from the current note list.
 * Notes whose stem is ambiguous (more than one note share the same stem) are
 * omitted so each suggestion resolves uniquely to `open`.
 */
export function buildInboxWikiLinkCompletionCandidates(
  notes: ReadonlyArray<InboxWikiLinkNoteRef>,
): InboxWikiLinkCompletionCandidate[] {
  const stemCounts = new Map<string, number>();
  for (const n of notes) {
    const stem = stemFromMarkdownFileName(n.name);
    stemCounts.set(stem, (stemCounts.get(stem) ?? 0) + 1);
  }

  const rows = notes.filter(
    n => stemCounts.get(stemFromMarkdownFileName(n.name)) === 1,
  );

  const out = rows.map(note => {
    const stem = stemFromMarkdownFileName(note.name);
    return {
      label: stem,
      insertTarget: stem,
      detail: stem,
    };
  });

  out.sort((a, b) => a.label.localeCompare(b.label));
  return out;
}

/**
 * Case-insensitive substring filter with ranking:
 * 1. Exact match, 2. prefix match, 3. substring match.
 * Within each tier, preserves the iteration order of the input array.
 */
export function filterInboxWikiLinkCompletionCandidates(
  candidates: ReadonlyArray<InboxWikiLinkCompletionCandidate>,
  query: string,
  maxOptions: number = WIKI_LINK_COMPLETION_MAX_OPTIONS,
): InboxWikiLinkCompletionCandidate[] {
  const p = query.trim().toLowerCase();
  if (p === '') {
    return candidates.slice(0, maxOptions);
  }
  const exact: InboxWikiLinkCompletionCandidate[] = [];
  const starts: InboxWikiLinkCompletionCandidate[] = [];
  const contains: InboxWikiLinkCompletionCandidate[] = [];
  for (const c of candidates) {
    const label = c.label.toLowerCase();
    if (label === p) {
      exact.push(c);
    } else if (label.startsWith(p)) {
      starts.push(c);
    } else if (label.includes(p)) {
      contains.push(c);
    }
  }
  return [...exact, ...starts, ...contains].slice(0, maxOptions);
}

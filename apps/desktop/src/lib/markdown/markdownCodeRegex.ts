/**
 * Fenced code block: opening run of 3+ backticks, optional info string, body, closing run of same length.
 * Matches four-backtick fences emitted when pasted `<pre>` content contains triple backticks.
 */
// eslint-disable-next-line sonarjs/slow-regex -- Bounded editor/clipboard markdown; closing fence length matches opening run.
export const FENCED_CODE_RE = /(`{3,})(?:[^\n]*)\n[\s\S]*?\n\1/g;

/** Inline code span (single line, no nested backticks). */
export const INLINE_CODE_RE = /`[^`\n]+`/g;

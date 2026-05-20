/** Fenced code block (non-greedy, multiline). */
export const FENCED_CODE_RE = /```[\s\S]*?```/g;

/** Inline code span (single line, no nested backticks). */
export const INLINE_CODE_RE = /`[^`\n]+`/g;

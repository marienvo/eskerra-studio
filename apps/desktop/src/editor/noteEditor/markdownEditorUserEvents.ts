/**
 * {@link import('@codemirror/state').Transaction.userEvent} tags for editor updates that are
 * intentional but not produced by CodeMirror’s default input pipeline, so caret-jump
 * observability can distinguish them from unexpected selection moves.
 */
export const MARKDOWN_INPUT_PASTE_USER_EVENT = 'input.paste';
export const MARKDOWN_INPUT_CUT_USER_EVENT = 'input.cut';
export const MARKDOWN_SURROUND_USER_EVENT = 'markdown.surround';
export const MARKDOWN_CASE_TOGGLE_USER_EVENT = 'markdown.caseToggle';
export const MARKDOWN_TABLE_DOC_SYNC_USER_EVENT = 'markdown.tableDocSync';

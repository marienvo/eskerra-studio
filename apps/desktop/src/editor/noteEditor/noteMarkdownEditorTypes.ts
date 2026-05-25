import type {InboxWikiLinkCompletionCandidate} from '@eskerra/core';

import type {NoteInboxAttachmentHost} from '../../lib/noteInboxAttachmentHost';
import type {NoteMarkdownLoadOptions} from './noteMarkdownLoadMarkdown';
import type {VaultImagePreviewUrlResolver} from './vaultImagePreviewTypes';
import type {
  VaultRelativeMarkdownLinkActivatePayload,
  VaultWikiLinkActivatePayload,
} from './vaultLinkActivatePayload';

export type {NoteMarkdownLoadOptions};

export type NoteMarkdownEditorProps = {
  vaultRoot: string;
  /** Absolute path to the open vault `.md` file, or `null` while composing a new note. */
  activeNotePath: string | null;
  initialMarkdown: string;
  /** Bumped when the document should reload from `initialMarkdown` (note switch or new entry). */
  sessionKey: number;
  onMarkdownChange: (markdown: string) => void;
  /** Shown when image paste or drop fails; also used when vault image import is unavailable. */
  onEditorError?: (message: string) => void;
  /** Shell-owned wiki-link action handler. */
  onWikiLinkActivate: (payload: VaultWikiLinkActivatePayload) => void;
  /** Shell-owned: relative `.md` href resolves to an existing indexed note (for styling). */
  relativeMarkdownLinkHrefIsResolved: (href: string) => boolean;
  /** Shell-owned relative markdown link open/create (same click rules as wiki links). */
  onMarkdownRelativeLinkActivate: (
    payload: VaultRelativeMarkdownLinkActivatePayload,
  ) => void;
  /** Shell-owned: open `http` / `https` / `mailto` inline links in the system browser. */
  onMarkdownExternalLinkOpen: (payload: {href: string; at: number}) => void;
  /** Shell-owned: `[[inner]]` resolves to exactly one vault note (for styling). */
  wikiLinkTargetIsResolved: (inner: string) => boolean;
  /** Shell-provided vault markdown targets for `[[` autocomplete (WL-3). */
  wikiLinkCompletionCandidates?: ReadonlyArray<InboxWikiLinkCompletionCandidate>;
  /** Desktop: Ctrl/Cmd+S — auto-save flush or submit new entry (handled by shell). */
  onSaveShortcut?: () => void;
  /** Desktop: normalize markdown layout for the open note (shell-owned). */
  onCleanNote?: () => void;
  /** Desktop: Ctrl/Cmd+Shift+D — request delete current note (shell shows confirmation). */
  onDeleteNoteShortcut?: () => void;
  placeholder: string;
  busy: boolean;
  /**
   * When false, omit the fold gutter (no collapse chevrons). Main inbox editor should keep the default (`true`).
   */
  showFoldGutter?: boolean;
  /** Shell-owned Tauri clipboard, OS drop, and vault persistence. */
  attachmentHost: NoteInboxAttachmentHost;
  /** Shell-owned: Markdown image src → preview URL (for example `lib/resolveVaultImagePreviewUrl`). */
  resolveVaultImagePreviewUrl: VaultImagePreviewUrlResolver;
  /** Called when the editor gains or loses at least one folded range (fold gutter, lists, etc.). */
  onFoldedRangesPresentChange?: (present: boolean) => void;
  /** Called when the document gains or loses at least one foldable range (same rules as collapse-all). */
  onFoldableRangesPresentChange?: (present: boolean) => void;
  /**
   * When true, the document cannot be edited (`EditorState.readOnly` / `EditorView.editable`).
   * Same extensions and update path as the full editor; toggled via a Compartment (no duplicate mode).
   */
  readOnly?: boolean;
  /** Hostnames for which rich link snippet cards are suppressed. */
  linkSnippetBlockedDomains?: ReadonlyArray<string>;
  /** Called when the user chooses to hide snippets from a domain via the context menu. */
  onMuteLinkSnippetDomain?: (domain: string) => void;
  /**
   * Fires after the editable editor loses focus (skipped when `readOnly`). Deferred one microtask so
   * focus moved into CodeMirror tooltips/panels or the markdown context menu does not count. Today
   * Hub uses this for empty cells to collapse back to the dashed placeholder.
   */
  onEditableBlur?: () => void;
};

export type NoteMarkdownEditorHandle = {
  getMarkdown: () => string;
  loadMarkdown: (markdown: string, options?: NoteMarkdownLoadOptions) => void;
  /** Unfolds every folded range in the editor (fold gutter, lists, etc.). */
  unfoldAllFolds: () => boolean;
  /**
   * Folds every foldable range (lists, sections, etc.). H1 title sections are never foldable
   * (see `markdownEskerra`).
   */
  collapseAllFolds: () => boolean;
  replaceWikiLinkInnerAt: (options: {
    at: number;
    expectedInner: string;
    replacementInner: string;
  }) => boolean;
  replaceMarkdownLinkHrefAt: (options: {
    at: number;
    expectedHref: string;
    replacementHref: string;
  }) => boolean;
  /**
   * Move focus into this editor; optionally place the caret at a UTF-16 offset (clamped to the document).
   * When `scrollIntoView` is false, the selection update omits scroll-into-view (faster; use when layout is local).
   */
  focus: (options?: {anchor?: number; scrollIntoView?: boolean}) => void;
};

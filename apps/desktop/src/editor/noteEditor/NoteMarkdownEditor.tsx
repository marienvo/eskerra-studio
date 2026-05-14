import {defaultKeymap, history, historyKeymap, indentWithTab} from '@codemirror/commands';
import {
  foldedRanges,
  foldGutter,
  foldKeymap,
  unfoldAll,
} from '@codemirror/language';
import {commonmarkLanguage} from '@codemirror/lang-markdown';
import {languages} from '@codemirror/language-data';
import {search, searchKeymap, searchPanelOpen} from '@codemirror/search';
import {
  Compartment,
  EditorSelection,
  EditorState,
  Transaction,
  type Extension,
} from '@codemirror/state';
import {
  drawSelection,
  EditorView,
  keymap,
  placeholder,
} from '@codemirror/view';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';

import {MIDDLE_CLICK_BLOCK_PASTE_WINDOW_MS} from '../../hooks/middleClickPasteBlock';
import {
  isBrowserOpenableMarkdownHref,
  isExternalMarkdownHref,
  MARKDOWN_EXTENSION,
  stripMarkdownLinkHrefToPathPart,
  wikiLinkInnerBrowserOpenableHref,
  type InboxWikiLinkCompletionCandidate,
} from '@eskerra/core';

import {clipboardDataProbablyHasVaultImage} from '../../lib/clipboard/clipboardImageFiles';
import {
  todayHubPerfEnabled,
  todayHubPerfLog,
} from '../../lib/todayHub/todayHubPerf';
import {formatVaultImageMarkdownForInsert} from '../../lib/clipboard/formatVaultImageMarkdown';
import {cleanPastedMarkdownFragment} from '../../lib/cleanNoteMarkdown';
import {tryClipboardHtmlToMarkdownInsert} from '../../lib/clipboard/htmlClipboardToMarkdown';
import {
  isNoteAttachmentImageFilePath,
  type NoteInboxAttachmentHost,
} from '../../lib/noteInboxAttachmentHost';
import {markdownCodeBackgroundLayer} from './markdownCodeBackgroundLayer';
import {
  noteMarkdownEditorAppearance,
  noteMarkdownIndentUnit,
  noteMarkdownListItemFoldService,
  noteMarkdownParserExtensions,
} from './markdownEditorStyling';
import {markdownEskerra} from './markdownEskerraLanguage';
import {foldableRangesPresent, nestedCollapseAllFolds} from './nestedFoldAll';
import type {VaultImagePreviewUrlResolver} from './vaultImagePreviewTypes';
import {
  vaultImagePreviewContextBumpEffect,
  vaultImagePreviewExtension,
} from './vaultImagePreviewCodemirror';
import {todayHubSectionMarkerExtension} from './todayHubSectionMarkerCodemirror';
import {linkRichPreviewExtension, linkRichBlockedDomainsBumpEffect, type LinkRichPreviewRefs} from './linkRichPreviewCodemirror';
import {markdownBareBrowserUrlAtPosition} from './markdownBareUrl';
import {markdownActivatableRelativeMdLinkAtPosition} from './markdownActivatableRelativeMdLinkAtPosition';
import {markdownInlineLinkUrlAtPosition} from './markdownInlineLinkUrlAtPosition';
import {markdownExternalLinkHighlightExtension} from './markdownExternalLinkCodemirror';
import {markdownRelativeLinkHighlightExtensions} from './markdownRelativeLinkCodemirror';
import {MarkdownTableCellContextMenu} from './MarkdownTableCellContextMenu';
import {NoteMarkdownEditorContextMenu} from './NoteMarkdownEditorContextMenu';
import {
  markdownFormattingModKeymap,
  markdownInlineCodeSurroundInputHandler,
  markdownSelectionAllowMultipleRanges,
  markdownSelectionSurroundKeymap,
} from './markdownSelectionSurround';
import {wikiLinkAutocompleteExtension} from './wikiLinkAutocomplete';
import {wikiLinkResolvedHighlightExtensions} from './wikiLinkCodemirror';
import {eskerraTableCellBundleFacet} from './eskerraTableV1/eskerraTableCellBundleFacet';
import {eskerraTableShellLinkBridgeFacet} from './eskerraTableV1/eskerraTableShellLinkBridgeFacet';
import {eskerraTableParentLinkCompartmentsFacet} from './eskerraTableV1/eskerraTableParentLinkCompartments';
import {
  buildNoteMarkdownCellExtensions,
  sanitizeCellInsert,
  type TableCellContextMenuOpen,
} from './noteMarkdownCellEditor';
import {
  buildNoteMarkdownDeleteLineModYBindings,
  buildNoteMarkdownDuplicateLineModDBindings,
  buildNoteMarkdownVaultKeymapBindings,
} from './noteMarkdownCoreKeymap';
import {
  markdownCaretInOpaquePasteBlock,
  markdownSmartExpandExtension,
} from './markdownSmartExpandSelection';
import {
  clearEskerraTableNestedCellRegistrations,
  dispatchEskerraTableNestedCellEditors,
} from './eskerraTableV1/eskerraTableNestedCellEditors';
import {eskerraTableV1Extension} from './eskerraTableV1/eskerraTableV1Codemirror';
import {flushAllEskerraTableDrafts} from './eskerraTableV1/eskerraTableDraftFlush';
import {
  discardStoredPrimaryPointerDownForLinkClick,
  recordPrimaryPointerDownForLinkClick,
  resolveDocPositionForLinkPrimaryClick,
} from './linkClickUseMousedownPosition';
import {multiCaretClickAddsSelectionRangeExtension} from './multiCaretClick';
import {
  wikiLinkMatchAtDocPosition,
  wikiLinkPointerActivatableInnerAtDocPosition,
} from './wikiLinkInnerAtDocPosition';
import {
  beginProgrammaticMarkdownLoad,
  caretJumpDetectorExtension,
  endProgrammaticMarkdownLoad,
} from './caretJumpDetector';
import {MARKDOWN_INPUT_PASTE_USER_EVENT} from './markdownEditorUserEvents';
import {
  computeMinimalEditorChanges,
  mapPositionThroughDiff,
} from './noteMarkdownDiffChanges';
import {
  explicitCursorForMarkdownLoadDispatch,
  explicitCursorForMarkdownLoadSetState,
  selectionIsPreserve,
  selMatchesForcedCursor,
  shouldUseMergedReplaceForMarkdownLoad,
  shouldUseSetStateBranchForMarkdownLoad,
} from './noteMarkdownLoadMarkdown';
import {eolMarkerCaretPointerFixExtension} from './eolMarkerCaretPointerFix';
import type {
  VaultRelativeMarkdownLinkActivatePayload,
  VaultWikiLinkActivatePayload,
} from './vaultLinkActivatePayload';

const defaultWikiLinkCompletionCandidates: readonly InboxWikiLinkCompletionCandidate[] =
  [];

/** Extra px below the sticky search bar so scroll-into-view clears the panel (outer scroll + `overflow: visible` scroller). */
const NOTE_CAPTURE_SEARCH_SCROLL_MARGIN_PX = 8;

function captureSearchPanelTopInsetPx(view: EditorView): number {
  const panels = view.dom.querySelector('.cm-panels-top');
  if (!panels) {
    return NOTE_CAPTURE_SEARCH_SCROLL_MARGIN_PX;
  }
  return (
    Math.round(panels.getBoundingClientRect().height)
    + NOTE_CAPTURE_SEARCH_SCROLL_MARGIN_PX
  );
}

/**
 * Search + scroll padding for the capture editor: sticky `.cm-panels-top` sits in the outer
 * `overflow-y` scroller, so default `scrollIntoView` margins miss the real obstruction.
 */
const noteMarkdownSearchExtensionBundle: readonly Extension[] = [
  search({
    scrollToMatch: range =>
      EditorView.scrollIntoView(range, {
        y: 'start',
        yMargin: NOTE_CAPTURE_SEARCH_SCROLL_MARGIN_PX,
      }),
  }),
  EditorView.scrollMargins.of(view =>
    searchPanelOpen(view.state)
      ? {top: captureSearchPanelTopInsetPx(view)}
      : null,
  ),
];

function foldedRangesPresent(state: EditorState): boolean {
  return foldedRanges(state).size > 0;
}

function createFoldGutterMarker(open: boolean): HTMLSpanElement {
  const span = document.createElement('span');
  span.textContent = open ? '⌄' : '›';
  span.className = 'cm-foldGutter-marker app-tooltip-trigger';
  span.setAttribute('data-tooltip', open ? 'Fold line' : 'Unfold line');
  span.setAttribute('data-tooltip-placement', 'inline-end');
  span.setAttribute('aria-label', open ? 'Fold line' : 'Unfold line');
  return span;
}

function isActivatableRelativeMarkdownHref(href: string): boolean {
  const part = stripMarkdownLinkHrefToPathPart(href);
  if (part === '' || isExternalMarkdownHref(part)) {
    return false;
  }
  return part.toLowerCase().endsWith(MARKDOWN_EXTENSION.toLowerCase());
}

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
  loadMarkdown: (
    markdown: string,
    options?: {selection?: 'start' | 'end' | 'preserve'},
  ) => void;
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

const NoteMarkdownEditorImpl = forwardRef<
  NoteMarkdownEditorHandle,
  NoteMarkdownEditorProps
>(function NoteMarkdownEditorImpl(props, ref) {
  const {
    vaultRoot,
    attachmentHost,
    resolveVaultImagePreviewUrl,
    initialMarkdown,
    onMarkdownChange,
    onEditorError,
    onWikiLinkActivate,
    relativeMarkdownLinkHrefIsResolved,
    onMarkdownRelativeLinkActivate,
    onMarkdownExternalLinkOpen,
    wikiLinkTargetIsResolved,
    wikiLinkCompletionCandidates = defaultWikiLinkCompletionCandidates,
    onSaveShortcut,
    onCleanNote,
    onDeleteNoteShortcut,
    placeholder: placeholderText,
    busy,
    showFoldGutter = true,
    onFoldedRangesPresentChange,
    onFoldableRangesPresentChange,
    readOnly: readOnlyProp = false,
    onEditableBlur,
    linkSnippetBlockedDomains,
    onMuteLinkSnippetDomain,
  } = props;

  const readOnly = readOnlyProp;
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;

  const onEditableBlurRef = useRef(onEditableBlur);
  onEditableBlurRef.current = onEditableBlur;

  const parentRef = useRef<HTMLDivElement>(null);
  /** `.note-markdown-editor-host`: used to mount the sticky raw-table escape banner outside CodeMirror. */
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  /** Boot extension bundle for `EditorState.create` when replacing the document without React remounting. */
  const codemirrorBootExtensionsRef = useRef<readonly Extension[] | null>(null);
  const wikiLinkTargetIsResolvedRef = useRef(wikiLinkTargetIsResolved);
  wikiLinkTargetIsResolvedRef.current = wikiLinkTargetIsResolved;
  const relativeMarkdownLinkHrefIsResolvedRef = useRef(
    relativeMarkdownLinkHrefIsResolved,
  );
  relativeMarkdownLinkHrefIsResolvedRef.current = relativeMarkdownLinkHrefIsResolved;
  const initialMarkdownRef = useRef(initialMarkdown);
  initialMarkdownRef.current = initialMarkdown;

  const onMarkdownChangeRef = useRef(onMarkdownChange);
  useEffect(() => {
    onMarkdownChangeRef.current = onMarkdownChange;
  }, [onMarkdownChange]);

  const onEditorErrorRef = useRef(onEditorError);
  useEffect(() => {
    onEditorErrorRef.current = onEditorError;
  }, [onEditorError]);

  const onWikiLinkActivateRef = useRef(onWikiLinkActivate);
  useEffect(() => {
    onWikiLinkActivateRef.current = onWikiLinkActivate;
  }, [onWikiLinkActivate]);

  const onMarkdownRelativeLinkActivateRef = useRef(onMarkdownRelativeLinkActivate);
  useEffect(() => {
    onMarkdownRelativeLinkActivateRef.current = onMarkdownRelativeLinkActivate;
  }, [onMarkdownRelativeLinkActivate]);

  const onMarkdownExternalLinkOpenRef = useRef(onMarkdownExternalLinkOpen);
  useEffect(() => {
    onMarkdownExternalLinkOpenRef.current = onMarkdownExternalLinkOpen;
  }, [onMarkdownExternalLinkOpen]);

  const onSaveShortcutRef = useRef(onSaveShortcut);
  onSaveShortcutRef.current = onSaveShortcut;

  const onDeleteNoteShortcutRef = useRef(onDeleteNoteShortcut);
  onDeleteNoteShortcutRef.current = onDeleteNoteShortcut;

  const onFoldedRangesPresentChangeRef = useRef(
    onFoldedRangesPresentChange,
  );
  useEffect(() => {
    onFoldedRangesPresentChangeRef.current = onFoldedRangesPresentChange;
  }, [onFoldedRangesPresentChange]);

  const onFoldableRangesPresentChangeRef = useRef(
    onFoldableRangesPresentChange,
  );
  useEffect(() => {
    onFoldableRangesPresentChangeRef.current = onFoldableRangesPresentChange;
  }, [onFoldableRangesPresentChange]);

  const reportEditorError = useCallback((message: string) => {
    console.error(message);
    onEditorErrorRef.current?.(message);
  }, []);

  const vaultRootRef = useRef(vaultRoot);
  vaultRootRef.current = vaultRoot;
  const activeNotePathRef = useRef(props.activeNotePath);
  activeNotePathRef.current = props.activeNotePath;
  const busyRef = useRef(busy);
  busyRef.current = busy;

  const attachmentHostRef = useRef(attachmentHost);
  attachmentHostRef.current = attachmentHost;

  const resolveVaultImagePreviewUrlRef = useRef(resolveVaultImagePreviewUrl);
  resolveVaultImagePreviewUrlRef.current = resolveVaultImagePreviewUrl;

  const wikiLinkCompletionCandidatesRef = useRef(wikiLinkCompletionCandidates);
  wikiLinkCompletionCandidatesRef.current = wikiLinkCompletionCandidates;

  const onMuteLinkSnippetDomainRef = useRef(onMuteLinkSnippetDomain);
  useEffect(() => {
    onMuteLinkSnippetDomainRef.current = onMuteLinkSnippetDomain;
  }, [onMuteLinkSnippetDomain]);

  const linkRichPreviewRefsRef = useRef<LinkRichPreviewRefs | null>(null);
  if (linkRichPreviewRefsRef.current === null) {
    linkRichPreviewRefsRef.current = {
      onOpenLink: (href, at) =>
        onMarkdownExternalLinkOpenRef.current({href, at}),
      blockedDomains: new Set(),
    };
  }

  useEffect(() => {
    const refs = linkRichPreviewRefsRef.current;
    if (!refs) return;
    refs.blockedDomains = new Set(linkSnippetBlockedDomains ?? []);
    viewRef.current?.dispatch({effects: linkRichBlockedDomainsBumpEffect.of(null)});
  }, [linkSnippetBlockedDomains]);

  useEffect(() => {
    const v = viewRef.current;
    if (!v) {
      return;
    }
    const spec = {effects: vaultImagePreviewContextBumpEffect.of(null)};
    v.dispatch(spec);
    dispatchEskerraTableNestedCellEditors(v, spec);
  }, [vaultRoot, props.activeNotePath]);

  const wikiLinkCompartmentRef = useRef<Compartment | null>(null);
  if (wikiLinkCompartmentRef.current === null) {
    wikiLinkCompartmentRef.current = new Compartment();
  }
  const relativeMdLinkCompartmentRef = useRef<Compartment | null>(null);
  if (relativeMdLinkCompartmentRef.current === null) {
    relativeMdLinkCompartmentRef.current = new Compartment();
  }

  const tableCellMenuViewRef = useRef<EditorView | null>(null);
  const tableCellContextMenuOpenRef = useRef<TableCellContextMenuOpen | null>(
    null,
  );
  const [tableCellMenuOpen, setTableCellMenuOpen] = useState(false);
  const [tableCellMenuAnchor, setTableCellMenuAnchor] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const readOnlyCompartmentRef = useRef<Compartment | null>(null);
  if (readOnlyCompartmentRef.current === null) {
    readOnlyCompartmentRef.current = new Compartment();
  }

  useLayoutEffect(() => {
    const parent = parentRef.current;
    if (!parent) {
      return;
    }

    const hubPerfStart =
      todayHubPerfEnabled() && !showFoldGutter ? performance.now() : 0;

    const runVaultImagePasteFromDataTransfer = (
      dt: DataTransfer,
      viewForPaste: EditorView,
    ): boolean => {
      if (!clipboardDataProbablyHasVaultImage(dt)) {
        return false;
      }

      const sel = viewForPaste.state.selection.main;
      const anchor = sel.anchor;
      const head = sel.head;
      const insertFrom = Math.min(anchor, head);
      const insertTo = Math.max(anchor, head);

      void (async () => {
        const vr = vaultRootRef.current;
        const host = attachmentHostRef.current;

        try {
          const relPaths = await host.importPastedImages(dt, vr);

          if (relPaths.length === 0) {
            reportEditorError(
              'Could not import the pasted content as a vault image.',
            );
            return;
          }

          const insert = formatVaultImageMarkdownForInsert(relPaths);
          if (viewRef.current !== viewForPaste) {
            return;
          }
          viewForPaste.dispatch({
            changes: {from: insertFrom, to: insertTo, insert},
            selection: EditorSelection.cursor(insertFrom + insert.length),
            scrollIntoView: true,
            userEvent: MARKDOWN_INPUT_PASTE_USER_EVENT,
          });
        } catch (err) {
          reportEditorError(
            err instanceof Error ? err.message : String(err),
          );
        }
      })();

      return true;
    };

    const runNativeClipboardPasteWhenWebDataEmpty = (
      viewForPaste: EditorView,
    ): boolean => {
      const sel = viewForPaste.state.selection.main;
      const insertFrom = Math.min(sel.anchor, sel.head);
      const insertTo = Math.max(sel.anchor, sel.head);

      void (async () => {
        const vr = vaultRootRef.current;
        const host = attachmentHostRef.current;
        const result = await host.readNativeClipboardPaste(vr);

        if (result.kind === 'text') {
          if (viewRef.current === viewForPaste) {
            viewForPaste.dispatch({
              changes: {
                from: insertFrom,
                to: insertTo,
                insert: result.text,
              },
              selection: EditorSelection.cursor(
                insertFrom + result.text.length,
              ),
              scrollIntoView: true,
              userEvent: MARKDOWN_INPUT_PASTE_USER_EVENT,
            });
          }
          return;
        }

        if (result.kind === 'fail') {
          reportEditorError(result.message);
          return;
        }

        try {
          const insert = formatVaultImageMarkdownForInsert(result.paths);
          if (viewRef.current !== viewForPaste) {
            return;
          }
          viewForPaste.dispatch({
            changes: {from: insertFrom, to: insertTo, insert},
            selection: EditorSelection.cursor(insertFrom + insert.length),
            scrollIntoView: true,
            userEvent: MARKDOWN_INPUT_PASTE_USER_EVENT,
          });
        } catch (pipeErr) {
          reportEditorError(
            pipeErr instanceof Error ? pipeErr.message : String(pipeErr),
          );
        }
      })();

      return true;
    };

    const tryPasteRichHtmlFromDataTransfer = (
      dt: DataTransfer,
      e: ClipboardEvent,
      viewForPaste: EditorView,
    ): boolean => {
      const htmlRaw = dt.getData('text/html') ?? '';
      const plain = dt.getData('text/plain') ?? '';
      if (markdownCaretInOpaquePasteBlock(
        viewForPaste.state,
        viewForPaste.state.selection.main.head,
      )) {
        return false;
      }
      const md = tryClipboardHtmlToMarkdownInsert(htmlRaw, plain);
      if (md == null) {
        return false;
      }
      const insert = cleanPastedMarkdownFragment(md, activeNotePathRef.current);
      if (insert.length === 0) {
        e.preventDefault();
        e.stopPropagation();
        return true;
      }
      e.preventDefault();
      e.stopPropagation();
      const sel = viewForPaste.state.selection.main;
      const insertFrom = Math.min(sel.anchor, sel.head);
      const insertTo = Math.max(sel.anchor, sel.head);
      viewForPaste.dispatch({
        changes: {from: insertFrom, to: insertTo, insert},
        selection: EditorSelection.cursor(insertFrom + insert.length),
        scrollIntoView: true,
        userEvent: MARKDOWN_INPUT_PASTE_USER_EVENT,
      });
      return true;
    };

    // X11/WebKitGTK: middle-click fires a synthetic `paste` with primary selection; block briefly.
    let middleClickBlockPasteUntil = 0;

    const onEditorPasteFromClipboardData = (
      dt: DataTransfer,
      e: ClipboardEvent,
      view: EditorView,
    ): boolean => {
      const plainTrimmed = (dt.getData('text/plain') ?? '').trim();
      const probablyImage = clipboardDataProbablyHasVaultImage(dt);
      if (probablyImage) {
        e.preventDefault();
        e.stopPropagation();
        return runVaultImagePasteFromDataTransfer(dt, view);
      }
      if (plainTrimmed === '' && !probablyImage) {
        const htmlWhenPlainEmpty = dt.getData('text/html') ?? '';
        if (
          htmlWhenPlainEmpty.trim() !== ''
          && tryPasteRichHtmlFromDataTransfer(dt, e, view)
        ) {
          return true;
        }
        e.preventDefault();
        e.stopPropagation();
        return runNativeClipboardPasteWhenWebDataEmpty(view);
      }
      return tryPasteRichHtmlFromDataTransfer(dt, e, view);
    };

    const onEditorPaste = (e: ClipboardEvent, view: EditorView): boolean => {
      if (Date.now() < middleClickBlockPasteUntil) {
        e.preventDefault();
        return true;
      }
      if (busyRef.current) {
        if (
          e.clipboardData &&
          clipboardDataProbablyHasVaultImage(e.clipboardData)
        ) {
          e.preventDefault();
          reportEditorError(
            'Please wait until the current operation finishes before pasting an image.',
          );
          return true;
        }
        return false;
      }

      const host = attachmentHostRef.current;
      if (!host.isVaultImageImportAvailable) {
        if (
          e.clipboardData &&
          clipboardDataProbablyHasVaultImage(e.clipboardData)
        ) {
          e.preventDefault();
          reportEditorError(
            'Pasting images into the vault requires the Eskerra desktop app. Use `tauri dev` or the packaged app instead of a plain browser tab.',
          );
          return true;
        }
        return (
          e.clipboardData != null
          && tryPasteRichHtmlFromDataTransfer(e.clipboardData, e, view)
        );
      }

      const dt = e.clipboardData;
      if (dt) {
        return onEditorPasteFromClipboardData(dt, e, view);
      }

      e.preventDefault();
      e.stopPropagation();
      return runNativeClipboardPasteWhenWebDataEmpty(view);
    };

    // Plain or Ctrl/Cmd+primary follows the link; Shift+primary is left to CodeMirror for selection extension.
    const onEditorClick = (e: MouseEvent, view: EditorView): boolean => {
      if (e.button !== 0) {
        return false;
      }
      if (e.shiftKey) {
        discardStoredPrimaryPointerDownForLinkClick(view);
        return false;
      }
      if (e.altKey) {
        discardStoredPrimaryPointerDownForLinkClick(view);
        return false;
      }
      const pos = resolveDocPositionForLinkPrimaryClick(view, e);
      if (pos == null) {
        return false;
      }
      const inner = wikiLinkPointerActivatableInnerAtDocPosition(
        view.state.doc,
        pos,
      );
      if (inner) {
        e.preventDefault();
        e.stopPropagation();
        onWikiLinkActivateRef.current({inner, at: pos});
        return true;
      }
      const relHit = markdownActivatableRelativeMdLinkAtPosition(
        view.state,
        pos,
        isActivatableRelativeMarkdownHref,
      );
      if (relHit) {
        e.preventDefault();
        e.stopPropagation();
        onMarkdownRelativeLinkActivateRef.current({
          href: relHit.href,
          at: relHit.hrefFrom,
        });
        return true;
      }
      const extHit = markdownActivatableRelativeMdLinkAtPosition(
        view.state,
        pos,
        isBrowserOpenableMarkdownHref,
      );
      const bareHit = markdownBareBrowserUrlAtPosition(view.state, pos);
      if (extHit) {
        e.preventDefault();
        e.stopPropagation();
        onMarkdownExternalLinkOpenRef.current({
          href: extHit.href,
          at: extHit.hrefFrom,
        });
        return true;
      }
      if (bareHit) {
        e.preventDefault();
        e.stopPropagation();
        onMarkdownExternalLinkOpenRef.current({
          href: bareHit.href,
          at: bareHit.hrefFrom,
        });
        return true;
      }
      return false;
    };

    const onEditorMiddleClick = (e: MouseEvent, view: EditorView): boolean => {
      if (e.button !== 1) {
        return false;
      }
      const pos = view.posAtCoords({x: e.clientX, y: e.clientY});
      if (pos == null) {
        return false;
      }
      const inner = wikiLinkPointerActivatableInnerAtDocPosition(
        view.state.doc,
        pos,
      );
      if (inner) {
        if (wikiLinkInnerBrowserOpenableHref(inner) != null) {
          return false;
        }
        e.preventDefault();
        e.stopPropagation();
        onWikiLinkActivateRef.current({
          inner,
          at: pos,
          openInBackgroundTab: true,
        });
        return true;
      }
      const relHit = markdownActivatableRelativeMdLinkAtPosition(
        view.state,
        pos,
        isActivatableRelativeMarkdownHref,
      );
      if (relHit) {
        e.preventDefault();
        e.stopPropagation();
        onMarkdownRelativeLinkActivateRef.current({
          href: relHit.href,
          at: relHit.hrefFrom,
          openInBackgroundTab: true,
        });
        return true;
      }
      return false;
    };

    const wikiLinkCompartment = wikiLinkCompartmentRef.current;
    if (!wikiLinkCompartment) {
      throw new Error('wikiLinkCompartment must be initialized');
    }
    const relativeMdLinkCompartment = relativeMdLinkCompartmentRef.current;
    if (!relativeMdLinkCompartment) {
      throw new Error('relativeMdLinkCompartment must be initialized');
    }
    const readOnlyCompartment = readOnlyCompartmentRef.current;
    if (!readOnlyCompartment) {
      throw new Error('readOnlyCompartment must be initialized');
    }

    const extensions = [
      noteMarkdownIndentUnit,
      readOnlyCompartment.of([
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
      ]),
      markdownEskerra({
        base: commonmarkLanguage,
        extensions: noteMarkdownParserExtensions,
        codeLanguages: languages,
      }),
      noteMarkdownListItemFoldService,
      ...noteMarkdownEditorAppearance,
      ...(showFoldGutter
        ? [
            foldGutter({
              openText: '⌄',
              closedText: '›',
              markerDOM: open => createFoldGutterMarker(open),
            }),
          ]
        : []),
      history(),
      drawSelection(),
      markdownCodeBackgroundLayer,
      multiCaretClickAddsSelectionRangeExtension(),
      markdownSelectionAllowMultipleRanges(),
      ...markdownSmartExpandExtension(),
      markdownSelectionSurroundKeymap(),
      markdownFormattingModKeymap(),
      markdownInlineCodeSurroundInputHandler(),
      ...noteMarkdownSearchExtensionBundle,
      keymap.of([
        ...buildNoteMarkdownVaultKeymapBindings({
          onSaveShortcut: () => onSaveShortcutRef.current?.(),
          onDeleteNoteShortcut: () => onDeleteNoteShortcutRef.current?.(),
          onWikiLinkActivate: p => onWikiLinkActivateRef.current(p),
          onMarkdownRelativeLinkActivate: p =>
            onMarkdownRelativeLinkActivateRef.current(p),
          onMarkdownExternalLinkOpen: p =>
            onMarkdownExternalLinkOpenRef.current(p),
        }),
        indentWithTab,
        ...(showFoldGutter ? foldKeymap : []),
        ...buildNoteMarkdownDuplicateLineModDBindings(),
        ...searchKeymap,
        ...defaultKeymap,
        ...buildNoteMarkdownDeleteLineModYBindings(),
        ...historyKeymap,
      ]),
      EditorView.lineWrapping,
      placeholder(placeholderText),
      wikiLinkCompartment.of(
        wikiLinkResolvedHighlightExtensions(wikiLinkTargetIsResolved),
      ),
      relativeMdLinkCompartment.of(
        markdownRelativeLinkHighlightExtensions(
          relativeMarkdownLinkHrefIsResolved,
        ),
      ),
      markdownExternalLinkHighlightExtension(),
      eskerraTableParentLinkCompartmentsFacet.of({
        wikiLink: wikiLinkCompartment,
        relativeMarkdownLink: relativeMdLinkCompartment,
      }),
      ...wikiLinkAutocompleteExtension(
        () => wikiLinkCompletionCandidatesRef.current,
      ),
      eskerraTableCellBundleFacet.of(partial =>
        buildNoteMarkdownCellExtensions({
          wikiLinkTargetIsResolved: wikiLinkTargetIsResolvedRef.current,
          relativeMarkdownLinkHrefIsResolved:
            relativeMarkdownLinkHrefIsResolvedRef.current,
          wikiLinkCompletionCandidates: () =>
            wikiLinkCompletionCandidatesRef.current,
          vaultRootRef,
          activeNotePathRef,
          resolveVaultImagePreviewUrl: (vr, ap, src) =>
            resolveVaultImagePreviewUrlRef.current(vr, ap, src),
          attachmentHostRef,
          busyRef,
          tableCellContextMenuOpenRef,
          onWikiLinkActivate: p => onWikiLinkActivateRef.current(p),
          onMarkdownRelativeLinkActivate: p =>
            onMarkdownRelativeLinkActivateRef.current(p),
          onMarkdownExternalLinkOpen: p =>
            onMarkdownExternalLinkOpenRef.current(p),
          onSaveShortcut: () => onSaveShortcutRef.current?.(),
          onDeleteNoteShortcut: () => onDeleteNoteShortcutRef.current?.(),
          ...partial,
        }),
      ),
      eskerraTableShellLinkBridgeFacet.of({
        onWikiLinkActivate: p => onWikiLinkActivateRef.current(p),
        onMarkdownRelativeLinkActivate: p =>
          onMarkdownRelativeLinkActivateRef.current(p),
        onMarkdownExternalLinkOpen: p =>
          onMarkdownExternalLinkOpenRef.current(p),
      }),
      ...eskerraTableV1Extension(),
      ...vaultImagePreviewExtension({
        vaultRoot: vaultRootRef,
        activeNotePath: activeNotePathRef,
        resolvePreviewUrl: (vr, ap, src) =>
          resolveVaultImagePreviewUrlRef.current(vr, ap, src),
      }),
      todayHubSectionMarkerExtension,
      linkRichPreviewExtension(linkRichPreviewRefsRef.current!),
      EditorView.domEventHandlers({
        mousedown(event, view) {
          recordPrimaryPointerDownForLinkClick(view, event);
          if (event.button !== 1) {
            return false;
          }
          middleClickBlockPasteUntil =
            Date.now() + MIDDLE_CLICK_BLOCK_PASTE_WINDOW_MS;
          if (onEditorMiddleClick(event, view)) {
            return true;
          }
          event.preventDefault();
          return true;
        },
        paste(event, view) {
          return onEditorPaste(event, view);
        },
        click(event, view) {
          return onEditorClick(event, view);
        },
      }),
      EditorView.theme({
        '&': {
          height: 'auto',
          minHeight: '6rem',
        },
        '&.cm-focused': {
          outline: 'none',
        },
        '.cm-gutters': {
          /* Transparent: fold rail / panel gray shows through on desktop capture inbox. */
          backgroundColor: 'transparent',
          border: 'none',
        },
        '.cm-foldGutter': {
          /* Width comes from `.cm-gutters` in App.css (must match `.note-markdown-editor-fold-rail`). */
          flexShrink: 0,
        },
        '.cm-scroller': {
          fontFamily: 'inherit',
          overflow: 'visible',
        },
        '.cm-content': {
          caretColor: 'inherit',
        },
        '.cm-tooltip.cm-tooltip-autocomplete': {
          fontFamily: 'inherit',
        },
        '&.cm-focused .cm-cursor': {
          borderLeftColor: 'inherit',
        },
      }),
      eolMarkerCaretPointerFixExtension(),
      caretJumpDetectorExtension(),
      EditorView.updateListener.of(update => {
        if (update.docChanged) {
          onMarkdownChangeRef.current(update.state.doc.toString());
          const onFoldable = onFoldableRangesPresentChangeRef.current;
          if (onFoldable) {
            const prevFoldable = foldableRangesPresent(update.startState);
            const nextFoldable = foldableRangesPresent(update.state);
            if (prevFoldable !== nextFoldable) {
              onFoldable(nextFoldable);
            }
          }
        }
        const onFold = onFoldedRangesPresentChangeRef.current;
        if (onFold) {
          const prev = foldedRangesPresent(update.startState);
          const next = foldedRangesPresent(update.state);
          if (prev !== next) {
            onFold(next);
          }
        }
        if (
          update.focusChanged &&
          !update.view.hasFocus &&
          !readOnlyRef.current &&
          onEditableBlurRef.current
        ) {
          const view = update.view;
          queueMicrotask(() => {
            if (view.hasFocus) {
              return;
            }
            const cb = onEditableBlurRef.current;
            if (!cb) {
              return;
            }
            const ae = document.activeElement;
            if (ae instanceof Element) {
              if (
                ae.closest('.cm-tooltip') ||
                ae.closest('.cm-panels') ||
                ae.closest('.note-markdown-editor-context-menu')
              ) {
                return;
              }
            }
            cb();
          });
        }
      }),
    ];

    codemirrorBootExtensionsRef.current = extensions;

    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: initialMarkdown,
        extensions,
      }),
    });
    viewRef.current = view;
    onFoldedRangesPresentChangeRef.current?.(foldedRangesPresent(view.state));
    onFoldableRangesPresentChangeRef.current?.(
      foldableRangesPresent(view.state),
    );

    if (hubPerfStart) {
      todayHubPerfLog('hub_cm_boot', {
        cmInitMs: Math.round(performance.now() - hubPerfStart),
      });
    }

    return () => {
      onFoldedRangesPresentChangeRef.current?.(false);
      onFoldableRangesPresentChangeRef.current?.(false);
      view.destroy();
      viewRef.current = null;
      codemirrorBootExtensionsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- remount via `sessionKey` wraps this component
  }, []);

  useEffect(() => {
    const compartment = wikiLinkCompartmentRef.current;
    const view = viewRef.current;
    if (!compartment || !view) {
      return;
    }
    const wikiEffect = compartment.reconfigure(
      wikiLinkResolvedHighlightExtensions(wikiLinkTargetIsResolved),
    );
    view.dispatch({effects: wikiEffect});
    dispatchEskerraTableNestedCellEditors(view, {effects: wikiEffect});
  }, [wikiLinkTargetIsResolved]);

  useEffect(() => {
    const compartment = relativeMdLinkCompartmentRef.current;
    const view = viewRef.current;
    if (!compartment || !view) {
      return;
    }
    const relEffect = compartment.reconfigure(
      markdownRelativeLinkHighlightExtensions(relativeMarkdownLinkHrefIsResolved),
    );
    view.dispatch({effects: relEffect});
    dispatchEskerraTableNestedCellEditors(view, {effects: relEffect});
  }, [relativeMarkdownLinkHrefIsResolved]);

  useLayoutEffect(() => {
    const compartment = readOnlyCompartmentRef.current;
    const view = viewRef.current;
    if (!compartment || !view) {
      return;
    }
    const roEffect = compartment.reconfigure([
      EditorState.readOnly.of(readOnly),
      EditorView.editable.of(!readOnly),
    ]);
    view.dispatch({effects: roEffect});
    dispatchEskerraTableNestedCellEditors(view, {effects: roEffect});
  }, [readOnly]);

  /**
   * Apply `loadMarkdown` synchronously so the first browser paint after layout already has the real
   * document. A deferred rAF apply runs after paint, which left the placeholder visible until the next frame
   * or user interaction (WebKit/GTK).
   */
  const applyMarkdownLoadNow = useCallback(
    (markdown: string, options?: {selection?: 'start' | 'end' | 'preserve'}) => {
      const v = viewRef.current;
      const be = codemirrorBootExtensionsRef.current;
      const wc = wikiLinkCompartmentRef.current;
      const rc = relativeMdLinkCompartmentRef.current;
      if (!v || !be || !wc || !rc) {
        return;
      }
      beginProgrammaticMarkdownLoad(v);
      try {
        const hadFoldedRanges = foldedRangesPresent(v.state);
        const curLen = v.state.doc.length;
        const curText = v.state.doc.toString();
        const preserve = selectionIsPreserve(options);
        const forced = explicitCursorForMarkdownLoadDispatch(
          options,
          markdown.length,
        );
        const selMatchesForced =
          forced !== undefined && selMatchesForcedCursor(v.state, forced);
        const mergedReplace = shouldUseMergedReplaceForMarkdownLoad({
          hadFoldedRanges,
          curText,
          markdown,
          preserve,
          selMatchesForcedCursor: selMatchesForced,
        });
        const useSetState = shouldUseSetStateBranchForMarkdownLoad({
          hadFoldedRanges,
          curText,
          markdown,
          preserve,
          selMatchesForcedCursor: selMatchesForced,
        });
        const wikiEff = wc.reconfigure(
          wikiLinkResolvedHighlightExtensions(
            wikiLinkTargetIsResolvedRef.current,
          ),
        );
        const relEff = rc.reconfigure(
          markdownRelativeLinkHighlightExtensions(
            relativeMarkdownLinkHrefIsResolvedRef.current,
          ),
        );
        const roComp = readOnlyCompartmentRef.current;
        const roEff =
          roComp != null
            ? roComp.reconfigure([
                EditorState.readOnly.of(readOnlyRef.current),
                EditorView.editable.of(!readOnlyRef.current),
              ])
            : null;
        const effects =
          roEff !== null ? [wikiEff, relEff, roEff] : [wikiEff, relEff];
        if (mergedReplace) {
          const spec: Parameters<EditorView['dispatch']>[0] = {
            changes: preserve
              ? computeMinimalEditorChanges(curText, markdown)
              : {from: 0, to: curLen, insert: markdown},
            annotations: Transaction.addToHistory.of(false),
            effects,
          };
          if (forced !== undefined) {
            spec.selection = EditorSelection.cursor(forced);
          }
          v.dispatch(spec);
          clearEskerraTableNestedCellRegistrations(v);
        } else if (useSetState) {
          const cursorAt = preserve
            ? mapPositionThroughDiff(
                v.state.selection.main.head,
                curText,
                markdown,
              )
            : explicitCursorForMarkdownLoadSetState(
                options,
                markdown.length,
                v.state.selection.main.head,
              );
          const nextState = EditorState.create({
            doc: markdown,
            selection: EditorSelection.cursor(cursorAt),
            extensions: be,
          });
          v.setState(nextState);
          clearEskerraTableNestedCellRegistrations(v);
        }
        if (!mergedReplace) {
          v.dispatch({effects});
        }
        dispatchEskerraTableNestedCellEditors(v, {effects});
        onFoldedRangesPresentChangeRef.current?.(foldedRangesPresent(v.state));
        onFoldableRangesPresentChangeRef.current?.(
          foldableRangesPresent(v.state),
        );
      } finally {
        endProgrammaticMarkdownLoad(v);
      }
    },
    [],
  );

  useImperativeHandle(
    ref,
    () => ({
      getMarkdown: () => {
        const view = viewRef.current;
        if (view) {
          flushAllEskerraTableDrafts(view);
        }
        return view?.state.doc.toString() ?? initialMarkdownRef.current;
      },
      loadMarkdown: (
        markdown: string,
        options?: {selection?: 'start' | 'end' | 'preserve'},
      ) => {
        const view = viewRef.current;
        const bootExtensions = codemirrorBootExtensionsRef.current;
        const wikiCompartment = wikiLinkCompartmentRef.current;
        const relCompartment = relativeMdLinkCompartmentRef.current;
        if (!view || !bootExtensions || !wikiCompartment || !relCompartment) {
          return;
        }
        applyMarkdownLoadNow(markdown, options);
      },
      unfoldAllFolds: () => {
        const view = viewRef.current;
        if (!view) {
          return false;
        }
        return unfoldAll(view);
      },
      collapseAllFolds: () => {
        const view = viewRef.current;
        if (!view) {
          return false;
        }
        return nestedCollapseAllFolds(view);
      },
      replaceWikiLinkInnerAt: ({at, expectedInner, replacementInner}) => {
        if (replacementInner === expectedInner) {
          return true;
        }
        const view = viewRef.current;
        if (!view) {
          return false;
        }
        const match = wikiLinkMatchAtDocPosition(view.state.doc, at);
        if (!match || match.inner !== expectedInner) {
          return false;
        }
        view.dispatch({
          changes: {
            from: match.innerFrom,
            to: match.innerTo,
            insert: replacementInner,
          },
        });
        return true;
      },
      replaceMarkdownLinkHrefAt: ({at, expectedHref, replacementHref}) => {
        if (replacementHref === expectedHref) {
          return true;
        }
        const view = viewRef.current;
        if (!view) {
          return false;
        }
        const linkUrl = markdownInlineLinkUrlAtPosition(view.state, at);
        if (!linkUrl || linkUrl.href !== expectedHref) {
          return false;
        }
        view.dispatch({
          changes: {
            from: linkUrl.hrefFrom,
            to: linkUrl.hrefTo,
            insert: replacementHref,
          },
        });
        return true;
      },
      focus: (options?: {anchor?: number; scrollIntoView?: boolean}) => {
        const view = viewRef.current;
        if (!view) {
          return;
        }
        if (options?.anchor !== undefined) {
          const a = Math.max(
            0,
            Math.min(options.anchor, view.state.doc.length),
          );
          const scroll = options.scrollIntoView !== false;
          view.dispatch({
            selection: EditorSelection.cursor(a),
            ...(scroll ? {scrollIntoView: true} : {}),
          });
        } else if (view.state.doc.length === 0) {
          view.dispatch({
            selection: EditorSelection.cursor(0),
            scrollIntoView: true,
          });
        }
        view.focus();
      },
    }),
    [applyMarkdownLoadNow],
  );

  const insertRelativePaths = useCallback((paths: readonly string[]) => {
    const view = viewRef.current;
    if (!view || paths.length === 0) {
      return;
    }
    const insert = formatVaultImageMarkdownForInsert(paths);
    view.dispatch(view.state.update(view.state.replaceSelection(insert)));
  }, []);

  const [dropActive, setDropActive] = useState(false);

  useEffect(() => {
    const el = hostRef.current;
    if (!el || !attachmentHost.isVaultImageImportAvailable) {
      return;
    }

    const onDragOver = (e: DragEvent) => {
      if (busy) {
        return;
      }
      if (e.dataTransfer?.types.includes('Files')) {
        e.preventDefault();
      }
    };

    const onDrop = (e: DragEvent) => {
      if (busy) {
        return;
      }
      const dt = e.dataTransfer;
      if (!dt?.files?.length) {
        return;
      }
      let maybeImage = false;
      for (let i = 0; i < dt.files.length; i++) {
        const f = dt.files.item(i);
        if (
          f &&
          (f.type.startsWith('image/') ||
            isNoteAttachmentImageFilePath(f.name))
        ) {
          maybeImage = true;
          break;
        }
      }
      if (!maybeImage) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();

      void (async () => {
        try {
          const markdownPaths = await attachmentHost.importDroppedFiles(
            dt.files,
            vaultRoot,
          );
          if (markdownPaths.length === 0) {
            return;
          }
          insertRelativePaths(markdownPaths);
        } catch (err) {
          reportEditorError(
            err instanceof Error ? err.message : String(err),
          );
        }
      })();
    };

    el.addEventListener('dragover', onDragOver);
    el.addEventListener('drop', onDrop);
    return () => {
      el.removeEventListener('dragover', onDragOver);
      el.removeEventListener('drop', onDrop);
    };
  }, [attachmentHost, busy, insertRelativePaths, vaultRoot, reportEditorError]);

  useEffect(() => {
    if (!attachmentHost.isVaultImageImportAvailable) {
      return;
    }
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    attachmentHost
      .subscribeWindowFileDragDrop({
        onDragHover: () => {
          if (!busy) {
            setDropActive(true);
          }
        },
        onDragLeave: () => {
          setDropActive(false);
        },
        onDropPaths: paths => {
          if (busy) {
            return;
          }
          void (async () => {
            try {
              const relPaths =
                await attachmentHost.importDroppedAbsolutePaths(paths);
              insertRelativePaths(relPaths);
            } catch (err) {
              reportEditorError(
                err instanceof Error ? err.message : String(err),
              );
            }
          })();
        },
      })
      .then(fn => {
        if (cancelled) {
          fn();
        } else {
          unlisten = fn;
        }
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [attachmentHost, busy, insertRelativePaths, reportEditorError]);

  const hostClassName = dropActive
    ? 'note-markdown-editor-host note-markdown-editor-host--drop-target'
    : 'note-markdown-editor-host';

  tableCellContextMenuOpenRef.current = d => {
    tableCellMenuViewRef.current = d.view;
    setTableCellMenuAnchor({x: d.clientX, y: d.clientY});
    setTableCellMenuOpen(true);
  };

  const readMarkdownEditorClipboard = useCallback(async () => {
    const r = await attachmentHost.readNativeClipboardPaste(vaultRoot);
    return r.kind === 'text' ? r.text : null;
  }, [attachmentHost, vaultRoot]);

  /**
   * Click in the host padding / flex spacer below `.cm-editor`: jump the caret to end of doc and focus.
   * Gated on `e.target === e.currentTarget` so clicks inside CM (incl. panels) are untouched.
   */
  const onHostMouseDown = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    if (readOnlyRef.current) return;
    if (e.button !== 0) return;
    if (e.target !== e.currentTarget) return;
    const view = viewRef.current;
    if (!view) return;
    e.preventDefault();
    const end = view.state.doc.length;
    view.dispatch({
      selection: EditorSelection.cursor(end),
      scrollIntoView: true,
    });
    view.focus();
  }, []);

  return (
    <>
      <NoteMarkdownEditorContextMenu
        getView={() => viewRef.current}
        readOnly={readOnly}
        busy={busy}
        readClipboardText={readMarkdownEditorClipboard}
        onCleanNote={onCleanNote}
        onMuteDomain={onMuteLinkSnippetDomain ? (domain) => onMuteLinkSnippetDomainRef.current?.(domain) : undefined}
      >
        <div
          ref={hostRef}
          className={hostClassName}
          data-note-markdown-editor
          onMouseDown={onHostMouseDown}
        >
          <div ref={parentRef} className="note-markdown-editor-cm-root" />
        </div>
      </NoteMarkdownEditorContextMenu>
      <MarkdownTableCellContextMenu
        open={tableCellMenuOpen}
        anchor={tableCellMenuAnchor}
        getView={() => tableCellMenuViewRef.current}
        readOnly={readOnly}
        busy={busy}
        readClipboardText={readMarkdownEditorClipboard}
        sanitizePasteText={sanitizeCellInsert}
        onOpenChange={o => {
          if (!o) {
            tableCellMenuViewRef.current = null;
            setTableCellMenuAnchor(null);
          }
          setTableCellMenuOpen(o);
        }}
      />
    </>
  );
});

export const NoteMarkdownEditor = forwardRef<
  NoteMarkdownEditorHandle,
  NoteMarkdownEditorProps
>(function NoteMarkdownEditor(props, ref) {
  return (
    <NoteMarkdownEditorImpl
      key={String(props.sessionKey)}
      ref={ref}
      {...props}
    />
  );
});

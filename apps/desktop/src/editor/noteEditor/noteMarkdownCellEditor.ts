import {
  acceptCompletion,
  closeCompletion,
  completionStatus,
} from '@codemirror/autocomplete';
import {defaultKeymap, history, historyKeymap, indentWithTab} from '@codemirror/commands';
import {commonmarkLanguage} from '@codemirror/lang-markdown';
import {openSearchPanel, search, searchKeymap} from '@codemirror/search';
import {
  Compartment,
  EditorState,
  Prec,
  type Extension,
} from '@codemirror/state';
import {drawSelection, EditorView, keymap} from '@codemirror/view';
import type {MutableRefObject} from 'react';

import {
  isBrowserOpenableMarkdownHref,
  wikiLinkInnerBrowserOpenableHref,
  type InboxWikiLinkCompletionCandidate,
} from '@eskerra/core';

import type {NoteInboxAttachmentHost} from '../../lib/noteInboxAttachmentHost';
import {cleanPastedMarkdownFragment} from '../../lib/markdown/cleanNote';
import {
  createNoteMarkdownPasteHandlers,
  pasteBlockImageWhenImportUnavailable,
  pasteBlockWhileBusy,
} from './noteMarkdownEditorPaste';
import {isActivatableRelativeMarkdownHref} from './markdownActivatableRelativeHref';
import {markdownCodeBackgroundLayer} from './markdownCodeBackgroundLayer';
import {eskerraFenceLanguages} from './eskerraFenceLanguages';
import {MARKDOWN_INPUT_PASTE_USER_EVENT} from './markdownEditorUserEvents';
import {
  noteMarkdownEditorAppearance,
  noteMarkdownIndentUnit,
  noteMarkdownParserExtensions,
} from './markdownEditorStyling';
import {markdownEskerra} from './markdownEskerraLanguage';
import {markdownBareBrowserUrlAtPosition} from './markdownBareUrl';
import {markdownActivatableExternalMdLinkAtPosition} from './markdownActivatableExternalMdLinkAtPosition';
import {markdownActivatableRelativeMdLinkAtPosition} from './markdownActivatableRelativeMdLinkAtPosition';
import {markdownExternalLinkHighlightExtension} from './markdownExternalLinkCodemirror';
import {markdownRelativeLinkHighlightExtensions} from './markdownRelativeLinkCodemirror';
import {wikiLinkAutocompleteExtension} from './wikiLinkAutocomplete';
import {wikiLinkResolvedHighlightExtensions} from './wikiLinkCodemirror';
import type {VaultImagePreviewUrlResolver} from './vaultImagePreviewTypes';
import {vaultImagePreviewExtension} from './vaultImagePreviewCodemirror';
import {
  discardStoredPrimaryPointerDownForLinkClick,
  recordPrimaryPointerDownForLinkClick,
  resolvePrimaryLinkClickContext,
} from './linkClickUseMousedownPosition';
import {wikiLinkPointerActivatableInnerAtDocPosition} from './wikiLinkInnerAtDocPosition';
import {multiCaretClickAddsSelectionRangeExtension} from './multiCaretClick';
import {eolMarkerCaretPointerFixExtension} from './eolMarkerCaretPointerFix';
import {
  buildNoteMarkdownDeleteLineModYBindings,
  buildNoteMarkdownDuplicateLineModDBindings,
  buildNoteMarkdownVaultKeymapBindings,
} from './noteMarkdownCoreKeymap';
import {
  markdownFormattingModKeymap,
  markdownInlineCodeSurroundInputHandler,
  markdownSelectionAllowMultipleRanges,
  markdownSelectionSurroundKeymap,
} from './markdownSelectionSurround';
import {markdownSmartExpandExtension} from './markdownSmartExpandSelection';
import {markdownCaseToggleKeymap} from './markdownCaseToggle';
import type {
  VaultRelativeMarkdownLinkActivatePayload,
  VaultWikiLinkActivatePayload,
} from './vaultLinkActivatePayload';

function eskerraCellCharFilter(): Extension {
  return EditorState.transactionFilter.of(tr => {
    if (!tr.docChanged) {
      return tr;
    }
    const next = tr.changes.apply(tr.startState.doc).toString();
    if (next.includes('|') || next.includes('\n') || next.includes('\r')) {
      return [];
    }
    return tr;
  });
}

/** Exported for table cell context menu paste (strip pipe / newlines). */
export function sanitizeCellInsert(s: string): string {
  return s.replace(/[\r\n|]+/g, ' ').trim();
}

export type TableCellContextMenuOpen = (detail: {
  clientX: number;
  clientY: number;
  view: EditorView;
}) => void;

export type EskerraTableCellKeyboardCallbacks = {
  onTabFromCell: (shift: boolean) => boolean;
  onEnterFromCell: () => boolean;
  onEscapeFromCell: () => boolean;
};

export type NoteMarkdownCellEditorCallbacks =
  MutableRefObject<EskerraTableCellKeyboardCallbacks>;

export type BuildNoteMarkdownCellExtensionsArgs = {
  wikiLinkTargetIsResolved: (inner: string) => boolean;
  relativeMarkdownLinkHrefIsResolved: (href: string) => boolean;
  wikiLinkCompletionCandidates: () => readonly InboxWikiLinkCompletionCandidate[];
  vaultRootRef: MutableRefObject<string>;
  activeNotePathRef: MutableRefObject<string | null>;
  resolveVaultImagePreviewUrl: VaultImagePreviewUrlResolver;
  attachmentHostRef: MutableRefObject<NoteInboxAttachmentHost>;
  busyRef: MutableRefObject<boolean>;
  onWikiLinkActivate: (payload: VaultWikiLinkActivatePayload) => void;
  onMarkdownRelativeLinkActivate: (
    payload: VaultRelativeMarkdownLinkActivatePayload,
  ) => void;
  onMarkdownExternalLinkOpen: (payload: {href: string; at: number}) => void;
  onSaveShortcut?: () => void;
  onDeleteNoteShortcut?: () => void;
  onReportError: (message: string) => void;
  onDocChanged: () => void;
  tableCallbacks: NoteMarkdownCellEditorCallbacks;
  wikiLinkCompartment: Compartment;
  relativeMdLinkCompartment: Compartment;
  /** Bumped when the cell editor is recreated so async paste ignores stale callbacks. */
  pasteSessionRef: MutableRefObject<number>;
  pasteSessionId: number;
  /**
   * When set (table shell), Mod-f flushes the shell draft and opens find on the parent note editor
   * instead of a per-cell search panel.
   */
  onOpenNoteWideFind?: () => void;
  /** When set, right-click opens the shared markdown context menu (bridge to React layer). */
  tableCellContextMenuOpenRef?: MutableRefObject<TableCellContextMenuOpen | null>;
};

export type EskerraTableCellBundlePartial = Pick<
  BuildNoteMarkdownCellExtensionsArgs,
  | 'tableCallbacks'
  | 'wikiLinkCompartment'
  | 'relativeMdLinkCompartment'
  | 'onDocChanged'
  | 'onReportError'
  | 'pasteSessionRef'
  | 'pasteSessionId'
  | 'onOpenNoteWideFind'
>;

export type EskerraCellBundleFactory = (
  partial: EskerraTableCellBundlePartial,
) => readonly Extension[];

/**
 * Markdown editing extensions aligned with the main note editor, for one-line table cells.
 */
export function buildNoteMarkdownCellExtensions(
  args: BuildNoteMarkdownCellExtensionsArgs,
): readonly Extension[] {
  const {
    wikiLinkCompartment,
    relativeMdLinkCompartment,
    wikiLinkTargetIsResolved,
    relativeMarkdownLinkHrefIsResolved,
    wikiLinkCompletionCandidates,
    vaultRootRef,
    activeNotePathRef,
    resolveVaultImagePreviewUrl,
    attachmentHostRef,
    busyRef,
    onWikiLinkActivate,
    onMarkdownRelativeLinkActivate,
    onMarkdownExternalLinkOpen,
    onSaveShortcut,
    onDeleteNoteShortcut,
    onReportError,
    onDocChanged,
    onOpenNoteWideFind,
    tableCellContextMenuOpenRef,
    tableCallbacks: tc,
  } = args;

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
    const click = resolvePrimaryLinkClickContext(view, e);
    const pos = click.pos;
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
      onWikiLinkActivate({inner, at: pos});
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
      onMarkdownRelativeLinkActivate({href: relHit.href, at: relHit.hrefFrom});
      return true;
    }
    const extHit = click.markerFocusLine
      ? markdownActivatableRelativeMdLinkAtPosition(
        view.state,
        pos,
        isBrowserOpenableMarkdownHref,
      )
      : markdownActivatableExternalMdLinkAtPosition(
        view.state,
        pos,
      );
    if (extHit) {
      e.preventDefault();
      e.stopPropagation();
      onMarkdownExternalLinkOpen({href: extHit.href, at: extHit.hrefFrom});
      return true;
    }
    const bareHit = markdownBareBrowserUrlAtPosition(view.state, pos);
    if (bareHit) {
      e.preventDefault();
      e.stopPropagation();
      onMarkdownExternalLinkOpen({href: bareHit.href, at: bareHit.hrefFrom});
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
      onWikiLinkActivate({inner, at: pos, openInBackgroundTab: true});
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
      onMarkdownRelativeLinkActivate({
        href: relHit.href,
        at: relHit.hrefFrom,
        openInBackgroundTab: true,
      });
      return true;
    }
    return false;
  };

  const sharedPaste = createNoteMarkdownPasteHandlers({
    vaultRootRef,
    attachmentHostRef,
    activeNotePathRef,
    busyRef,
    reportError: onReportError,
    isStaleView: () => args.pasteSessionRef.current !== args.pasteSessionId,
    normalizePastedMarkdown: md =>
      sanitizeCellInsert(
        cleanPastedMarkdownFragment(md, activeNotePathRef.current),
      ),
    normalizeNativeClipboardText: sanitizeCellInsert,
    normalizeImageMarkdownInsert: insert =>
      insert.replace(/\s+/g, ' ').trim(),
    consumeEmptyHtmlPaste: false,
  });

  const runCellEditorPastePlainPipes = (
    event: ClipboardEvent,
    view: EditorView,
  ): boolean => {
    const plain = event.clipboardData?.getData('text/plain') ?? '';
    if (!plain.includes('|') && !plain.includes('\n') && !plain.includes('\r')) {
      return false;
    }
    event.preventDefault();
    const cleaned = sanitizeCellInsert(plain);
    if (cleaned.length > 0) {
      const sel = view.state.selection.main;
      const f = Math.min(sel.anchor, sel.head);
      const t = Math.max(sel.anchor, sel.head);
      view.dispatch({
        changes: {from: f, to: t, insert: cleaned},
        selection: {anchor: f + cleaned.length},
        userEvent: MARKDOWN_INPUT_PASTE_USER_EVENT,
      });
    }
    return true;
  };

  const pasteHandlers = EditorView.domEventHandlers({
    mousedown(event, view) {
      recordPrimaryPointerDownForLinkClick(view, event);
      if (event.button !== 1) {
        return false;
      }
      sharedPaste.armMiddleClickPasteBlock();
      if (onEditorMiddleClick(event, view)) {
        return true;
      }
      event.preventDefault();
      return true;
    },
    paste(event, view) {
      if (sharedPaste.isMiddleClickPasteBlocked()) {
        event.preventDefault();
        return true;
      }
      if (pasteBlockWhileBusy(event, busyRef, onReportError)) {
        return true;
      }
      if (
        pasteBlockImageWhenImportUnavailable(
          event,
          attachmentHostRef,
          onReportError,
        )
      ) {
        return true;
      }
      const dt = event.clipboardData;
      if (dt) {
        const r = sharedPaste.runPasteFromDataTransfer(dt, event, view);
        if (r != null) {
          return r;
        }
      }
      return runCellEditorPastePlainPipes(event, view);
    },
    click: onEditorClick,
    contextmenu(event, view) {
      if (event.button !== 2) {
        return false;
      }
      const openMenu = tableCellContextMenuOpenRef?.current;
      if (!openMenu) {
        return false;
      }
      event.preventDefault();
      event.stopPropagation();
      openMenu({
        clientX: event.clientX,
        clientY: event.clientY,
        view,
      });
      return true;
    },
  });

  const tableNavKeymap = keymap.of([
    {key: 'Tab', run: () => tc.current.onTabFromCell(false)},
    {key: 'Shift-Tab', run: () => tc.current.onTabFromCell(true)},
    {
      key: 'Enter',
      run: view => {
        const status = completionStatus(view.state);
        if (status === 'pending') {
          return true;
        }
        if (status === 'active') {
          return acceptCompletion(view) || true;
        }
        return tc.current.onEnterFromCell();
      },
    },
    {
      key: 'Escape',
      run: view => {
        const status = completionStatus(view.state);
        if (status) {
          return closeCompletion(view) || true;
        }
        return tc.current.onEscapeFromCell();
      },
    },
    {key: '|', run: () => true},
  ]);

  const noteWideFindKeymap = Prec.highest(
    keymap.of([
      {
        key: 'Mod-f',
        run: view => {
          if (onOpenNoteWideFind) {
            onOpenNoteWideFind();
            return true;
          }
          return openSearchPanel(view);
        },
      },
    ]),
  );

  return [
    noteMarkdownIndentUnit,
    markdownEskerra({
      base: commonmarkLanguage,
      extensions: noteMarkdownParserExtensions,
      codeLanguages: eskerraFenceLanguages,
    }),
    ...noteMarkdownEditorAppearance,
    history(),
    drawSelection(),
    markdownCodeBackgroundLayer,
    multiCaretClickAddsSelectionRangeExtension(),
    markdownSelectionAllowMultipleRanges(),
    ...markdownSmartExpandExtension(),
    markdownSelectionSurroundKeymap(),
    markdownFormattingModKeymap(),
    markdownCaseToggleKeymap(),
    markdownInlineCodeSurroundInputHandler(),
    ...(onOpenNoteWideFind ? [] : [search()]),
    eskerraCellCharFilter(),
    Prec.highest(tableNavKeymap),
    noteWideFindKeymap,
    keymap.of([
      ...buildNoteMarkdownVaultKeymapBindings({
        onSaveShortcut,
        onDeleteNoteShortcut,
        onWikiLinkActivate,
        onMarkdownRelativeLinkActivate,
        onMarkdownExternalLinkOpen,
      }),
      indentWithTab,
      ...defaultKeymap,
      ...buildNoteMarkdownDuplicateLineModDBindings(),
      ...(onOpenNoteWideFind ? [] : searchKeymap),
      ...buildNoteMarkdownDeleteLineModYBindings(),
      ...historyKeymap,
    ]),
    EditorView.lineWrapping,
    wikiLinkCompartment.of(
      wikiLinkResolvedHighlightExtensions(wikiLinkTargetIsResolved),
    ),
    relativeMdLinkCompartment.of(
      markdownRelativeLinkHighlightExtensions(relativeMarkdownLinkHrefIsResolved),
    ),
    markdownExternalLinkHighlightExtension(),
    ...wikiLinkAutocompleteExtension(wikiLinkCompletionCandidates),
    ...vaultImagePreviewExtension({
      vaultRoot: vaultRootRef,
      activeNotePath: activeNotePathRef,
      resolvePreviewUrl: (vr, ap, src) =>
        resolveVaultImagePreviewUrl(vr, ap, src),
    }),
    pasteHandlers,
    EditorView.theme({
      '&': {
        height: '100%',
        minHeight: '1.4em',
      },
      '&.cm-focused': {
        outline: 'none',
      },
      '.cm-scroller': {
        fontFamily: 'inherit',
        overflow: 'auto',
      },
      '.cm-content': {
        caretColor: 'inherit',
      },
      '&.cm-focused .cm-cursor': {
        borderLeftColor: 'inherit',
      },
    }),
    eolMarkerCaretPointerFixExtension(),
    EditorView.updateListener.of(update => {
      if (update.docChanged) {
        onDocChanged();
      }
    }),
  ];
}

import {defaultKeymap, history, historyKeymap, indentWithTab} from '@codemirror/commands';
import {foldGutter, foldKeymap} from '@codemirror/language';
import {commonmarkLanguage} from '@codemirror/lang-markdown';
import {searchKeymap} from '@codemirror/search';
import {
  Compartment,
  EditorState,
  type Extension,
} from '@codemirror/state';
import {
  drawSelection,
  EditorView,
  keymap,
  placeholder,
} from '@codemirror/view';
import type {MutableRefObject} from 'react';

import type {InboxWikiLinkCompletionCandidate} from '@eskerra/core';

import type {NoteInboxAttachmentHost} from '../../lib/noteInboxAttachmentHost';
import {markdownCodeBackgroundLayer} from './markdownCodeBackgroundLayer';
import {eskerraFenceLanguages} from './eskerraFenceLanguages';
import {
  noteMarkdownEditorAppearance,
  noteMarkdownIndentUnit,
  noteMarkdownListItemFoldService,
  noteMarkdownParserExtensions,
} from './markdownEditorStyling';
import {markdownEskerra} from './markdownEskerraLanguage';
import {foldableRangesPresent} from './nestedFoldAll';
import {
  vaultImagePreviewExtension,
} from './vaultImagePreviewCodemirror';
import {todayHubSectionMarkerExtension} from './todayHubSectionMarkerCodemirror';
import {linkRichPreviewExtension, type LinkRichPreviewRefs} from './linkRichPreviewCodemirror';
import {markdownExternalLinkHighlightExtension} from './markdownExternalLinkCodemirror';
import {markdownRelativeLinkHighlightExtensions} from './markdownRelativeLinkCodemirror';
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
  type TableCellContextMenuOpen,
} from './noteMarkdownCellEditor';
import {
  buildNoteMarkdownDeleteLineModYBindings,
  buildNoteMarkdownDuplicateLineModDBindings,
  buildNoteMarkdownVaultKeymapBindings,
} from './noteMarkdownCoreKeymap';
import {markdownSmartExpandExtension} from './markdownSmartExpandSelection';
import {markdownCaseToggleKeymap} from './markdownCaseToggle';
import {eskerraTableV1Extension} from './eskerraTableV1/eskerraTableV1Codemirror';
import {recordPrimaryPointerDownForLinkClick} from './linkClickUseMousedownPosition';
import {multiCaretClickAddsSelectionRangeExtension} from './multiCaretClick';
import {caretJumpDetectorExtension} from './caretJumpDetector';
import {eolMarkerCaretPointerFixExtension} from './eolMarkerCaretPointerFix';
import {
  createFoldGutterMarker,
  foldedRangesPresent,
} from './noteMarkdownFoldStatus';
import {noteMarkdownSearchExtensionBundle} from './noteMarkdownSearchExtension';
import type {
  VaultRelativeMarkdownLinkActivatePayload,
  VaultWikiLinkActivatePayload,
} from './vaultLinkActivatePayload';
import type {VaultImagePreviewUrlResolver} from './vaultImagePreviewTypes';

export type NoteMarkdownEditorExtensionsInput = {
  readOnly: boolean;
  readOnlyCompartment: Compartment;
  showFoldGutter: boolean;
  placeholderText: string;
  wikiLinkCompartment: Compartment;
  relativeMdLinkCompartment: Compartment;
  wikiLinkTargetIsResolved: (inner: string) => boolean;
  relativeMarkdownLinkHrefIsResolved: (href: string) => boolean;
  wikiLinkCompletionCandidatesRef: MutableRefObject<
    readonly InboxWikiLinkCompletionCandidate[]
  >;
  vaultRootRef: MutableRefObject<string>;
  activeNotePathRef: MutableRefObject<string | null>;
  resolveVaultImagePreviewUrlRef: MutableRefObject<VaultImagePreviewUrlResolver>;
  attachmentHostRef: MutableRefObject<NoteInboxAttachmentHost>;
  busyRef: MutableRefObject<boolean>;
  tableCellContextMenuOpenRef: MutableRefObject<TableCellContextMenuOpen | null>;
  linkRichPreviewRefs: LinkRichPreviewRefs;
  onWikiLinkActivateRef: MutableRefObject<
    (payload: VaultWikiLinkActivatePayload) => void
  >;
  onMarkdownRelativeLinkActivateRef: MutableRefObject<
    (payload: VaultRelativeMarkdownLinkActivatePayload) => void
  >;
  onMarkdownExternalLinkOpenRef: MutableRefObject<
    (payload: {href: string; at: number}) => void
  >;
  onSaveShortcutRef: MutableRefObject<(() => void) | undefined>;
  onDeleteNoteShortcutRef: MutableRefObject<(() => void) | undefined>;
  wikiLinkTargetIsResolvedRef: MutableRefObject<(inner: string) => boolean>;
  relativeMarkdownLinkHrefIsResolvedRef: MutableRefObject<
    (href: string) => boolean
  >;
  onMarkdownChangeRef: MutableRefObject<(markdown: string) => void>;
  onFoldedRangesPresentChangeRef: MutableRefObject<
    ((present: boolean) => void) | undefined
  >;
  onFoldableRangesPresentChangeRef: MutableRefObject<
    ((present: boolean) => void) | undefined
  >;
  readOnlyRef: MutableRefObject<boolean>;
  onEditableBlurRef: MutableRefObject<(() => void) | undefined>;
  onEditorPaste: (e: ClipboardEvent, view: EditorView) => boolean;
  armMiddleClickPasteBlock: () => void;
  onEditorMiddleClick: (e: MouseEvent, view: EditorView) => boolean;
  onEditorClick: (e: MouseEvent, view: EditorView) => boolean;
};

export function createNoteMarkdownUpdateListener(
  input: Pick<
    NoteMarkdownEditorExtensionsInput,
    | 'onMarkdownChangeRef'
    | 'onFoldableRangesPresentChangeRef'
    | 'onFoldedRangesPresentChangeRef'
    | 'readOnlyRef'
    | 'onEditableBlurRef'
  >,
): Extension {
  const {
    onMarkdownChangeRef,
    onFoldableRangesPresentChangeRef,
    onFoldedRangesPresentChangeRef,
    readOnlyRef,
    onEditableBlurRef,
  } = input;

  return EditorView.updateListener.of(update => {
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
  });
}

export function buildNoteMarkdownEditorExtensions(
  input: NoteMarkdownEditorExtensionsInput,
): Extension[] {
  const {
    readOnly,
    readOnlyCompartment,
    showFoldGutter,
    placeholderText,
    wikiLinkCompartment,
    relativeMdLinkCompartment,
    wikiLinkTargetIsResolved,
    relativeMarkdownLinkHrefIsResolved,
    wikiLinkCompletionCandidatesRef,
    vaultRootRef,
    activeNotePathRef,
    resolveVaultImagePreviewUrlRef,
    attachmentHostRef,
    busyRef,
    tableCellContextMenuOpenRef,
    linkRichPreviewRefs,
    onWikiLinkActivateRef,
    onMarkdownRelativeLinkActivateRef,
    onMarkdownExternalLinkOpenRef,
    onSaveShortcutRef,
    onDeleteNoteShortcutRef,
    wikiLinkTargetIsResolvedRef,
    relativeMarkdownLinkHrefIsResolvedRef,
    onEditorPaste,
    armMiddleClickPasteBlock,
    onEditorMiddleClick,
    onEditorClick,
  } = input;

  return [
    noteMarkdownIndentUnit,
    readOnlyCompartment.of([
      EditorState.readOnly.of(readOnly),
      EditorView.editable.of(!readOnly),
    ]),
    markdownEskerra({
      base: commonmarkLanguage,
      extensions: noteMarkdownParserExtensions,
      codeLanguages: eskerraFenceLanguages,
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
    markdownCaseToggleKeymap(),
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
    linkRichPreviewExtension(linkRichPreviewRefs),
    EditorView.domEventHandlers({
      mousedown(event, view) {
        recordPrimaryPointerDownForLinkClick(view, event);
        if (event.button !== 1) {
          return false;
        }
        armMiddleClickPasteBlock();
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
        backgroundColor: 'transparent',
        border: 'none',
      },
      '.cm-foldGutter': {
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
    createNoteMarkdownUpdateListener(input),
  ];
}

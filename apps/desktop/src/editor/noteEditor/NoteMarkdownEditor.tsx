import {EditorSelection, EditorState} from '@codemirror/state';
import {EditorView} from '@codemirror/view';
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
import {createPortal} from 'react-dom';

import {
  todayHubPerfEnabled,
  todayHubPerfLog,
} from '../../lib/todayHub/todayHubPerf';
import {buildNoteMarkdownEditorExtensions} from './buildNoteMarkdownEditorExtensions';
import {MarkdownTableCellContextMenu} from './MarkdownTableCellContextMenu';
import {NoteMarkdownEditorContextMenu} from './NoteMarkdownEditorContextMenu';
import {sanitizeCellInsert} from './noteMarkdownCellEditor';
import {createNoteMarkdownEditorHandle} from './noteMarkdownEditorImperativeHandle';
import {
  createNoteMarkdownPasteHandlers,
  normalizeMainEditorPastedMarkdown,
} from './noteMarkdownEditorPaste';
import {createNoteMarkdownPointerLinkHandlers} from './noteMarkdownPointerLinks';
import {foldedRangesPresent} from './noteMarkdownFoldStatus';
import {foldableRangesPresent} from './nestedFoldAll';
import type {
  NoteMarkdownEditorHandle,
  NoteMarkdownEditorProps,
} from './noteMarkdownEditorTypes';
import {useNoteMarkdownEditorCompartmentEffects} from './useNoteMarkdownEditorCompartmentEffects';
import {useNoteMarkdownEditorImageDrop} from './useNoteMarkdownEditorImageDrop';
import {useNoteMarkdownEditorLoad} from './useNoteMarkdownEditorLoad';
import {useNoteMarkdownEditorShellRefs} from './useNoteMarkdownEditorShellRefs';
import {DateTimePicker} from './dateToken/DateTimePicker';
import {
  formatDateToken,
  type DateTokenValue,
} from './dateToken/dateToken';
import {
  clampDateTokenPickerOverlayPosition,
  DATE_TOKEN_PICKER_OVERLAY_GAP_PX,
  type DateTokenPickerOverlayAnchor,
  type DateTokenPickerOverlayPosition,
} from './dateToken/dateTokenPickerOverlayPosition';
import type {
  DateTokenPickerOpenHandler,
  DateTokenPickerOpenRequest,
} from './dateToken/dateTokenTrigger';

export type {
  NoteMarkdownEditorHandle,
  NoteMarkdownEditorProps,
} from './noteMarkdownEditorTypes';

type DateTokenPickerOverlayState = {
  readonly anchorRect: DateTokenPickerOverlayAnchor;
  readonly initialValue: DateTokenValue | null;
  readonly commit: (value: DateTokenValue) => void;
};

function fallbackDateTokenAnchorRect(view: EditorView): DateTokenPickerOverlayAnchor {
  const rect = view.dom.getBoundingClientRect();
  const anchorY = rect.top + 24;
  return {
    left: rect.left + 24,
    top: anchorY,
    bottom: anchorY,
  };
}

function dateTokenOverlayAnchorFromRequest(
  request: DateTokenPickerOpenRequest,
): DateTokenPickerOverlayAnchor {
  if (request.anchorRect) {
    return {
      left: request.anchorRect.left,
      top: request.anchorRect.top,
      bottom: request.anchorRect.bottom,
    };
  }
  return fallbackDateTokenAnchorRect(request.view);
}

function buildDateTokenPickerOverlayState(
  request: DateTokenPickerOpenRequest,
): DateTokenPickerOverlayState {
  const insertTrailingSpace = request.initialValue == null;
  let tokenEnd = request.tokenTo;
  return {
    anchorRect: dateTokenOverlayAnchorFromRequest(request),
    initialValue: request.initialValue ?? null,
    commit: value => {
      const view = request.view;
      if (!view.state.facet(EditorView.editable)) {
        return;
      }
      const token = formatDateToken(value);
      const replacement = insertTrailingSpace ? `${token} ` : token;
      const currentDocLength = view.state.doc.length;
      const from = Math.max(0, Math.min(request.tokenFrom, currentDocLength));
      const requestedTo = insertTrailingSpace
        ? view.state.selection.main.head
        : tokenEnd;
      const to = Math.max(from, Math.min(requestedTo, currentDocLength));
      view.dispatch({
        changes: {from, to, insert: replacement},
        selection: {anchor: from + replacement.length},
        scrollIntoView: true,
      });
      tokenEnd = from + replacement.length;
    },
  };
}

const NoteMarkdownEditorImpl = forwardRef<
  NoteMarkdownEditorHandle,
  NoteMarkdownEditorProps
>(function NoteMarkdownEditorImpl(props, ref) {
  const {
    initialMarkdown,
    onCleanNote,
    placeholder: placeholderText,
    busy,
    showFoldGutter = true,
    readOnly: readOnlyProp = false,
    wikiLinkTargetIsResolved,
    relativeMarkdownLinkHrefIsResolved,
    attachmentHost,
    vaultRoot,
  } = props;

  const readOnly = readOnlyProp;
  const shell = useNoteMarkdownEditorShellRefs(props, readOnly);

  const tableCellMenuViewRef = useRef<EditorView | null>(null);
  const onOpenDateTokenPickerRef = useRef<DateTokenPickerOpenHandler | undefined>(
    undefined,
  );
  const dateTokenPickerOverlayRef = useRef<HTMLDivElement | null>(null);
  const [dateTokenPicker, setDateTokenPicker] =
    useState<DateTokenPickerOverlayState | null>(null);
  const [dateTokenPickerOverlayPosition, setDateTokenPickerOverlayPosition] =
    useState<DateTokenPickerOverlayPosition | null>(null);
  const [tableCellMenuOpen, setTableCellMenuOpen] = useState(false);
  const [tableCellMenuAnchor, setTableCellMenuAnchor] = useState<{
    x: number;
    y: number;
  } | null>(null);

  const pasteHandlersRef = useRef(
    createNoteMarkdownPasteHandlers({
      vaultRootRef: shell.vaultRootRef,
      attachmentHostRef: shell.attachmentHostRef,
      activeNotePathRef: shell.activeNotePathRef,
      busyRef: shell.busyRef,
      reportError: shell.reportEditorError,
      isStaleView: viewForPaste =>
        shell.viewRef.current !== viewForPaste,
      normalizePastedMarkdown: md =>
        normalizeMainEditorPastedMarkdown(md, shell.activeNotePathRef.current),
    }),
  );

  const applyMarkdownLoadNow = useNoteMarkdownEditorLoad(shell);

  useNoteMarkdownEditorCompartmentEffects(
    shell,
    wikiLinkTargetIsResolved,
    relativeMarkdownLinkHrefIsResolved,
    readOnly,
  );

  const {hostClassName} = useNoteMarkdownEditorImageDrop(
    shell.hostRef,
    shell.viewRef,
    shell.reportEditorError,
    attachmentHost,
    vaultRoot,
    busy,
  );

  useLayoutEffect(() => {
    const parent = shell.parentRef.current;
    if (!parent) {
      return;
    }

    const hubPerfStart =
      todayHubPerfEnabled() && !showFoldGutter ? performance.now() : 0;

    const paste = pasteHandlersRef.current;
    const {onEditorClick, onEditorMiddleClick} =
      createNoteMarkdownPointerLinkHandlers({
        onOpenDateTokenPicker: () => onOpenDateTokenPickerRef.current,
        onWikiLinkActivate: p => shell.onWikiLinkActivateRef.current(p),
        onMarkdownRelativeLinkActivate: p =>
          shell.onMarkdownRelativeLinkActivateRef.current(p),
        onMarkdownExternalLinkOpen: p =>
          shell.onMarkdownExternalLinkOpenRef.current(p),
      });

    const extensions = buildNoteMarkdownEditorExtensions({
      readOnly,
      readOnlyCompartment: shell.readOnlyCompartmentRef.current,
      showFoldGutter,
      placeholderText,
      wikiLinkCompartment: shell.wikiLinkCompartmentRef.current,
      relativeMdLinkCompartment: shell.relativeMdLinkCompartmentRef.current,
      wikiLinkTargetIsResolved,
      relativeMarkdownLinkHrefIsResolved,
      wikiLinkCompletionCandidatesRef: shell.wikiLinkCompletionCandidatesRef,
      vaultRootRef: shell.vaultRootRef,
      activeNotePathRef: shell.activeNotePathRef,
      resolveVaultImagePreviewUrlRef: shell.resolveVaultImagePreviewUrlRef,
      attachmentHostRef: shell.attachmentHostRef,
      busyRef: shell.busyRef,
      tableCellContextMenuOpenRef: shell.tableCellContextMenuOpenRef,
      linkRichPreviewRefs: shell.linkRichPreviewRefsRef.current,
      onWikiLinkActivateRef: shell.onWikiLinkActivateRef,
      onMarkdownRelativeLinkActivateRef:
        shell.onMarkdownRelativeLinkActivateRef,
      onMarkdownExternalLinkOpenRef: shell.onMarkdownExternalLinkOpenRef,
      onOpenDateTokenPickerRef,
      onSaveShortcutRef: shell.onSaveShortcutRef,
      modEnterSaveWhenNoLinkRef: shell.modEnterSaveWhenNoLinkRef,
      onDeleteNoteShortcutRef: shell.onDeleteNoteShortcutRef,
      wikiLinkTargetIsResolvedRef: shell.wikiLinkTargetIsResolvedRef,
      relativeMarkdownLinkHrefIsResolvedRef:
        shell.relativeMarkdownLinkHrefIsResolvedRef,
      onMarkdownChangeRef: shell.onMarkdownChangeRef,
      onFoldedRangesPresentChangeRef: shell.onFoldedRangesPresentChangeRef,
      onFoldableRangesPresentChangeRef: shell.onFoldableRangesPresentChangeRef,
      readOnlyRef: shell.readOnlyRef,
      onEditableBlurRef: shell.onEditableBlurRef,
      onEditorPaste: paste.onEditorPaste,
      armMiddleClickPasteBlock: paste.armMiddleClickPasteBlock,
      onEditorMiddleClick,
      onEditorClick,
    });

    shell.codemirrorBootExtensionsRef.current = extensions;

    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: initialMarkdown,
        extensions,
      }),
    });
    shell.viewRef.current = view;
    shell.onFoldedRangesPresentChangeRef.current?.(foldedRangesPresent(view.state));
    shell.onFoldableRangesPresentChangeRef.current?.(
      foldableRangesPresent(view.state),
    );

    if (hubPerfStart) {
      todayHubPerfLog('hub_cm_boot', {
        cmInitMs: Math.round(performance.now() - hubPerfStart),
      });
    }

    return () => {
      shell.onFoldedRangesPresentChangeRef.current?.(false);
      shell.onFoldableRangesPresentChangeRef.current?.(false);
      view.destroy();
      shell.viewRef.current = null;
      shell.codemirrorBootExtensionsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- remount via `sessionKey` wraps this component
  }, []);

  useLayoutEffect(() => {
    shell.tableCellContextMenuOpenRef.current = d => {
      tableCellMenuViewRef.current = d.view;
      setTableCellMenuAnchor({x: d.clientX, y: d.clientY});
      setTableCellMenuOpen(true);
    };
  });

  useLayoutEffect(() => {
    onOpenDateTokenPickerRef.current = request => {
      if (shell.readOnlyRef.current) {
        return;
      }
      setDateTokenPicker(buildDateTokenPickerOverlayState(request));
    };
    return () => {
      onOpenDateTokenPickerRef.current = undefined;
    };
  }, [shell.readOnlyRef]);

  useLayoutEffect(() => {
    if (!dateTokenPicker) {
      setDateTokenPickerOverlayPosition(null);
      return;
    }

    const measureAndClamp = () => {
      const overlay = dateTokenPickerOverlayRef.current;
      if (!overlay) {
        return;
      }
      const {width, height} = overlay.getBoundingClientRect();
      setDateTokenPickerOverlayPosition(
        clampDateTokenPickerOverlayPosition(
          dateTokenPicker.anchorRect,
          {width, height},
          {width: window.innerWidth, height: window.innerHeight},
        ),
      );
    };

    measureAndClamp();

    const overlay = dateTokenPickerOverlayRef.current;
    let resizeObserver: ResizeObserver | null = null;
    if (overlay && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(measureAndClamp);
      resizeObserver.observe(overlay);
    }
    window.addEventListener('resize', measureAndClamp);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', measureAndClamp);
    };
  }, [dateTokenPicker]);

  useEffect(() => {
    if (!dateTokenPicker) {
      return;
    }
    const view = shell.viewRef.current;
    if (!view) {
      return;
    }
    const onEditorScroll = () => {
      setDateTokenPicker(null);
    };
    view.scrollDOM.addEventListener('scroll', onEditorScroll, {passive: true});
    return () => {
      view.scrollDOM.removeEventListener('scroll', onEditorScroll);
    };
  }, [dateTokenPicker, shell.viewRef]);

  useEffect(() => {
    if (!dateTokenPicker) {
      return;
    }
    const onDocumentPointerDown = (event: PointerEvent) => {
      const overlay = dateTokenPickerOverlayRef.current;
      if (!overlay) {
        return;
      }
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (overlay.contains(target)) {
        return;
      }
      setDateTokenPicker(null);
    };
    document.addEventListener('pointerdown', onDocumentPointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', onDocumentPointerDown, true);
    };
  }, [dateTokenPicker]);

  useImperativeHandle(
    ref,
    () => createNoteMarkdownEditorHandle(shell, applyMarkdownLoadNow),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handle reads shell refs
    [applyMarkdownLoadNow],
  );

  const readMarkdownEditorClipboard = useCallback(async () => {
    const r = await attachmentHost.readNativeClipboardPaste(vaultRoot);
    return r.kind === 'text' ? r.text : null;
  }, [attachmentHost, vaultRoot]);

  const onHostMouseDown = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    if (shell.readOnlyRef.current) return;
    if (e.button !== 0) return;
    if (e.target !== e.currentTarget) return;
    const view = shell.viewRef.current;
    if (!view) return;
    e.preventDefault();
    const end = view.state.doc.length;
    view.dispatch({
      selection: EditorSelection.cursor(end),
      scrollIntoView: true,
    });
    view.focus();
  }, [shell.viewRef, shell.readOnlyRef]);

  return (
    <>
      <NoteMarkdownEditorContextMenu
        getView={() => shell.viewRef.current}
        readOnly={readOnly}
        busy={busy}
        readClipboardText={readMarkdownEditorClipboard}
        onCleanNote={onCleanNote}
        onMuteDomain={
          props.onMuteLinkSnippetDomain
            ? domain => shell.onMuteLinkSnippetDomainRef.current?.(domain)
            : undefined
        }
      >
        <div
          ref={shell.hostRef}
          className={hostClassName}
          data-note-markdown-editor
          onMouseDown={onHostMouseDown}
        >
          <div
            ref={shell.parentRef}
            className="note-markdown-editor-cm-root"
          />
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
      {dateTokenPicker
        ? createPortal(
            <div
              ref={dateTokenPickerOverlayRef}
              data-date-token-picker-overlay
              style={{
                position: 'fixed',
                left:
                  dateTokenPickerOverlayPosition?.left
                  ?? dateTokenPicker.anchorRect.left,
                top:
                  dateTokenPickerOverlayPosition?.top
                  ?? dateTokenPicker.anchorRect.bottom
                    + DATE_TOKEN_PICKER_OVERLAY_GAP_PX,
                zIndex: 320,
              }}
            >
              <DateTimePicker
                initialValue={dateTokenPicker.initialValue}
                onConfirm={dateTokenPicker.commit}
                onCancel={() => setDateTokenPicker(null)}
              />
            </div>,
            document.body,
          )
        : null}
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

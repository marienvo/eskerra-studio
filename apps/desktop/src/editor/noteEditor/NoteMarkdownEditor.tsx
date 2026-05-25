import {EditorSelection, EditorState} from '@codemirror/state';
import {EditorView} from '@codemirror/view';
import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';

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
import {
  foldableRangesPresent,
  foldedRangesPresent,
} from './noteMarkdownFoldStatus';
import type {
  NoteMarkdownEditorHandle,
  NoteMarkdownEditorProps,
} from './noteMarkdownEditorTypes';
import {useNoteMarkdownEditorCompartmentEffects} from './useNoteMarkdownEditorCompartmentEffects';
import {useNoteMarkdownEditorImageDrop} from './useNoteMarkdownEditorImageDrop';
import {useNoteMarkdownEditorLoad} from './useNoteMarkdownEditorLoad';
import {useNoteMarkdownEditorShellRefs} from './useNoteMarkdownEditorShellRefs';

export type {
  NoteMarkdownEditorHandle,
  NoteMarkdownEditorProps,
} from './noteMarkdownEditorTypes';

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
    shell,
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
      onSaveShortcutRef: shell.onSaveShortcutRef,
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

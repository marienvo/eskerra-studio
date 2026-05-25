import {EditorSelection} from '@codemirror/state';
import type {EditorView} from '@codemirror/view';
import type {MutableRefObject} from 'react';

import {MIDDLE_CLICK_BLOCK_PASTE_WINDOW_MS} from '../../hooks/middleClickPasteBlock';
import {clipboardDataProbablyHasVaultImage} from '../../lib/clipboard/clipboardImageFiles';
import {formatVaultImageMarkdownForInsert} from '../../lib/clipboard/formatVaultImageMarkdown';
import {tryClipboardHtmlToMarkdownInsert} from '../../lib/clipboard/htmlClipboardToMarkdown';
import {cleanPastedMarkdownFragment} from '../../lib/markdown/cleanNote';
import type {NoteInboxAttachmentHost} from '../../lib/noteInboxAttachmentHost';
import {MARKDOWN_INPUT_PASTE_USER_EVENT} from './markdownEditorUserEvents';
import {markdownCaretInOpaquePasteBlock} from './markdownSmartExpandSelection';

export type NoteMarkdownPasteContext = {
  vaultRootRef: MutableRefObject<string>;
  attachmentHostRef: MutableRefObject<NoteInboxAttachmentHost>;
  activeNotePathRef: MutableRefObject<string | null>;
  busyRef: MutableRefObject<boolean>;
  reportError: (message: string) => void;
  /** Return true when async paste must not apply (view remounted or cell session stale). */
  isStaleView: (viewForPaste: EditorView) => boolean;
  /** Final insert text after HTML→MD and remark clean (and cell sanitize when applicable). */
  normalizePastedMarkdown: (markdown: string) => string;
  /**
   * Plain text from `readNativeClipboardPaste` when the web clipboard is empty
   * (Linux/WebKitGTK). Not remark-cleaned; main editor uses raw text, cells may
   * apply `sanitizeCellInsert` only.
   */
  normalizeNativeClipboardText?: (text: string) => string;
  /** Post-process vault image markdown lines (cell: collapse whitespace). */
  normalizeImageMarkdownInsert?: (insert: string) => string;
  /**
   * When HTML converts to empty insert: main editor prevents default and consumes the event;
   * table cells return false so plain paste can run.
   */
  consumeEmptyHtmlPaste?: boolean;
};

const MAIN_IMAGE_IMPORT_UNAVAILABLE_MSG =
  'Pasting images into the vault requires the Eskerra desktop app. Use `tauri dev` or the packaged app instead of a plain browser tab.';

const CELL_IMAGE_IMPORT_UNAVAILABLE_MSG =
  'Pasting images into the vault requires the Eskerra desktop app.';

function selectionInsertRange(view: EditorView): {from: number; to: number} {
  const sel = view.state.selection.main;
  return {
    from: Math.min(sel.anchor, sel.head),
    to: Math.max(sel.anchor, sel.head),
  };
}

function dispatchPasteInsert(
  view: EditorView,
  from: number,
  to: number,
  insert: string,
): void {
  view.dispatch({
    changes: {from, to, insert},
    selection: EditorSelection.cursor(from + insert.length),
    scrollIntoView: true,
    userEvent: MARKDOWN_INPUT_PASTE_USER_EVENT,
  });
}

export function pasteBlockWhileBusy(
  event: ClipboardEvent,
  busyRef: MutableRefObject<boolean>,
  reportError: (message: string) => void,
): boolean {
  if (!busyRef.current) {
    return false;
  }
  if (
    event.clipboardData &&
    clipboardDataProbablyHasVaultImage(event.clipboardData)
  ) {
    event.preventDefault();
    reportError(
      'Please wait until the current operation finishes before pasting an image.',
    );
    return true;
  }
  return false;
}

export function pasteBlockImageWhenImportUnavailable(
  event: ClipboardEvent,
  attachmentHostRef: MutableRefObject<NoteInboxAttachmentHost>,
  reportError: (message: string) => void,
  message: string = CELL_IMAGE_IMPORT_UNAVAILABLE_MSG,
): boolean {
  const host = attachmentHostRef.current;
  if (host.isVaultImageImportAvailable) {
    return false;
  }
  if (
    event.clipboardData &&
    clipboardDataProbablyHasVaultImage(event.clipboardData)
  ) {
    event.preventDefault();
    reportError(message);
    return true;
  }
  return false;
}

export function createNoteMarkdownPasteHandlers(ctx: NoteMarkdownPasteContext) {
  const {
    vaultRootRef,
    attachmentHostRef,
    busyRef,
    reportError,
    isStaleView,
    normalizePastedMarkdown,
  } = ctx;
  const normalizeNativeClipboardText =
    ctx.normalizeNativeClipboardText ?? ((text: string) => text);
  const normalizeImageInsert =
    ctx.normalizeImageMarkdownInsert ?? ((insert: string) => insert);

  let middleClickBlockPasteUntil = 0;

  const runVaultImagePasteFromDataTransfer = (
    dt: DataTransfer,
    viewForPaste: EditorView,
  ): boolean => {
    if (!clipboardDataProbablyHasVaultImage(dt)) {
      return false;
    }

    const {from: insertFrom, to: insertTo} = selectionInsertRange(viewForPaste);

    void (async () => {
      const vr = vaultRootRef.current;
      const host = attachmentHostRef.current;

      try {
        const relPaths = await host.importPastedImages(dt, vr);

        if (relPaths.length === 0) {
          reportError(
            'Could not import the pasted content as a vault image.',
          );
          return;
        }

        const insert = normalizeImageInsert(
          formatVaultImageMarkdownForInsert(relPaths),
        );
        if (isStaleView(viewForPaste)) {
          return;
        }
        dispatchPasteInsert(viewForPaste, insertFrom, insertTo, insert);
      } catch (err) {
        reportError(err instanceof Error ? err.message : String(err));
      }
    })();

    return true;
  };

  const runNativeClipboardPasteWhenWebDataEmpty = (
    viewForPaste: EditorView,
  ): boolean => {
    const {from: insertFrom, to: insertTo} = selectionInsertRange(viewForPaste);

    void (async () => {
      const vr = vaultRootRef.current;
      const host = attachmentHostRef.current;
      const result = await host.readNativeClipboardPaste(vr);

      if (result.kind === 'text') {
        const text = normalizeNativeClipboardText(result.text);
        if (!isStaleView(viewForPaste) && text.length > 0) {
          dispatchPasteInsert(viewForPaste, insertFrom, insertTo, text);
        }
        return;
      }

      if (result.kind === 'fail') {
        reportError(result.message);
        return;
      }

      try {
        const insert = normalizeImageInsert(
          formatVaultImageMarkdownForInsert(result.paths),
        );
        if (isStaleView(viewForPaste)) {
          return;
        }
        dispatchPasteInsert(viewForPaste, insertFrom, insertTo, insert);
      } catch (pipeErr) {
        reportError(
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
    if (
      markdownCaretInOpaquePasteBlock(
        viewForPaste.state,
        viewForPaste.state.selection.main.head,
      )
    ) {
      return false;
    }
    const md = tryClipboardHtmlToMarkdownInsert(htmlRaw, plain);
    if (md == null) {
      return false;
    }
    const insert = normalizePastedMarkdown(md);
    if (insert.length === 0) {
      if (ctx.consumeEmptyHtmlPaste !== false) {
        e.preventDefault();
        e.stopPropagation();
        return true;
      }
      return false;
    }
    e.preventDefault();
    e.stopPropagation();
    const {from: insertFrom, to: insertTo} = selectionInsertRange(viewForPaste);
    dispatchPasteInsert(viewForPaste, insertFrom, insertTo, insert);
    return true;
  };

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
    if (pasteBlockWhileBusy(e, busyRef, reportError)) {
      return true;
    }

    const host = attachmentHostRef.current;
    if (!host.isVaultImageImportAvailable) {
      if (
        pasteBlockImageWhenImportUnavailable(
          e,
          attachmentHostRef,
          reportError,
          MAIN_IMAGE_IMPORT_UNAVAILABLE_MSG,
        )
      ) {
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

  const armMiddleClickPasteBlock = (): void => {
    middleClickBlockPasteUntil =
      Date.now() + MIDDLE_CLICK_BLOCK_PASTE_WINDOW_MS;
  };

  const isMiddleClickPasteBlocked = (): boolean =>
    Date.now() < middleClickBlockPasteUntil;

  /** Cell editor: paste from `DataTransfer`; returns `null` to fall through to plain pipe paste. */
  const runPasteFromDataTransfer = (
    dt: DataTransfer,
    event: ClipboardEvent,
    view: EditorView,
  ): boolean | null => {
    const probablyImage = clipboardDataProbablyHasVaultImage(dt);
    if (probablyImage) {
      event.preventDefault();
      event.stopPropagation();
      return runVaultImagePasteFromDataTransfer(dt, view);
    }
    const plainTrimmed = (dt.getData('text/plain') ?? '').trim();
    if (plainTrimmed === '' && !probablyImage) {
      const htmlWhenPlainEmpty = dt.getData('text/html') ?? '';
      if (
        htmlWhenPlainEmpty.trim() !== ''
        && tryPasteRichHtmlFromDataTransfer(dt, event, view)
      ) {
        return true;
      }
      event.preventDefault();
      event.stopPropagation();
      return runNativeClipboardPasteWhenWebDataEmpty(view);
    }
    const htmlRaw = dt.getData('text/html') ?? '';
    const plainForHtml = dt.getData('text/plain') ?? '';
    if (tryPasteRichHtmlFromDataTransfer(dt, event, view)) {
      return true;
    }
    if (plainForHtml.trim() !== '') {
      return null;
    }
    if (htmlRaw.trim() !== '') {
      return false;
    }
    return null;
  };

  return {
    onEditorPaste,
    armMiddleClickPasteBlock,
    isMiddleClickPasteBlocked,
    runPasteFromDataTransfer,
    tryPasteRichHtmlFromDataTransfer,
  };
}

/** Default main-editor markdown normalize (remark clean only). */
export function normalizeMainEditorPastedMarkdown(
  md: string,
  activeNotePath: string | null,
): string {
  return cleanPastedMarkdownFragment(md, activeNotePath);
}

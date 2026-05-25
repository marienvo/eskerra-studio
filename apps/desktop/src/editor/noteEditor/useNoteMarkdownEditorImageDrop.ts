import {useCallback, useEffect, useState} from 'react';

import {
  isNoteAttachmentImageFilePath,
  type NoteInboxAttachmentHost,
} from '../../lib/noteInboxAttachmentHost';
import {formatVaultImageMarkdownForInsert} from '../../lib/clipboard/formatVaultImageMarkdown';
import type {NoteMarkdownEditorShellRefs} from './useNoteMarkdownEditorShellRefs';

export function useNoteMarkdownEditorImageDrop(
  shell: Pick<
    NoteMarkdownEditorShellRefs,
    'hostRef' | 'viewRef' | 'reportEditorError'
  >,
  attachmentHost: NoteInboxAttachmentHost,
  vaultRoot: string,
  busy: boolean,
): {dropActive: boolean; hostClassName: string} {
  const [dropActive, setDropActive] = useState(false);

  const insertRelativePaths = useCallback((paths: readonly string[]) => {
    const view = shell.viewRef.current;
    if (!view || paths.length === 0) {
      return;
    }
    const insert = formatVaultImageMarkdownForInsert(paths);
    view.dispatch(view.state.update(view.state.replaceSelection(insert)));
  }, [shell.viewRef]);

  useEffect(() => {
    const el = shell.hostRef.current;
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
          shell.reportEditorError(
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
  }, [
    attachmentHost,
    busy,
    insertRelativePaths,
    shell,
    vaultRoot,
  ]);

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
              shell.reportEditorError(
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
  }, [attachmentHost, busy, insertRelativePaths, shell]);

  const hostClassName = dropActive
    ? 'note-markdown-editor-host note-markdown-editor-host--drop-target'
    : 'note-markdown-editor-host';

  return {dropActive, hostClassName};
}

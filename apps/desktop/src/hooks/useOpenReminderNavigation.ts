import {listen} from '@tauri-apps/api/event';
import {invoke, isTauri} from '@tauri-apps/api/core';
import {type RefObject, useEffect} from 'react';

import type {NoteMarkdownEditorHandle} from '../editor/noteEditor/NoteMarkdownEditor';
import type {OpenMarkdownInEditorOptions} from './workspaceOpenMarkdownCommand';

type OpenReminderRequest = {
  noteUri: string;
  reminderId: string;
  uiCaretHint?: number;
};

type ResolvedReminderPosition = {
  caretUtf16: number;
};

export async function navigateToReminder(
  req: OpenReminderRequest,
  openMarkdownInEditor: (uri: string, options?: OpenMarkdownInEditorOptions) => Promise<void>,
  inboxEditorRef: RefObject<NoteMarkdownEditorHandle | null>,
): Promise<void> {
  await openMarkdownInEditor(req.noteUri);

  const resolved = await invoke<ResolvedReminderPosition | null>('reminders_resolve_position', {
    noteUri: req.noteUri,
    reminderId: req.reminderId,
  }).catch(() => null);

  const caretPos = resolved?.caretUtf16 ?? req.uiCaretHint;
  if (caretPos == null) {
    return;
  }

  // Double-rAF: wait for CodeMirror to finish loading the document before
  // placing the caret. Same pattern as scheduleFocusAfterForegroundOpen.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      inboxEditorRef.current?.focus({anchor: caretPos, scrollIntoView: true});
    });
  });
}

/**
 * Handles click-to-open navigation from daemon reminder notifications (Phase 5).
 *
 * Two paths:
 * - Cold start: on mount, calls `reminders_take_pending_open` to drain any
 *   `--open-reminder` arg passed to the first app instance.
 * - Already running: listens for the `open-reminder` Tauri event forwarded by
 *   the single-instance plugin when a second `eskerra --open-reminder` is spawned.
 *
 * In both cases: opens the note, resolves the live token position via
 * `reminders_resolve_position`, then places the CodeMirror caret.
 */
export function useOpenReminderNavigation({
  openMarkdownInEditor,
  inboxEditorRef,
  initialVaultHydrateAttemptDone,
}: {
  openMarkdownInEditor: (uri: string, options?: OpenMarkdownInEditorOptions) => Promise<void>;
  inboxEditorRef: RefObject<NoteMarkdownEditorHandle | null>;
  initialVaultHydrateAttemptDone: boolean;
}): void {
  // Cold-start path: drain a pending open that was set from startup argv.
  // Only attempt once vault hydration is done (first-render-sacred invariant).
  useEffect(() => {
    if (!isTauri() || !initialVaultHydrateAttemptDone) {
      return;
    }
    invoke<OpenReminderRequest | null>('reminders_take_pending_open')
      .then(req => {
        if (req != null) {
          void navigateToReminder(req, openMarkdownInEditor, inboxEditorRef);
        }
      })
      .catch(() => undefined);
  }, [initialVaultHydrateAttemptDone, openMarkdownInEditor, inboxEditorRef]);

  // Already-running path: listen for forwarded argv from single-instance plugin.
  useEffect(() => {
    if (!isTauri()) {
      return;
    }
    let unlisten: (() => void) | null = null;
    listen<OpenReminderRequest>('open-reminder', event => {
      void navigateToReminder(event.payload, openMarkdownInEditor, inboxEditorRef);
    })
      .then(fn => {
        unlisten = fn;
      })
      .catch(() => undefined);
    return () => {
      unlisten?.();
    };
  }, [openMarkdownInEditor, inboxEditorRef]);
}

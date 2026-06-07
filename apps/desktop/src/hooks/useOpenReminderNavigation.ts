import {listen} from '@tauri-apps/api/event';
import {invoke, isTauri} from '@tauri-apps/api/core';
import {type RefObject, useCallback, useEffect, useRef} from 'react';

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

export function reminderFileUriToAbsolutePath(noteUri: string): string | null {
  let url: URL;
  try {
    url = new URL(noteUri);
  } catch {
    return null;
  }

  if (url.protocol !== 'file:' || (url.host !== '' && url.host !== 'localhost')) {
    return null;
  }
  if (url.search !== '' || url.hash !== '') {
    return null;
  }

  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }

  return decodedPath.startsWith('/') ? decodedPath : null;
}

function openReminderRequestKey(req: OpenReminderRequest): string {
  return `${req.noteUri}\u0000${req.reminderId}\u0000${req.uiCaretHint ?? ''}`;
}

export async function navigateToReminder(
  req: OpenReminderRequest,
  openMarkdownInEditor: (uri: string, options?: OpenMarkdownInEditorOptions) => Promise<void>,
  inboxEditorRef: RefObject<NoteMarkdownEditorHandle | null>,
): Promise<void> {
  const notePath = reminderFileUriToAbsolutePath(req.noteUri);
  if (notePath == null) {
    return;
  }

  await openMarkdownInEditor(notePath);

  let editorMarkdown: string | null = null;
  try {
    editorMarkdown = inboxEditorRef.current?.getMarkdown() ?? null;
  } catch {
    editorMarkdown = null;
  }

  const resolved =
    editorMarkdown != null
      ? await invoke<ResolvedReminderPosition | null>('reminders_resolve_position_in_markdown', {
          noteUri: req.noteUri,
          reminderId: req.reminderId,
          markdown: editorMarkdown,
        }).catch(() => null)
      : await invoke<ResolvedReminderPosition | null>('reminders_resolve_position', {
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
 * In both cases: opens the note, resolves the live token position against the
 * editor-visible markdown when possible, then places the CodeMirror caret.
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
  const pendingRequestsRef = useRef<OpenReminderRequest[]>([]);
  const pendingRequestKeysRef = useRef<Set<string>>(new Set());
  const activeRequestKeyRef = useRef<string | null>(null);
  const drainPendingRef = useRef<() => void>(() => {});

  const drainPending = useCallback(() => {
    if (!initialVaultHydrateAttemptDone || activeRequestKeyRef.current != null) {
      return;
    }

    const req = pendingRequestsRef.current.shift();
    if (req == null) {
      return;
    }

    const key = openReminderRequestKey(req);
    pendingRequestKeysRef.current.delete(key);
    activeRequestKeyRef.current = key;

    navigateToReminder(req, openMarkdownInEditor, inboxEditorRef)
      .catch(() => undefined)
      .finally(() => {
        activeRequestKeyRef.current = null;
        drainPendingRef.current();
      });
  }, [initialVaultHydrateAttemptDone, openMarkdownInEditor, inboxEditorRef]);

  const enqueueOpenReminder = useCallback((req: OpenReminderRequest) => {
    const key = openReminderRequestKey(req);
    if (activeRequestKeyRef.current === key || pendingRequestKeysRef.current.has(key)) {
      return;
    }

    pendingRequestsRef.current.push(req);
    pendingRequestKeysRef.current.add(key);
    drainPendingRef.current();
  }, []);

  const drainNativePendingOpenReminders = useCallback(
    async (isCancelled: () => boolean) => {
      if (!isTauri() || !initialVaultHydrateAttemptDone) {
        return;
      }
      while (!isCancelled()) {
        const req = await invoke<OpenReminderRequest | null>('reminders_take_pending_open').catch(
          () => null,
        );
        if (isCancelled() || req == null) {
          return;
        }
        enqueueOpenReminder(req);
      }
    },
    [initialVaultHydrateAttemptDone, enqueueOpenReminder],
  );

  useEffect(() => {
    drainPendingRef.current = drainPending;
    drainPending();
  }, [drainPending]);

  // Cold-start path: drain a pending open that was set from startup argv after
  // vault hydration is done (first-render-sacred invariant).
  useEffect(() => {
    let cancelled = false;
    void drainNativePendingOpenReminders(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [drainNativePendingOpenReminders]);

  // Already-running path: listen for forwarded argv from single-instance plugin.
  useEffect(() => {
    if (!isTauri()) {
      return;
    }
    let unlisten: (() => void) | null = null;
    let cleanupRequested = false;
    listen<OpenReminderRequest>('open-reminder', event => {
      enqueueOpenReminder(event.payload);
      void drainNativePendingOpenReminders(() => cleanupRequested);
    })
      .then(fn => {
        if (cleanupRequested) {
          fn();
        } else {
          unlisten = fn;
          void drainNativePendingOpenReminders(() => cleanupRequested);
        }
      })
      .catch(() => undefined);
    return () => {
      cleanupRequested = true;
      unlisten?.();
      unlisten = null;
    };
  }, [enqueueOpenReminder, drainNativePendingOpenReminders]);
}

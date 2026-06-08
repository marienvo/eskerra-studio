import {listen} from '@tauri-apps/api/event';
import {invoke, isTauri} from '@tauri-apps/api/core';
import {type RefObject, useCallback, useEffect, useRef} from 'react';

import type {NoteMarkdownEditorHandle} from '../editor/noteEditor/NoteMarkdownEditor';
import {normalizeEditorDocUri} from '../lib/editorDocumentHistory';
import type {TodayHubWorkspaceBridge} from '../lib/todayHub';
import {
  findTodayHubRowMatch,
  reminderFileUriToAbsolutePath,
} from '../lib/todayHub/reminderHubCellTarget';
import type {OpenMarkdownInEditorOptions} from './workspaceOpenMarkdownCommand';

export {reminderFileUriToAbsolutePath};

type OpenReminderRequest = {
  noteUri: string;
  reminderId: string;
  uiCaretHint?: number;
};

type ResolvedReminderPosition = {
  caretUtf16: number;
};

/**
 * Lets {@link navigateToReminder} route a reminder that lives in a Today Hub cell to the hub canvas
 * instead of opening its backing week-note as a plain note.
 */
export type TodayHubReminderBridge = {
  /** Current hub `Today.md` URIs (used to recognise a reminder's week-note as a hub row). */
  hubTodayNoteUris: () => readonly string[];
  /** Make the hub holding the row the active workspace so its canvas mounts. */
  switchTodayHubWorkspace: (hubTodayNoteUri: string) => Promise<void>;
  /** Live canvas bridge; `openReminderCell` becomes non-null once a hub canvas is mounted. */
  bridgeRef: RefObject<TodayHubWorkspaceBridge>;
};

/** Poll the canvas bridge for the target hub's `openReminderCell` after a hub switch. */
async function waitForCanvasReminderOpen(
  bridgeRef: RefObject<TodayHubWorkspaceBridge>,
  expectedHubTodayNoteUri: string,
  maxFrames = 120,
): Promise<TodayHubWorkspaceBridge['openReminderCell']> {
  const expectedHub = normalizeEditorDocUri(expectedHubTodayNoteUri);
  for (let i = 0; i < maxFrames; i++) {
    const bridge = bridgeRef.current;
    const fn = bridge?.openReminderCell ?? null;
    const mountedHub = bridge?.getTodayNoteUri?.() ?? null;
    if (
      fn != null &&
      mountedHub != null &&
      normalizeEditorDocUri(mountedHub) === expectedHub
    ) {
      return fn;
    }
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  }
  return null;
}

/**
 * Routes a hub-cell reminder to the canvas. Returns `true` when the canvas opened the cell, or
 * `false` when the row's week is outside the hub window / the canvas never mounted (caller then
 * falls back to opening the plain note).
 */
async function tryOpenReminderInHubCell(
  match: {hubTodayNoteUri: string; rowUri: string},
  caretUtf16: number,
  hubBridge: TodayHubReminderBridge,
): Promise<boolean> {
  await hubBridge.switchTodayHubWorkspace(match.hubTodayNoteUri);
  const openCell = await waitForCanvasReminderOpen(
    hubBridge.bridgeRef,
    match.hubTodayNoteUri,
  );
  if (openCell == null) {
    return false;
  }
  const result = await openCell(match.rowUri, caretUtf16).catch(() => null);
  return result === 'handled';
}

function openReminderRequestKey(req: OpenReminderRequest): string {
  return `${req.noteUri}\u0000${req.reminderId}\u0000${req.uiCaretHint ?? ''}`;
}

export async function navigateToReminder(
  req: OpenReminderRequest,
  openMarkdownInEditor: (uri: string, options?: OpenMarkdownInEditorOptions) => Promise<void>,
  inboxEditorRef: RefObject<NoteMarkdownEditorHandle | null>,
  hubBridge?: TodayHubReminderBridge,
): Promise<void> {
  const notePath = reminderFileUriToAbsolutePath(req.noteUri);
  if (notePath == null) {
    return;
  }

  // Today Hub cells live in `YYYY-MM-DD.md` week-notes beside the hub's `Today.md`. Route those to
  // the hub canvas (open cell + caret at the token's line) rather than opening the bare week-note.
  const hubMatch = hubBridge
    ? findTodayHubRowMatch(notePath, hubBridge.hubTodayNoteUris())
    : null;
  if (hubMatch != null) {
    const resolved = await invoke<ResolvedReminderPosition | null>('reminders_resolve_position', {
      noteUri: req.noteUri,
      reminderId: req.reminderId,
    }).catch(() => null);
    const caret = resolved?.caretUtf16 ?? req.uiCaretHint ?? 0;
    const handled = await tryOpenReminderInHubCell(hubMatch, caret, hubBridge!).catch(() => false);
    if (handled) {
      return;
    }
    // Out of window / canvas unavailable: fall through to opening the plain week-note.
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
  hubBridge,
}: {
  openMarkdownInEditor: (uri: string, options?: OpenMarkdownInEditorOptions) => Promise<void>;
  inboxEditorRef: RefObject<NoteMarkdownEditorHandle | null>;
  initialVaultHydrateAttemptDone: boolean;
  hubBridge?: TodayHubReminderBridge;
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

    navigateToReminder(req, openMarkdownInEditor, inboxEditorRef, hubBridge)
      .catch(() => undefined)
      .finally(() => {
        activeRequestKeyRef.current = null;
        drainPendingRef.current();
      });
  }, [initialVaultHydrateAttemptDone, openMarkdownInEditor, inboxEditorRef, hubBridge]);

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

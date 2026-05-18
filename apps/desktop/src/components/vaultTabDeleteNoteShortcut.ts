/**
 * Global (window bubble-phase) handler for Mod+Shift+D — delete active note.
 * CodeMirror still owns the in-editor path; this only runs when CM did not preventDefault.
 */

export function matchesDeleteNoteGlobalShortcutModifiers(
  e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>,
): boolean {
  const mod = e.ctrlKey || e.metaKey;
  if (!mod || !e.shiftKey || e.altKey) {
    return false;
  }
  return e.key === 'd' || e.key === 'D';
}

/** True when focus is in a native or contenteditable field outside a CodeMirror editor. */
export function isEditableFocusOutsideCodeMirror(focus: EventTarget | null): boolean {
  if (!(focus instanceof HTMLElement)) {
    return false;
  }
  const tag = focus.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') {
    return true;
  }
  if (focus.isContentEditable && focus.closest('.cm-editor') == null) {
    return true;
  }
  return false;
}

/**
 * Whether the bubble-phase window listener should handle Mod+Shift+D for delete-note.
 */
export function shouldHandleDeleteNoteGlobalShortcut(
  e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey' | 'defaultPrevented'>,
  focusContext: {
    activeElement: Element | null;
    eventTarget: EventTarget | null;
  },
): boolean {
  if (e.defaultPrevented) {
    return false;
  }
  if (!matchesDeleteNoteGlobalShortcutModifiers(e)) {
    return false;
  }
  if (isEditableFocusOutsideCodeMirror(focusContext.activeElement)) {
    return false;
  }
  if (isEditableFocusOutsideCodeMirror(focusContext.eventTarget)) {
    return false;
  }
  return true;
}

export function canOpenDeleteNoteShortcut(args: {
  busy: boolean;
  selectedUri: string | null;
  composingNewEntry: boolean;
}): boolean {
  return !args.busy && args.selectedUri != null && !args.composingNewEntry;
}

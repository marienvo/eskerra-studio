import {describe, expect, it} from 'vitest';

import {
  canOpenDeleteNoteShortcut,
  isEditableFocusOutsideCodeMirror,
  matchesDeleteNoteGlobalShortcutModifiers,
  shouldHandleDeleteNoteGlobalShortcut,
} from './vaultTabDeleteNoteShortcut';

function modKeyEvent(
  init: Partial<KeyboardEvent> & Pick<KeyboardEvent, 'key'>,
): Pick<
  KeyboardEvent,
  'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey' | 'defaultPrevented'
> {
  return {
    key: init.key,
    ctrlKey: init.ctrlKey ?? false,
    metaKey: init.metaKey ?? false,
    shiftKey: init.shiftKey ?? false,
    altKey: init.altKey ?? false,
    defaultPrevented: init.defaultPrevented ?? false,
  };
}

describe('matchesDeleteNoteGlobalShortcutModifiers', () => {
  it('matches Ctrl+Shift+D and Ctrl+Shift+d', () => {
    expect(
      matchesDeleteNoteGlobalShortcutModifiers(
        modKeyEvent({key: 'D', ctrlKey: true, shiftKey: true}),
      ),
    ).toBe(true);
    expect(
      matchesDeleteNoteGlobalShortcutModifiers(
        modKeyEvent({key: 'd', ctrlKey: true, shiftKey: true}),
      ),
    ).toBe(true);
  });

  it('matches Meta+Shift+D (mac)', () => {
    expect(
      matchesDeleteNoteGlobalShortcutModifiers(
        modKeyEvent({key: 'd', metaKey: true, shiftKey: true}),
      ),
    ).toBe(true);
  });

  it('rejects without Shift', () => {
    expect(
      matchesDeleteNoteGlobalShortcutModifiers(
        modKeyEvent({key: 'd', ctrlKey: true, shiftKey: false}),
      ),
    ).toBe(false);
  });

  it('rejects with Alt', () => {
    expect(
      matchesDeleteNoteGlobalShortcutModifiers(
        modKeyEvent({key: 'd', ctrlKey: true, shiftKey: true, altKey: true}),
      ),
    ).toBe(false);
  });

  it('rejects wrong key', () => {
    expect(
      matchesDeleteNoteGlobalShortcutModifiers(
        modKeyEvent({key: 'e', ctrlKey: true, shiftKey: true}),
      ),
    ).toBe(false);
  });

  it('rejects without mod', () => {
    expect(
      matchesDeleteNoteGlobalShortcutModifiers(
        modKeyEvent({key: 'd', shiftKey: true}),
      ),
    ).toBe(false);
  });
});

describe('isEditableFocusOutsideCodeMirror', () => {
  it('is true for input and textarea', () => {
    const input = document.createElement('input');
    const ta = document.createElement('textarea');
    expect(isEditableFocusOutsideCodeMirror(input)).toBe(true);
    expect(isEditableFocusOutsideCodeMirror(ta)).toBe(true);
  });

  it('is false for body', () => {
    expect(isEditableFocusOutsideCodeMirror(document.body)).toBe(false);
  });

  it('is true for contenteditable outside .cm-editor', () => {
    const host = document.createElement('div');
    host.setAttribute('contenteditable', 'true');
    expect(isEditableFocusOutsideCodeMirror(host)).toBe(true);
  });

  it('is false for contenteditable inside .cm-editor', () => {
    const cm = document.createElement('div');
    cm.className = 'cm-editor';
    const inner = document.createElement('div');
    inner.setAttribute('contenteditable', 'true');
    cm.append(inner);
    expect(isEditableFocusOutsideCodeMirror(inner)).toBe(false);
  });
});

describe('shouldHandleDeleteNoteGlobalShortcut', () => {
  it('is true for Ctrl+Shift+D with body focus', () => {
    expect(
      shouldHandleDeleteNoteGlobalShortcut(
        modKeyEvent({key: 'd', ctrlKey: true, shiftKey: true}),
        {activeElement: document.body, eventTarget: document.body},
      ),
    ).toBe(true);
  });

  it('is false when defaultPrevented (CM path)', () => {
    expect(
      shouldHandleDeleteNoteGlobalShortcut(
        modKeyEvent({
          key: 'd',
          ctrlKey: true,
          shiftKey: true,
          defaultPrevented: true,
        }),
        {activeElement: document.body, eventTarget: document.body},
      ),
    ).toBe(false);
  });

  it('is false when activeElement is input', () => {
    const input = document.createElement('input');
    expect(
      shouldHandleDeleteNoteGlobalShortcut(
        modKeyEvent({key: 'd', ctrlKey: true, shiftKey: true}),
        {activeElement: input, eventTarget: input},
      ),
    ).toBe(false);
  });

  it('is false when eventTarget is textarea', () => {
    const ta = document.createElement('textarea');
    expect(
      shouldHandleDeleteNoteGlobalShortcut(
        modKeyEvent({key: 'd', ctrlKey: true, shiftKey: true}),
        {activeElement: document.body, eventTarget: ta},
      ),
    ).toBe(false);
  });

  it('is false for non-matching shortcut', () => {
    expect(
      shouldHandleDeleteNoteGlobalShortcut(
        modKeyEvent({key: 'd', ctrlKey: true, shiftKey: false}),
        {activeElement: document.body, eventTarget: document.body},
      ),
    ).toBe(false);
  });
});

describe('canOpenDeleteNoteShortcut', () => {
  it('requires an idle selected note outside compose', () => {
    expect(
      canOpenDeleteNoteShortcut({
        busy: false,
        selectedUri: '/vault/Inbox/Note.md',
        composingNewEntry: false,
      }),
    ).toBe(true);
    expect(
      canOpenDeleteNoteShortcut({
        busy: false,
        selectedUri: '/vault/Inbox/Note.md',
        composingNewEntry: true,
      }),
    ).toBe(false);
    expect(
      canOpenDeleteNoteShortcut({
        busy: false,
        selectedUri: null,
        composingNewEntry: false,
      }),
    ).toBe(false);
  });
});

import {act, fireEvent, render, screen} from '@testing-library/react';
import type {Transaction} from '@codemirror/state';
import {createRef} from 'react';
import {describe, expect, it, vi} from 'vitest';

import {EditorView, runScopeHandlers} from '@codemirror/view';

import type {NoteInboxAttachmentHost} from '../../lib/noteInboxAttachmentHost';
import {
  NoteMarkdownEditor,
  type NoteMarkdownEditorHandle,
  type NoteMarkdownEditorProps,
} from './NoteMarkdownEditor';
import {formatDateToken, todayDateParts} from './dateToken/dateToken';

function attachmentHost(): NoteInboxAttachmentHost {
  const none = async () => [];
  return {
    isVaultImageImportAvailable: false,
    importPastedImages: none,
    readNativeClipboardPaste: async () => ({
      kind: 'fail',
      message: 'No native clipboard in test.',
    }),
    importDroppedFiles: none,
    importDroppedAbsolutePaths: none,
    subscribeWindowFileDragDrop: async () => () => {},
  };
}

function baseProps(
  overrides: Partial<NoteMarkdownEditorProps> = {},
): NoteMarkdownEditorProps {
  return {
    vaultRoot: '/vault',
    activeNotePath: '/vault/Inbox/a.md',
    initialMarkdown: 'Initial',
    sessionKey: 1,
    onMarkdownChange: vi.fn(),
    onEditorError: vi.fn(),
    onWikiLinkActivate: vi.fn(),
    relativeMarkdownLinkHrefIsResolved: vi.fn(() => false),
    onMarkdownRelativeLinkActivate: vi.fn(),
    onMarkdownExternalLinkOpen: vi.fn(),
    wikiLinkTargetIsResolved: vi.fn(() => false),
    wikiLinkCompletionCandidates: [],
    onSaveShortcut: vi.fn(),
    onCleanNote: vi.fn(),
    onDeleteNoteShortcut: vi.fn(),
    placeholder: 'Write',
    busy: false,
    showFoldGutter: true,
    attachmentHost: attachmentHost(),
    resolveVaultImagePreviewUrl: vi.fn(async () => null),
    linkSnippetBlockedDomains: [],
    onMuteLinkSnippetDomain: vi.fn(),
    ...overrides,
  };
}

function editorView(container: HTMLElement): EditorView {
  const content = container.querySelector('.cm-content');
  if (!(content instanceof HTMLElement)) {
    throw new Error('Missing CodeMirror content element');
  }
  const view = EditorView.findFromDOM(content);
  if (!view) {
    throw new Error('Missing CodeMirror view');
  }
  return view;
}

function dispatchEditorInput(
  view: EditorView,
  from: number,
  text: string,
): boolean {
  const insert = (): Transaction =>
    view.state.update({
      changes: {from, to: from, insert: text},
      selection: {anchor: from + text.length},
    });
  const handled = view.state
    .facet(EditorView.inputHandler)
    .some(handler => handler(view, from, from, text, insert));
  if (!handled) {
    view.dispatch(insert());
  }
  return handled;
}

describe('NoteMarkdownEditor', () => {
  it('emits markdown changes from the mounted CodeMirror view', () => {
    const onMarkdownChange = vi.fn();
    const {container} = render(
      <NoteMarkdownEditor
        {...baseProps({initialMarkdown: 'Alpha', onMarkdownChange})}
      />,
    );
    const view = editorView(container);

    act(() => {
      view.dispatch({changes: {from: 5, insert: ' beta'}});
    });

    expect(onMarkdownChange).toHaveBeenLastCalledWith('Alpha beta');
  });

  it('exposes current markdown and synchronous loadMarkdown through the handle', () => {
    const ref = createRef<NoteMarkdownEditorHandle>();
    render(
      <NoteMarkdownEditor
        {...baseProps({initialMarkdown: 'Before'})}
        ref={ref}
      />,
    );

    act(() => {
      ref.current?.loadMarkdown('After', {selection: 'end'});
    });

    expect(ref.current?.getMarkdown()).toBe('After');
  });

  it('remounts from initialMarkdown when sessionKey changes', () => {
    const ref = createRef<NoteMarkdownEditorHandle>();
    const {rerender} = render(
      <NoteMarkdownEditor
        {...baseProps({initialMarkdown: 'First', sessionKey: 1})}
        ref={ref}
      />,
    );

    expect(ref.current?.getMarkdown()).toBe('First');

    rerender(
      <NoteMarkdownEditor
        {...baseProps({initialMarkdown: 'Second', sessionKey: 2})}
        ref={ref}
      />,
    );

    expect(ref.current?.getMarkdown()).toBe('Second');
  });

  it('routes Mod-s to the shell save shortcut handler', () => {
    const onSaveShortcut = vi.fn();
    const {container} = render(
      <NoteMarkdownEditor {...baseProps({onSaveShortcut})} />,
    );
    const view = editorView(container);

    act(() => {
      runScopeHandlers(
        view,
        new KeyboardEvent('keydown', {
          key: 's',
          code: 'KeyS',
          ctrlKey: true,
          bubbles: true,
        }),
        'editor',
      );
    });

    expect(onSaveShortcut).toHaveBeenCalledTimes(1);
  });

  it('opens the date token picker from @ input and commits the selected date', () => {
    const onMarkdownChange = vi.fn();
    const {container} = render(
      <NoteMarkdownEditor
        {...baseProps({initialMarkdown: '', onMarkdownChange})}
      />,
    );
    const view = editorView(container);
    const rect = {
      bottom: 16,
      height: 12,
      left: 10,
      right: 18,
      top: 4,
      width: 8,
      x: 10,
      y: 4,
      toJSON: () => ({}),
    } as DOMRect;
    vi.spyOn(view, 'coordsAtPos').mockReturnValue(rect);

    act(() => {
      expect(dispatchEditorInput(view, 0, '@')).toBe(true);
    });

    expect(screen.getByRole('dialog', {name: 'Pick date and time'})).toBeTruthy();

    act(() => {
      fireEvent.click(screen.getByRole('button', {name: 'Confirm'}));
    });

    const expectedToken = formatDateToken(todayDateParts(new Date()));
    expect(view.state.doc.toString()).toBe(`${expectedToken} `);
    expect(onMarkdownChange).toHaveBeenLastCalledWith(`${expectedToken} `);
    expect(
      screen.queryByRole('dialog', {name: 'Pick date and time'}),
    ).toBeNull();
  });

  it('dismisses the date token picker on outside pointerdown', () => {
    const {container} = render(
      <NoteMarkdownEditor {...baseProps({initialMarkdown: ''})} />,
    );
    const view = editorView(container);
    const rect = {
      bottom: 16,
      height: 12,
      left: 10,
      right: 18,
      top: 4,
      width: 8,
      x: 10,
      y: 4,
      toJSON: () => ({}),
    } as DOMRect;
    vi.spyOn(view, 'coordsAtPos').mockReturnValue(rect);

    act(() => {
      expect(dispatchEditorInput(view, 0, '@')).toBe(true);
    });

    expect(screen.getByRole('dialog', {name: 'Pick date and time'})).toBeTruthy();

    const host = container.querySelector('[data-note-markdown-editor]');
    if (!(host instanceof HTMLElement)) {
      throw new Error('Missing editor host');
    }

    act(() => {
      fireEvent.pointerDown(host);
    });

    expect(view.state.doc.toString()).toBe('@');
    expect(
      screen.queryByRole('dialog', {name: 'Pick date and time'}),
    ).toBeNull();
  });

  it('does not dismiss the date token picker on pointerdown inside the overlay', () => {
    const {container} = render(
      <NoteMarkdownEditor {...baseProps({initialMarkdown: ''})} />,
    );
    const view = editorView(container);
    const rect = {
      bottom: 16,
      height: 12,
      left: 10,
      right: 18,
      top: 4,
      width: 8,
      x: 10,
      y: 4,
      toJSON: () => ({}),
    } as DOMRect;
    vi.spyOn(view, 'coordsAtPos').mockReturnValue(rect);

    act(() => {
      expect(dispatchEditorInput(view, 0, '@')).toBe(true);
    });

    const dialog = screen.getByRole('dialog', {name: 'Pick date and time'});

    act(() => {
      fireEvent.pointerDown(dialog);
    });

    expect(screen.getByRole('dialog', {name: 'Pick date and time'})).toBeTruthy();
    expect(view.state.doc.toString()).toBe('@');
  });
});

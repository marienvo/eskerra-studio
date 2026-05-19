import {act, render} from '@testing-library/react';
import {createRef} from 'react';
import {describe, expect, it, vi} from 'vitest';

import {EditorView, runScopeHandlers} from '@codemirror/view';

import type {NoteInboxAttachmentHost} from '../../lib/noteInboxAttachmentHost';
import {
  NoteMarkdownEditor,
  type NoteMarkdownEditorHandle,
  type NoteMarkdownEditorProps,
} from './NoteMarkdownEditor';

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
});

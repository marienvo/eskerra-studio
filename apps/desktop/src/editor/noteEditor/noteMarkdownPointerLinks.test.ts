import {commonmarkLanguage} from '@codemirror/lang-markdown';
import {ensureSyntaxTree} from '@codemirror/language';
import {EditorState} from '@codemirror/state';
import {EditorView} from '@codemirror/view';
import {afterEach, describe, expect, it, vi} from 'vitest';

import {markdownEskerra} from './markdownEskerraLanguage';
import {noteMarkdownParserExtensions} from './markdownEditorStyling';
import {
  activateNoteMarkdownMiddleLinkAtPosition,
  activateNoteMarkdownPrimaryLinkAtPosition,
  isActivatableRelativeMarkdownHref,
  type NoteMarkdownPointerLinkHandlers,
} from './noteMarkdownPointerLinks';

function handlers(): NoteMarkdownPointerLinkHandlers {
  return {
    onWikiLinkActivate: vi.fn(),
    onMarkdownRelativeLinkActivate: vi.fn(),
    onMarkdownExternalLinkOpen: vi.fn(),
  };
}

function activationEvent() {
  return {
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  };
}

function createView(doc: string): EditorView {
  const parent = document.createElement('div');
  document.body.append(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        markdownEskerra({
          base: commonmarkLanguage,
          extensions: noteMarkdownParserExtensions,
        }),
      ],
    }),
  });
  ensureSyntaxTree(view.state, view.state.doc.length, 200);
  return view;
}

describe('noteMarkdownPointerLinks', () => {
  let view: EditorView | null = null;

  afterEach(() => {
    view?.destroy();
    view = null;
    document.body.replaceChildren();
  });

  it('recognizes only relative markdown hrefs for vault activation', () => {
    expect(isActivatableRelativeMarkdownHref('note.md')).toBe(true);
    expect(isActivatableRelativeMarkdownHref('./note.md#x')).toBe(true);
    expect(isActivatableRelativeMarkdownHref('https://example.com/note.md')).toBe(false);
    expect(isActivatableRelativeMarkdownHref('note.txt')).toBe(false);
  });

  it('activates a wiki link on primary click', () => {
    view = createView('See [[Target|Label]]');
    const h = handlers();
    const event = activationEvent();

    expect(
      activateNoteMarkdownPrimaryLinkAtPosition(
        view,
        view.state.doc.toString().indexOf('Label'),
        event,
        h,
      ),
    ).toBe(true);

    expect(h.onWikiLinkActivate).toHaveBeenCalledWith({
      inner: 'Target|Label',
      at: view.state.doc.toString().indexOf('Label'),
    });
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });

  it('activates relative markdown links on primary click', () => {
    const doc = 'See [Note](folder/note.md).';
    view = createView(doc);
    const h = handlers();
    const event = activationEvent();

    expect(
      activateNoteMarkdownPrimaryLinkAtPosition(
        view,
        doc.indexOf('Note'),
        event,
        h,
      ),
    ).toBe(true);

    expect(h.onMarkdownRelativeLinkActivate).toHaveBeenCalledWith({
      href: 'folder/note.md',
      at: doc.indexOf('folder/note.md'),
    });
  });

  it('opens external markdown links only from the URL span, plus bare URLs', () => {
    const doc = '[Site](https://example.com/path)\n\nhttps://bare.example/x';
    view = createView(doc);
    const h = handlers();

    expect(
      activateNoteMarkdownPrimaryLinkAtPosition(
        view,
        doc.indexOf('Site'),
        activationEvent(),
        h,
      ),
    ).toBe(false);
    expect(
      activateNoteMarkdownPrimaryLinkAtPosition(
        view,
        doc.indexOf('https://example.com/path'),
        activationEvent(),
        h,
      ),
    ).toBe(true);
    expect(
      activateNoteMarkdownPrimaryLinkAtPosition(
        view,
        doc.indexOf('bare.example'),
        activationEvent(),
        h,
      ),
    ).toBe(true);

    expect(h.onMarkdownExternalLinkOpen).toHaveBeenNthCalledWith(1, {
      href: 'https://example.com/path',
      at: doc.indexOf('https://example.com/path'),
    });
    expect(h.onMarkdownExternalLinkOpen).toHaveBeenNthCalledWith(2, {
      href: 'https://bare.example/x',
      at: doc.indexOf('https://bare.example/x'),
    });
  });

  it('activates vault links in the background on middle click', () => {
    view = createView('See [[Target]] and [Note](note.md).');
    const h = handlers();

    expect(
      activateNoteMarkdownMiddleLinkAtPosition(
        view,
        view.state.doc.toString().indexOf('Target'),
        activationEvent(),
        h,
      ),
    ).toBe(true);
    expect(
      activateNoteMarkdownMiddleLinkAtPosition(
        view,
        view.state.doc.toString().indexOf('Note'),
        activationEvent(),
        h,
      ),
    ).toBe(true);

    expect(h.onWikiLinkActivate).toHaveBeenCalledWith({
      inner: 'Target',
      at: view.state.doc.toString().indexOf('Target'),
      openInBackgroundTab: true,
    });
    expect(h.onMarkdownRelativeLinkActivate).toHaveBeenCalledWith({
      href: 'note.md',
      at: view.state.doc.toString().indexOf('note.md'),
      openInBackgroundTab: true,
    });
  });
});

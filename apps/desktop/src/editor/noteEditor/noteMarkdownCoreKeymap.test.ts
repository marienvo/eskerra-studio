import {historyKeymap} from '@codemirror/commands';
import {searchKeymap} from '@codemirror/search';
import {EditorState, EditorSelection} from '@codemirror/state';
import {EditorView, keymap, runScopeHandlers} from '@codemirror/view';
import {afterEach, describe, expect, it, vi} from 'vitest';

import {
  buildNoteMarkdownDeleteLineModYBindings,
  buildNoteMarkdownDuplicateLineModDBindings,
  buildNoteMarkdownVaultKeymapBindings,
  runWikiLinkActivateFromCaret,
} from './noteMarkdownCoreKeymap';

describe('runWikiLinkActivateFromCaret', () => {
  let view: EditorView | null = null;

  afterEach(() => {
    view?.destroy();
    view = null;
  });

  it('activates when caret is immediately before ]]', () => {
    const parent = document.createElement('div');
    document.body.append(parent);
    const doc = '[[alpha note]]';
    const beforeClose = doc.indexOf(']]');
    const state = EditorState.create({
      doc,
      selection: EditorSelection.cursor(beforeClose),
    });
    view = new EditorView({state, parent});
    const onWiki = vi.fn();
    expect(runWikiLinkActivateFromCaret(view, onWiki)).toBe(true);
    expect(onWiki).toHaveBeenCalledWith({
      inner: 'alpha note',
      at: beforeClose,
    });
  });
});

describe('buildNoteMarkdownDeleteLineModYBindings', () => {
  it('deletes the active line on Ctrl+Y (before historyKeymap)', () => {
    const parent = document.createElement('div');
    document.body.append(parent);
    const doc = 'alpha\nbeta\ngamma';
    const state = EditorState.create({
      doc,
      extensions: [
        keymap.of([
          ...buildNoteMarkdownDeleteLineModYBindings(),
          ...historyKeymap,
        ]),
      ],
    });
    const view = new EditorView({state, parent});
    const betaLineStart = doc.indexOf('beta');
    view.dispatch({selection: EditorSelection.cursor(betaLineStart)});
    runScopeHandlers(
      view,
      new KeyboardEvent('keydown', {
        key: 'y',
        code: 'KeyY',
        ctrlKey: true,
        bubbles: true,
      }),
      'editor',
    );
    expect(view.state.doc.toString()).toBe('alpha\ngamma');
    view.destroy();
  });
});

describe('buildNoteMarkdownDuplicateLineModDBindings', () => {
  it('duplicates the active line on Ctrl+D before searchKeymap (overrides selectNextOccurrence)', () => {
    const parent = document.createElement('div');
    document.body.append(parent);
    const doc = 'alpha\nbeta\ngamma';
    const state = EditorState.create({
      doc,
      extensions: [
        keymap.of([
          ...buildNoteMarkdownDuplicateLineModDBindings(),
          ...searchKeymap,
        ]),
      ],
    });
    const view = new EditorView({state, parent});
    const betaLineStart = doc.indexOf('beta');
    view.dispatch({selection: EditorSelection.cursor(betaLineStart)});
    runScopeHandlers(
      view,
      new KeyboardEvent('keydown', {
        key: 'd',
        code: 'KeyD',
        ctrlKey: true,
        bubbles: true,
      }),
      'editor',
    );
    expect(view.state.doc.toString()).toBe('alpha\nbeta\nbeta\ngamma');
    view.destroy();
  });
});

describe('buildNoteMarkdownVaultKeymapBindings', () => {
  it('invokes onDeleteNoteShortcut for Ctrl+Shift+D', () => {
    const onDeleteNoteShortcut = vi.fn();
    const noopVaultHandlers = {
      onWikiLinkActivate: () => {},
      onMarkdownRelativeLinkActivate: () => {},
      onMarkdownExternalLinkOpen: () => {},
    };
    const parent = document.createElement('div');
    document.body.append(parent);
    const state = EditorState.create({
      doc: 'x',
      extensions: [
        keymap.of([
          ...buildNoteMarkdownVaultKeymapBindings({
            ...noopVaultHandlers,
            onDeleteNoteShortcut,
          }),
        ]),
      ],
    });
    const view = new EditorView({state, parent});
    runScopeHandlers(
      view,
      new KeyboardEvent('keydown', {
        key: 'd',
        code: 'KeyD',
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
      }),
      'editor',
    );
    expect(onDeleteNoteShortcut).toHaveBeenCalledTimes(1);
    view.destroy();
  });

  it('invokes onSaveShortcut for Mod-Enter when modEnterSaveWhenNoLink is enabled and caret is not on a link', () => {
    const onSaveShortcut = vi.fn();
    const noopVaultHandlers = {
      onWikiLinkActivate: () => {},
      onMarkdownRelativeLinkActivate: () => {},
      onMarkdownExternalLinkOpen: () => {},
    };
    const parent = document.createElement('div');
    document.body.append(parent);
    const state = EditorState.create({
      doc: 'plain note title',
      extensions: [
        keymap.of([
          ...buildNoteMarkdownVaultKeymapBindings({
            ...noopVaultHandlers,
            onSaveShortcut,
            modEnterSaveWhenNoLink: () => true,
          }),
        ]),
      ],
    });
    const view = new EditorView({state, parent});
    runScopeHandlers(
      view,
      new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        ctrlKey: true,
        bubbles: true,
      }),
      'editor',
    );
    expect(onSaveShortcut).toHaveBeenCalledTimes(1);
    view.destroy();
  });

  it('activates wiki links on Mod-Enter instead of saving when modEnterSaveWhenNoLink is enabled', () => {
    const onSaveShortcut = vi.fn();
    const onWikiLinkActivate = vi.fn();
    const parent = document.createElement('div');
    document.body.append(parent);
    const doc = '[[alpha note]]';
    const beforeClose = doc.indexOf(']]');
    const state = EditorState.create({
      doc,
      selection: EditorSelection.cursor(beforeClose),
      extensions: [
        keymap.of([
          ...buildNoteMarkdownVaultKeymapBindings({
            onWikiLinkActivate,
            onMarkdownRelativeLinkActivate: () => {},
            onMarkdownExternalLinkOpen: () => {},
            onSaveShortcut,
            modEnterSaveWhenNoLink: () => true,
          }),
        ]),
      ],
    });
    const view = new EditorView({state, parent});
    runScopeHandlers(
      view,
      new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        ctrlKey: true,
        bubbles: true,
      }),
      'editor',
    );
    expect(onWikiLinkActivate).toHaveBeenCalledWith({
      inner: 'alpha note',
      at: beforeClose,
    });
    expect(onSaveShortcut).not.toHaveBeenCalled();
    view.destroy();
  });
});

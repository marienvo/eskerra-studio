import {EditorSelection} from '@codemirror/state';
import {unfoldAll} from '@codemirror/language';

import {flushAllEskerraTableDrafts} from './eskerraTableV1/eskerraTableDraftFlush';
import {markdownInlineLinkUrlAtPosition} from './markdownInlineLinkUrlAtPosition';
import {wikiLinkMatchAtDocPosition} from './wikiLinkInnerAtDocPosition';
import {nestedCollapseAllFolds} from './nestedFoldAll';
import type {NoteMarkdownLoadOptions} from './noteMarkdownLoadMarkdown';
import type {NoteMarkdownEditorHandle} from './noteMarkdownEditorTypes';
import type {NoteMarkdownEditorShellRefs} from './useNoteMarkdownEditorShellRefs';

export function createNoteMarkdownEditorHandle(
  shell: Pick<
    NoteMarkdownEditorShellRefs,
    | 'viewRef'
    | 'codemirrorBootExtensionsRef'
    | 'wikiLinkCompartmentRef'
    | 'relativeMdLinkCompartmentRef'
    | 'initialMarkdownRef'
  >,
  applyMarkdownLoadNow: (
    markdown: string,
    options?: NoteMarkdownLoadOptions,
  ) => void,
): NoteMarkdownEditorHandle {
  return {
    getMarkdown: () => {
      const view = shell.viewRef.current;
      if (view) {
        flushAllEskerraTableDrafts(view);
      }
      return view?.state.doc.toString() ?? shell.initialMarkdownRef.current;
    },
    loadMarkdown: (markdown: string, options?: NoteMarkdownLoadOptions) => {
      const view = shell.viewRef.current;
      const bootExtensions = shell.codemirrorBootExtensionsRef.current;
      const wikiCompartment = shell.wikiLinkCompartmentRef.current;
      const relCompartment = shell.relativeMdLinkCompartmentRef.current;
      if (!view || !bootExtensions || !wikiCompartment || !relCompartment) {
        return;
      }
      applyMarkdownLoadNow(markdown, options);
    },
    unfoldAllFolds: () => {
      const view = shell.viewRef.current;
      if (!view) {
        return false;
      }
      return unfoldAll(view);
    },
    collapseAllFolds: () => {
      const view = shell.viewRef.current;
      if (!view) {
        return false;
      }
      return nestedCollapseAllFolds(view);
    },
    replaceWikiLinkInnerAt: ({at, expectedInner, replacementInner}) => {
      if (replacementInner === expectedInner) {
        return true;
      }
      const view = shell.viewRef.current;
      if (!view) {
        return false;
      }
      const match = wikiLinkMatchAtDocPosition(view.state.doc, at);
      if (!match || match.inner !== expectedInner) {
        return false;
      }
      view.dispatch({
        changes: {
          from: match.innerFrom,
          to: match.innerTo,
          insert: replacementInner,
        },
      });
      return true;
    },
    replaceMarkdownLinkHrefAt: ({at, expectedHref, replacementHref}) => {
      if (replacementHref === expectedHref) {
        return true;
      }
      const view = shell.viewRef.current;
      if (!view) {
        return false;
      }
      const linkUrl = markdownInlineLinkUrlAtPosition(view.state, at);
      if (!linkUrl || linkUrl.href !== expectedHref) {
        return false;
      }
      view.dispatch({
        changes: {
          from: linkUrl.hrefFrom,
          to: linkUrl.hrefTo,
          insert: replacementHref,
        },
      });
      return true;
    },
    focus: (options?: {anchor?: number; scrollIntoView?: boolean}) => {
      const view = shell.viewRef.current;
      if (!view) {
        return;
      }
      if (options?.anchor !== undefined) {
        const a = Math.max(
          0,
          Math.min(options.anchor, view.state.doc.length),
        );
        const scroll = options.scrollIntoView !== false;
        view.dispatch({
          selection: EditorSelection.cursor(a),
          ...(scroll ? {scrollIntoView: true} : {}),
        });
      } else if (view.state.doc.length === 0) {
        view.dispatch({
          selection: EditorSelection.cursor(0),
          scrollIntoView: true,
        });
      }
      view.focus();
    },
  };
}

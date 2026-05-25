import {EditorState} from '@codemirror/state';
import {EditorView} from '@codemirror/view';
import {useEffect, useLayoutEffect} from 'react';

import {markdownRelativeLinkHighlightExtensions} from './markdownRelativeLinkCodemirror';
import {wikiLinkResolvedHighlightExtensions} from './wikiLinkCodemirror';
import {dispatchEskerraTableNestedCellEditors} from './eskerraTableV1/eskerraTableNestedCellEditors';
import type {NoteMarkdownEditorShellRefs} from './useNoteMarkdownEditorShellRefs';

export function useNoteMarkdownEditorCompartmentEffects(
  shell: Pick<
    NoteMarkdownEditorShellRefs,
    | 'viewRef'
    | 'wikiLinkCompartmentRef'
    | 'relativeMdLinkCompartmentRef'
    | 'readOnlyCompartmentRef'
  >,
  wikiLinkTargetIsResolved: (inner: string) => boolean,
  relativeMarkdownLinkHrefIsResolved: (href: string) => boolean,
  readOnly: boolean,
): void {
  useEffect(() => {
    const compartment = shell.wikiLinkCompartmentRef.current;
    const view = shell.viewRef.current;
    if (!compartment || !view) {
      return;
    }
    const wikiEffect = compartment.reconfigure(
      wikiLinkResolvedHighlightExtensions(wikiLinkTargetIsResolved),
    );
    view.dispatch({effects: wikiEffect});
    dispatchEskerraTableNestedCellEditors(view, {effects: wikiEffect});
  }, [wikiLinkTargetIsResolved]);

  useEffect(() => {
    const compartment = shell.relativeMdLinkCompartmentRef.current;
    const view = shell.viewRef.current;
    if (!compartment || !view) {
      return;
    }
    const relEffect = compartment.reconfigure(
      markdownRelativeLinkHighlightExtensions(relativeMarkdownLinkHrefIsResolved),
    );
    view.dispatch({effects: relEffect});
    dispatchEskerraTableNestedCellEditors(view, {effects: relEffect});
  }, [relativeMarkdownLinkHrefIsResolved]);

  useLayoutEffect(() => {
    const compartment = shell.readOnlyCompartmentRef.current;
    const view = shell.viewRef.current;
    if (!compartment || !view) {
      return;
    }
    const roEffect = compartment.reconfigure([
      EditorState.readOnly.of(readOnly),
      EditorView.editable.of(!readOnly),
    ]);
    view.dispatch({effects: roEffect});
    dispatchEskerraTableNestedCellEditors(view, {effects: roEffect});
  }, [readOnly]);
}

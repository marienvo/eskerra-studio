import {EditorSelection, EditorState, Transaction} from '@codemirror/state';
import {EditorView} from '@codemirror/view';
import type {Extension} from '@codemirror/state';
import {useCallback} from 'react';

import {markdownRelativeLinkHighlightExtensions} from './markdownRelativeLinkCodemirror';
import {wikiLinkResolvedHighlightExtensions} from './wikiLinkCodemirror';
import {
  clearEskerraTableNestedCellRegistrations,
  dispatchEskerraTableNestedCellEditors,
} from './eskerraTableV1/eskerraTableNestedCellEditors';
import {
  beginProgrammaticMarkdownLoad,
  endProgrammaticMarkdownLoad,
} from './caretJumpDetector';
import {computeMinimalEditorChanges} from './noteMarkdownDiffChanges';
import {
  cursorForMarkdownLoadSetState,
  forcedCursorForMarkdownLoadDispatch,
  type NoteMarkdownLoadOptions,
  resolveMarkdownLoadDocument,
  selectionIsPreserve,
  selMatchesForcedCursor,
  shouldUseMergedReplaceForMarkdownLoad,
  shouldUseSetStateBranchForMarkdownLoad,
} from './noteMarkdownLoadMarkdown';
import {
  foldableRangesPresent,
  foldedRangesPresent,
} from './noteMarkdownFoldStatus';
import type {NoteMarkdownEditorShellRefs} from './useNoteMarkdownEditorShellRefs';

export function useNoteMarkdownEditorLoad(
  shell: Pick<
    NoteMarkdownEditorShellRefs,
    | 'viewRef'
    | 'codemirrorBootExtensionsRef'
    | 'wikiLinkCompartmentRef'
    | 'relativeMdLinkCompartmentRef'
    | 'readOnlyCompartmentRef'
    | 'readOnlyRef'
    | 'wikiLinkTargetIsResolvedRef'
    | 'relativeMarkdownLinkHrefIsResolvedRef'
    | 'onFoldedRangesPresentChangeRef'
    | 'onFoldableRangesPresentChangeRef'
  >,
): (markdown: string, options?: NoteMarkdownLoadOptions) => void {
  const applyMarkdownLoadNow = useCallback(
    (markdown: string, options?: NoteMarkdownLoadOptions) => {
      const v = shell.viewRef.current;
      const be = shell.codemirrorBootExtensionsRef.current;
      const wc = shell.wikiLinkCompartmentRef.current;
      const rc = shell.relativeMdLinkCompartmentRef.current;
      if (!v || !be || !wc || !rc) {
        return;
      }
      beginProgrammaticMarkdownLoad(v);
      try {
        const resolved = resolveMarkdownLoadDocument(markdown, options);
        const {effectiveMarkdown} = resolved;
        const hadFoldedRanges = foldedRangesPresent(v.state);
        const curLen = v.state.doc.length;
        const curText = v.state.doc.toString();
        const preserve = selectionIsPreserve(options);
        const forced = forcedCursorForMarkdownLoadDispatch(options, resolved);
        const selMatchesForced =
          forced !== undefined && selMatchesForcedCursor(v.state, forced);
        const branchInput = {
          hadFoldedRanges,
          curText,
          markdown: effectiveMarkdown,
          preserve,
          selMatchesForcedCursor: selMatchesForced,
        };
        const mergedReplace =
          shouldUseMergedReplaceForMarkdownLoad(branchInput);
        const useSetState = shouldUseSetStateBranchForMarkdownLoad(branchInput);
        const wikiEff = wc.reconfigure(
          wikiLinkResolvedHighlightExtensions(
            shell.wikiLinkTargetIsResolvedRef.current,
          ),
        );
        const relEff = rc.reconfigure(
          markdownRelativeLinkHighlightExtensions(
            shell.relativeMarkdownLinkHrefIsResolvedRef.current,
          ),
        );
        const roComp = shell.readOnlyCompartmentRef.current;
        const roEff =
          roComp != null
            ? roComp.reconfigure([
                EditorState.readOnly.of(shell.readOnlyRef.current),
                EditorView.editable.of(!shell.readOnlyRef.current),
              ])
            : null;
        const effects =
          roEff !== null ? [wikiEff, relEff, roEff] : [wikiEff, relEff];
        if (mergedReplace) {
          const spec: Parameters<EditorView['dispatch']>[0] = {
            changes: preserve
              ? computeMinimalEditorChanges(curText, effectiveMarkdown)
              : {from: 0, to: curLen, insert: effectiveMarkdown},
            annotations: Transaction.addToHistory.of(false),
            effects,
          };
          if (forced !== undefined) {
            spec.selection = EditorSelection.cursor(forced);
          }
          v.dispatch(spec);
          clearEskerraTableNestedCellRegistrations(v);
        } else if (useSetState) {
          const cursorAt = cursorForMarkdownLoadSetState(
            options,
            resolved,
            preserve,
            v.state.selection.main.head,
            curText,
          );
          const nextState = EditorState.create({
            doc: effectiveMarkdown,
            selection: EditorSelection.cursor(cursorAt),
            extensions: be as Extension[],
          });
          v.setState(nextState);
          clearEskerraTableNestedCellRegistrations(v);
        }
        if (!mergedReplace) {
          v.dispatch({effects});
        }
        dispatchEskerraTableNestedCellEditors(v, {effects});
        shell.onFoldedRangesPresentChangeRef.current?.(
          foldedRangesPresent(v.state),
        );
        shell.onFoldableRangesPresentChangeRef.current?.(
          foldableRangesPresent(v.state),
        );
      } finally {
        endProgrammaticMarkdownLoad(v);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reads latest values via shell refs
    [],
  );

  return applyMarkdownLoadNow;
}

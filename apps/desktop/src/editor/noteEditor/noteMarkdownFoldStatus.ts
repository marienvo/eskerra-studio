import {foldedRanges} from '@codemirror/language';
import type {EditorState} from '@codemirror/state';

export function foldedRangesPresent(state: EditorState): boolean {
  return foldedRanges(state).size > 0;
}

export function createFoldGutterMarker(open: boolean): HTMLSpanElement {
  const span = document.createElement('span');
  span.textContent = open ? '⌄' : '›';
  span.className = 'cm-foldGutter-marker app-tooltip-trigger';
  span.setAttribute('data-tooltip', open ? 'Fold line' : 'Unfold line');
  span.setAttribute('data-tooltip-placement', 'inline-end');
  span.setAttribute('aria-label', open ? 'Fold line' : 'Unfold line');
  return span;
}

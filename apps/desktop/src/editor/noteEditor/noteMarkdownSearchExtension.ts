import {search, searchPanelOpen} from '@codemirror/search';
import type {Extension} from '@codemirror/state';
import {EditorView} from '@codemirror/view';

/** Extra px below the sticky search bar so scroll-into-view clears the panel (outer scroll + `overflow: visible` scroller). */
const NOTE_CAPTURE_SEARCH_SCROLL_MARGIN_PX = 8;

export function captureSearchPanelTopInsetPx(view: EditorView): number {
  const panels = view.dom.querySelector('.cm-panels-top');
  if (!panels) {
    return NOTE_CAPTURE_SEARCH_SCROLL_MARGIN_PX;
  }
  return (
    Math.round(panels.getBoundingClientRect().height)
    + NOTE_CAPTURE_SEARCH_SCROLL_MARGIN_PX
  );
}

/**
 * Search + scroll padding for the capture editor: sticky `.cm-panels-top` sits in the outer
 * `overflow-y` scroller, so default `scrollIntoView` margins miss the real obstruction.
 */
export const noteMarkdownSearchExtensionBundle: readonly Extension[] = [
  search({
    scrollToMatch: range =>
      EditorView.scrollIntoView(range, {
        y: 'start',
        yMargin: NOTE_CAPTURE_SEARCH_SCROLL_MARGIN_PX,
      }),
  }),
  EditorView.scrollMargins.of(view =>
    searchPanelOpen(view.state)
      ? {top: captureSearchPanelTopInsetPx(view)}
      : null,
  ),
];

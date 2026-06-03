import {syntaxTree} from '@codemirror/language';
import type {EditorState} from '@codemirror/state';
import {isBrowserOpenableMarkdownHref} from '@eskerra/core';

export type ActivatableExternalMdLinkHit = {
  href: string;
  hrefFrom: number;
  hrefTo: number;
};

/**
 * Browser-openable inline markdown links activate only from the URL span, not the label.
 * Includes the caret slot immediately before the closing `)`.
 */
export function markdownActivatableExternalMdLinkAtPosition(
  state: EditorState,
  pos: number,
): ActivatableExternalMdLinkHit | null {
  const tree = syntaxTree(state);
  const node = tree.resolveInner(pos, -1);
  for (let n: typeof node | null = node; n; n = n.parent) {
    if (n.name === 'Image') {
      return null;
    }
    if (n.name !== 'Link') {
      continue;
    }
    const url = n.getChild('URL');
    if (url == null || pos < url.from || pos > url.to) {
      return null;
    }
    const href = state.sliceDoc(url.from, url.to);
    if (!isBrowserOpenableMarkdownHref(href)) {
      return null;
    }
    return {href, hrefFrom: url.from, hrefTo: url.to};
  }
  return null;
}

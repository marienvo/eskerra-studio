import {ensureSyntaxTree, syntaxTree} from '@codemirror/language';
import {type Extension, type Range} from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import {isBrowserOpenableMarkdownHref} from '@eskerra/core';

import {collectBareBrowserUrlIntervals} from './markdownBareUrl';
import {relativeMarkdownLinkLabelSpan} from './relativeMarkdownLinkLabelSpan';

const TREE_ENSURE_BUDGET_MS = 200;

/** Shared with table static segments and CSS — exactly one glyph per logical external link. */
export const CM_MD_EXTERNAL_LINK_GLYPH_CLASS = 'cm-md-external-link-glyph';

/** Bare / URL-only browser spans — `word-break` in `App.css` (list lines + long hrefs). */
export const CM_MD_EXTERNAL_BARE_URL_CLASS = 'cm-md-external-bare-url';

/** Builds external (http/https/mailto) markdown link decorations. Exported for tests. */
export function buildExternalMdLinkDecorations(view: EditorView): DecorationSet {
  ensureSyntaxTree(view.state, view.state.doc.length, TREE_ENSURE_BUDGET_MS);
  const tree = syntaxTree(view.state);
  const ranges: Range<Decoration>[] = [];
  const g = CM_MD_EXTERNAL_LINK_GLYPH_CLASS;
  tree.iterate({
    enter(ref) {
      if (ref.name !== 'URL') {
        return;
      }
      const parent = ref.node.parent;
      if (parent == null || parent.name !== 'Link') {
        return;
      }
      const href = view.state.sliceDoc(ref.from, ref.to);
      if (!isBrowserOpenableMarkdownHref(href)) {
        return;
      }
      const cls = 'cm-md-external-link';
      const labelSpan = relativeMarkdownLinkLabelSpan(parent, (a, b) =>
        view.state.sliceDoc(a, b),
      );
      const hasVisibleLabel =
        labelSpan != null && labelSpan.to > labelSpan.from;
      const hrefClass = hasVisibleLabel
        ? `${cls} cm-md-external-href ${g}`
        : `${cls} cm-md-external-href ${g} ${CM_MD_EXTERNAL_BARE_URL_CLASS}`;
      ranges.push(Decoration.mark({class: hrefClass}).range(ref.from, ref.to));
      if (hasVisibleLabel && labelSpan != null) {
        ranges.push(
          Decoration.mark({class: cls}).range(
            labelSpan.from,
            labelSpan.to,
          ),
        );
      }
    },
  });
  const bareIntervals = collectBareBrowserUrlIntervals(view.state);
  for (const iv of bareIntervals) {
    ranges.push(
      Decoration.mark({
        class: `cm-md-external-link ${g} ${CM_MD_EXTERNAL_BARE_URL_CLASS}`,
      }).range(iv.from, iv.to),
    );
  }
  return ranges.length ? Decoration.set(ranges, true) : Decoration.none;
}

/** Highlights inline link label and URL for browser-openable schemes (not images). */
export function markdownExternalLinkHighlightExtension(): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildExternalMdLinkDecorations(view);
      }

      update(update: ViewUpdate) {
        if (update.docChanged) {
          this.decorations = buildExternalMdLinkDecorations(update.view);
        }
      }
    },
    {decorations: instance => instance.decorations},
  );

  return plugin;
}

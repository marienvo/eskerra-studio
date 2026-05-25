import {splitYamlFrontmatter} from '@eskerra/core';

import {resolveMarkdownLoadDocument} from '../editor/noteEditor/noteMarkdownLoadMarkdown';
import {inboxEditorSliceToFullMarkdown} from '../lib/inboxYamlFrontmatterEditor';

function normalizeToLf(markdown: string): string {
  return markdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * Open-note padding is editor-only. When the live slice exactly matches the padded open-note
 * document derived from the persisted disk body, collapse it back to the disk body before any
 * dirty-check, persist, or reconcile compare.
 */
export function persistableInboxEditorBodySlice(
  editorBodySlice: string,
  persistedFullMarkdown: string | null,
): string {
  const normalizedSlice = normalizeToLf(editorBodySlice);
  if (persistedFullMarkdown == null) {
    return normalizedSlice;
  }
  const {body: persistedBody} = splitYamlFrontmatter(
    normalizeToLf(persistedFullMarkdown),
  );
  const resolved = resolveMarkdownLoadDocument(persistedBody, {
    selection: 'openNote',
  });
  if (resolved.effectiveMarkdown === normalizedSlice) {
    return persistedBody;
  }
  return normalizedSlice;
}

export function persistableInboxEditorFullMarkdown(args: {
  editorBodySlice: string;
  selectedUri: string | null;
  composingNewEntry: boolean;
  yamlInner: string | null;
  yamlLeading: string;
  persistedFullMarkdown: string | null;
}): string {
  const persistableSlice = persistableInboxEditorBodySlice(
    args.editorBodySlice,
    args.persistedFullMarkdown,
  );
  return inboxEditorSliceToFullMarkdown(
    persistableSlice,
    args.selectedUri,
    args.composingNewEntry,
    args.yamlInner,
    args.yamlLeading,
  );
}

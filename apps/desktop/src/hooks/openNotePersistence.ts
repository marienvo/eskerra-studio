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
  diskBodyBaseline: string | null,
): string {
  const normalizedSlice = normalizeToLf(editorBodySlice);
  if (diskBodyBaseline == null) {
    return normalizedSlice;
  }
  const normalizedBaseline = normalizeToLf(diskBodyBaseline);
  const resolved = resolveMarkdownLoadDocument(normalizedBaseline, {
    selection: 'openNote',
  });
  if (resolved.effectiveMarkdown === normalizedSlice) {
    return normalizedBaseline;
  }
  return normalizedSlice;
}

export function persistableInboxEditorFullMarkdown(args: {
  editorBodySlice: string;
  diskBodyBaseline: string | null;
  selectedUri: string | null;
  composingNewEntry: boolean;
  yamlInner: string | null;
  yamlLeading: string;
}): string {
  const persistableSlice = persistableInboxEditorBodySlice(
    args.editorBodySlice,
    args.diskBodyBaseline,
  );
  return inboxEditorSliceToFullMarkdown(
    persistableSlice,
    args.selectedUri,
    args.composingNewEntry,
    args.yamlInner,
    args.yamlLeading,
  );
}
